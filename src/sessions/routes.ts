import fs from 'node:fs';
import os from 'node:os';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getConfig } from '../config.ts';
import { getLogs } from '../log.ts';
import { clearFlag, getFlags, NOTE_MAX, SESSION_ID, setFlag, syncFlags } from './flags.ts';
import { readConversation } from './collect/conversation.ts';
import { findTranscript } from './collect/transcript.ts';
import { LiveUsage, TranscriptScanner } from './collect/usage.ts';
import { collectSnapshot, pathsFor } from './state.ts';
import { canFocusTerminal, resumeInTerminal, showTerminal } from './terminal.ts';
import type { RouterSummary, Snapshot } from './types.ts';

// Ported from Claude Office's server/api.ts: same snapshot, stream and conversation rules, on Hono.

const paths = pathsFor(os.homedir());
let scanner: TranscriptScanner | undefined;
let live: LiveUsage | undefined;
let snapshot: Snapshot | undefined;
let lastKey = '';
let pollTimer: ReturnType<typeof setInterval> | undefined;
const clients = new Set<(frame: string) => void>();

/** Each session's newest request through the router, newest log entry first. */
function routerSummaries(): Map<string, RouterSummary> {
  const out = new Map<string, RouterSummary>();
  for (const l of getLogs()) {
    if (!l.sessionId) continue;
    const seen = out.get(l.sessionId);
    if (seen) {
      seen.requests++;
      continue;
    }
    out.set(l.sessionId, {
      provider: l.provider,
      model: l.modelOut,
      status: l.status,
      fallbacks: Math.max(0, (l.attempts?.length ?? 1) - 1),
      at: l.time,
      requests: 1,
    });
  }
  return out;
}

function tick(): void {
  if (!scanner || !live) return;
  try {
    snapshot = collectSnapshot(paths, getConfig().sessions, scanner, live, Date.now());
  } catch (e) {
    console.error('claude-code-control-tower: could not read session data:', e);
    return;
  }
  const router = routerSummaries();
  for (const t of snapshot.tables) for (const a of t.agents) a.router = router.get(a.sessionId);
  for (const h of snapshot.history) h.router = router.get(h.sessionId);
  const shown = [...snapshot.tables.flatMap((t) => t.agents), ...snapshot.history];
  syncFlags(new Set(shown.map((s) => s.sessionId)));
  const flags = getFlags();
  for (const s of shown) {
    const f = flags[s.sessionId];
    if (f) s.flag = f.note ? { note: f.note } : {};
  }

  const key = JSON.stringify({ ...snapshot, generatedAt: 0 });
  const frame = key === lastKey ? ':\n\n' : `data: ${JSON.stringify(snapshot)}\n\n`;
  lastKey = key;
  for (const send of clients) send(frame);
}

function checkUsage(): Promise<void> {
  const done = live!.check().then(tick);
  tick(); // show "checking" straight away
  return done;
}

function usageAge(): number {
  return Date.now() - (live?.latest?.fetchedAt ?? 0);
}

/** Starts reading session files. Not called in tests, which must not read real files or keep timers. */
export function startSessions(): void {
  scanner = new TranscriptScanner(paths.projects);
  live = new LiveUsage();
  // A usage check costs a little usage, so it only runs while somebody has the page open and the last one is old enough.
  setInterval(() => {
    const min = getConfig().sessions.usageCheckMin;
    if (min > 0 && clients.size > 0 && usageAge() >= min * 60_000) void checkUsage();
  }, 15_000);
  setInterval(() => void scanner!.scan(), 15_000);
  void scanner.scan();
  restartPoll();
  tick();
}

/** Applies a changed refresh interval. */
export function restartPoll(): void {
  if (!scanner) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, getConfig().sessions.pollMs);
  tick();
}

export function sessionRoutes(app: Hono): void {
  app.get('/api/sessions/state', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(snapshot ?? null);
  });

  app.get('/api/sessions/stream', (c) => {
    c.header('cache-control', 'no-store');
    return streamSSE(c, async (stream) => {
      let close!: () => void;
      const closed = new Promise<void>((r) => (close = r));
      const send = (frame: string) => void stream.write(frame);
      if (snapshot) await stream.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      clients.add(send);
      stream.onAbort(() => {
        clients.delete(send);
        close();
      });
      // Opening the page should show current figures, not ones from before it was closed.
      const min = getConfig().sessions.usageCheckMin;
      if (live && min > 0 && usageAge() >= min * 60_000) void checkUsage();
      await closed;
    });
  });

  app.get('/api/sessions/conversation', (c) => {
    // Only sessions on the board or in its recent history, so no other file can be asked for.
    const id = c.req.query('session') ?? '';
    const agent =
      snapshot?.tables.flatMap((t) => t.agents).find((a) => a.sessionId === id) ??
      snapshot?.history.find((h) => h.sessionId === id);
    const file = agent && findTranscript(paths.projects, agent.cwd, id);
    if (!file) return c.json({ error: 'That session is not running any more.' }, 404);
    const fromParam = c.req.query('from');
    const from = fromParam === undefined ? undefined : Number(fromParam);
    if (from !== undefined && !(Number.isInteger(from) && from >= 0)) return c.json({ error: 'Bad position.' }, 400);
    try {
      return c.json(readConversation(file, from));
    } catch {
      return c.json({ error: 'The conversation could not be read.' }, 500);
    }
  });

  app.post('/api/sessions/terminal', async (c) => {
    // A live terminal session: bring its window forward. An ended one: resume it in a new Terminal window.
    // A live VS Code or desktop session is not resumed here, which would run two copies of it.
    const body = (await c.req.json().catch(() => ({}))) as { session?: unknown };
    const id = typeof body.session === 'string' ? body.session : '';
    const live = snapshot?.tables.flatMap((t) => t.agents).find((a) => a.sessionId === id);
    const past = live ? undefined : snapshot?.history.find((h) => h.sessionId === id);
    try {
      if (live) {
        if (live.app !== 'terminal') {
          return c.json({ error: 'That session is running in another app. Reply there; resuming it in a terminal would run two copies.' }, 409);
        }
        if (!canFocusTerminal()) return c.json({ error: 'Bringing a running terminal forward is only supported on macOS.' }, 409);
        const opened = await showTerminal(live.pid);
        if (opened) return c.json({ opened });
        return c.json({ error: 'Could not find its terminal window. Only Terminal and iTerm2 are supported.' }, 404);
      }
      if (past) {
        if (!fs.existsSync(past.cwd) || !fs.statSync(past.cwd).isDirectory()) return c.json({ error: 'The session folder no longer exists.' }, 404);
        const opened = await resumeInTerminal(past.cwd, id);
        return c.json({ opened, resumed: true });
      }
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
    return c.json({ error: 'That session is not on the board or in its recent history.' }, 404);
  });

  // Flags: sessions you keep an eye on, saved in the app's state folder and shown on the board.
  app.get('/api/sessions/flags', (c) => c.json(getFlags()));

  app.put('/api/sessions/flags/:id', async (c) => {
    const id = c.req.param('id');
    if (!SESSION_ID.test(id)) return c.json({ error: 'Bad session id.' }, 400);
    const body = (await c.req.json().catch(() => null)) as { note?: unknown } | null;
    const note = body?.note;
    if (note !== undefined && (typeof note !== 'string' || note.length > NOTE_MAX)) {
      return c.json({ error: `The note must be text of at most ${NOTE_MAX} characters.` }, 400);
    }
    setFlag(id, note);
    tick();
    return c.json(getFlags()[id]);
  });

  app.delete('/api/sessions/flags/:id', (c) => {
    const id = c.req.param('id');
    if (!SESSION_ID.test(id)) return c.json({ error: 'Bad session id.' }, 400);
    clearFlag(id);
    tick();
    return c.json({ ok: true });
  });

  app.post('/api/sessions/usage/check', (c) => {
    // The "Check now" button. Ignored if one ran in the last 20 seconds.
    if (live && usageAge() > 20_000) void checkUsage();
    return c.json({ checking: true }, 202);
  });
}
