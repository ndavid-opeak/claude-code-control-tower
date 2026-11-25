import fs from 'node:fs';
import path from 'node:path';
import type { DesktopMeta } from './collect/desktop.ts';
import { isReviewCwd } from '../analyzer/review.ts';
import { readDesktopSessions } from './collect/desktop.ts';
import type { TableDir } from './collect/projects.ts';
import { ELSEWHERE, listTables, tableFor } from './collect/projects.ts';
import { readRegistry } from './collect/registry.ts';
import { readSubagents } from './collect/subagents.ts';
import type { TailSummary } from './collect/transcript.ts';
import { tokensUsed } from './collect/tokens.ts';
import { cachedTail, findTranscript } from './collect/transcript.ts';
import type { TranscriptScanner } from './collect/usage.ts';
import type { LiveUsage } from './collect/usage.ts';
import { familyOf, readPlanUsage, USAGE_CHECK_DIR } from './collect/usage.ts';
import type { Config, ContextAlert, ContextLevel, MainAgent, MainState, PastSession, Snapshot, Table, Usage, UsageBreakdown } from './types.ts';

/** A session stays "working" this long after it last reported busy, so a pause between steps does not flip it to done and back. */
const BUSY_GRACE_MS = 6000;

export interface Paths {
  sessions: string;
  projects: string;
  claudeJson: string;
  desktopSessions: string;
}

export function pathsFor(home: string): Paths {
  return {
    sessions: path.join(home, '.claude', 'sessions'),
    projects: path.join(home, '.claude', 'projects'),
    claudeJson: path.join(home, '.claude.json'),
    desktopSessions: path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
  };
}

export interface StateInput {
  status: string;
  waitingFor?: string;
  statusUpdatedAt?: number;
  tail: TailSummary;
  desktop?: DesktopMeta;
  recentlyBusy?: boolean;
}

/**
 * Follows the rule Claude's own agent view uses: a session that finished its turn is done.
 * It is waiting only when it cannot continue without you (a prompt, an open question, a plan to approve, a block).
 */
export function deriveMainState(i: StateInput): { state: MainState; reason?: string; since?: number } {
  const waiting = (reason: string, since?: number) => ({ state: 'waiting' as const, reason, since });
  if (i.status === 'waiting') return waiting(sentence(i.waitingFor) ?? 'Waiting for you', i.statusUpdatedAt);
  if (i.tail.ask) {
    const reason = i.tail.ask.kind === 'plan' ? 'Plan ready for your approval' : 'Asked you a question';
    return waiting(reason, i.tail.lastActivityAt);
  }
  if (i.status === 'busy' || i.recentlyBusy) return { state: 'working' };

  const ended = i.tail.turnEndedAt ?? i.tail.lastActivityAt;
  const d = i.desktop;
  if (d?.interrupted) return waiting('Interrupted, waiting for you', ended);
  const needs = typeof d?.needsAction === 'string' ? d.needsAction.trim() : d?.needsAction ? 'Needs your input' : '';
  if (d?.statusCategory === 'blocked' || needs) {
    return waiting(needs || d?.statusDetail || 'Blocked, needs your input', ended);
  }
  if (ended) return { state: 'done', since: ended };
  return { state: 'idle' };
}

const sentence = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : undefined);

/** Claude Code's docs: Fable, Opus 4.7 and later, Sonnet 5 and later, and Haiku 5.5 run with a 1M window by default. */
export function hasMillionWindow(model: string): boolean {
  const m = /claude-([a-z]+)-(\d+)-(\d{1,2})(?!\d)/.exec(model);
  if (!m) return false;
  const version = Number(m[2]) + Number(m[3]) / 10;
  if (m[1] === 'fable') return true;
  if (m[1] === 'opus') return version >= 4.7;
  if (m[1] === 'sonnet') return version >= 5;
  if (m[1] === 'haiku') return version >= 5.5;
  return false;
}

/**
 * Claude does not record a session's window, so: your override, else 1M for models documented as 1M,
 * else 1M if this model has been seen above 200k on this Mac, else 200k.
 */
export function contextLimitFor(
  model: string | undefined,
  tokens: number | undefined,
  overrides: Record<string, number>,
  seenMax: Record<string, number> = {},
): number {
  const family = model ? familyOf(model) : 'other';
  const override = model ? (overrides[model] ?? overrides[family]) : undefined;
  if (override) return override;
  if (model && hasMillionWindow(model)) return 1_000_000;
  return Math.max(tokens ?? 0, seenMax[family] ?? 0) > 200_000 ? 1_000_000 : 200_000;
}

/** Whether a context of `tokens` has passed the warning or danger size set for this model's family. */
export function contextLevelFor(model: string | undefined, tokens: number | undefined, alerts: Record<string, ContextAlert>): ContextLevel | undefined {
  if (!tokens) return undefined;
  const a = alerts[model ? familyOf(model) : 'other'] ?? alerts.other;
  if (!a) return undefined;
  if (tokens >= a.danger) return 'danger';
  if (tokens >= a.warn) return 'warn';
  return undefined;
}

/**
 * Where a session runs, and a link that opens it there.
 * VS Code: the extension's documented vscode://anthropic.claude-code/open?session= link.
 * Desktop app: the claude://code/continue?session= link the app itself uses in its dock menu; not documented.
 */
export function appLink(entrypoint: string | undefined, sessionId: string, hostSessionId?: string): Pick<MainAgent, 'app' | 'openUrl'> {
  if (entrypoint === 'claude-desktop') {
    return {
      app: 'desktop',
      openUrl: hostSessionId ? `claude://code/continue?session=${encodeURIComponent(hostSessionId)}` : undefined,
    };
  }
  if (entrypoint === 'claude-vscode') {
    return { app: 'vscode', openUrl: `vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}` };
  }
  if (entrypoint === 'cli') return { app: 'terminal' };
  return { app: 'other' };
}

/**
 * Where auto-compact starts. Claude Code documents about 967k for 1M-window models and the window itself
 * otherwise; a custom auto-compact setting would move it, which this does not read.
 */
export const compactPoint = (limit: number) => (limit >= 1_000_000 ? 967_000 : limit);

const FIVE_HOURS = 5 * 3_600_000;

/** Token use since the current 5-hour window opened, per model and per session. */
export function breakdown(
  scanner: TranscriptScanner,
  usage: Usage,
  live: Map<string, string>,
  now: number,
): UsageBreakdown {
  const since = usage.session?.resetsAt && usage.session.resetsAt > now ? usage.session.resetsAt - FIVE_HOURS : now - FIVE_HOURS;
  const t = scanner.windowTokens(since, now);
  const sessions = Object.entries(t.bySession)
    .filter(([, n]) => n > 0)
    .map(([sessionId, tokens]) => {
      const name = live.get(sessionId);
      return name
        ? { sessionId, name, live: true, tokens }
        : { sessionId, name: `Closed: ${scanner.titleOf(sessionId) ?? 'untitled session'}`, live: false, tokens };
    })
    .sort((a, b) => b.tokens - a.tokens);
  return { since, total: Object.values(t.byModel).reduce((a, b) => a + b, 0), byModel: t.byModel, sessions };
}

/** Sessions that ended within this long are listed under "Ended recently". */
export const HISTORY_MS = 24 * 3_600_000;
const MAX_HISTORY = 25;

/** Where a session's table is, and the name it goes by there. */
function projectOf(cwd: string, dirs: TableDir[]): string {
  const dir = tableFor(cwd, dirs);
  return dir.id === 'elsewhere' ? (cwd.split('/').filter(Boolean).at(-1) ?? dir.name) : dir.name;
}

/** Sessions whose transcript stopped changing in the last day and that are no longer running. */
export function buildHistory(
  scanner: TranscriptScanner,
  live: Set<string>,
  liveNames: Set<string>,
  dirs: TableDir[],
  desktop: Map<string, DesktopMeta>,
  now: number,
): PastSession[] {
  const out: PastSession[] = [];
  for (const s of scanner.sessions()) {
    if (live.has(s.sessionId) || !s.cwd || s.cwd.endsWith(USAGE_CHECK_DIR) || isReviewCwd(s.cwd)) continue;
    let endedAt: number;
    try {
      endedAt = fs.statSync(s.file).mtimeMs;
    } catch {
      continue;
    }
    if (now - endedAt > HISTORY_MS) continue;
    const tail = cachedTail(s.file, 256 * 1024);
    if (!tail.model) continue; // never got a reply
    const meta = desktop.get(s.sessionId);
    const home = meta?.originCwd || s.cwd;
    const name = scanner.titleOf(s.sessionId) || meta?.title || tail.title || path.basename(home);
    // A resumed session gets a new transcript; its earlier one is not a separate ended session.
    if (liveNames.has(`${home}|${name}`)) continue;
    out.push({
      sessionId: s.sessionId,
      name,
      project: projectOf(home, dirs),
      inProject: tableFor(home, dirs).id !== 'elsewhere',
      cwd: home,
      branch: tail.branch,
      model: tail.model,
      endedAt,
      lastText: tail.lastText,
      prs: scanner.prsOf(s.sessionId),
      ...appLink(s.entrypoint, s.sessionId, meta?.hostId),
    });
  }
  return out.sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_HISTORY);
}

const lastBusy = new Map<string, number>();

/** The fresher of a live check and Claude's saved copy. */
export function pickUsage(live: LiveUsage, saved: ReturnType<typeof readPlanUsage>): Usage {
  const useLive = live.latest && (live.latest.fetchedAt ?? 0) >= (saved.fetchedAt ?? 0);
  const chosen = useLive ? live.latest! : saved;
  return {
    ...chosen,
    source: chosen.fetchedAt ? (useLive ? 'live' : 'saved') : undefined,
    checking: live.checking,
    problem: live.problem,
  };
}

export function collectSnapshot(
  paths: Paths,
  config: Config,
  scanner: TranscriptScanner,
  live: LiveUsage,
  now: number,
): Snapshot {
  const dirs = listTables(config.projectsRoot);
  const tables = new Map<string, Table>(dirs.map((d) => [d.id, { ...d, agents: [] }]));
  const desktop = readDesktopSessions(paths.desktopSessions);

  for (const s of readRegistry(paths.sessions)) {
    if (s.cwd.endsWith(USAGE_CHECK_DIR) || isReviewCwd(s.cwd)) continue; // the app's own usage check and Analyzer review
    const meta = (s.hostSessionId && desktop.get(s.hostSessionId)) || desktop.get(s.sessionId);
    const transcript = findTranscript(paths.projects, s.cwd, s.sessionId);
    const tail = transcript ? cachedTail(transcript, 256 * 1024) : {};
    const home = meta?.originCwd || s.cwd;
    const dir = tableFor(home, dirs);
    if (s.status === 'busy') lastBusy.set(s.sessionId, now);
    const recentlyBusy = now - (lastBusy.get(s.sessionId) ?? 0) < BUSY_GRACE_MS;
    const derived = deriveMainState({ ...s, tail, desktop: meta, recentlyBusy });
    const working = derived.state === 'working';
    const limit = (model?: string, tokens?: number) =>
      contextLimitFor(model, tokens, config.contextLimits, scanner.maxContext);

    const agent: MainAgent = {
      sessionId: s.sessionId,
      pid: s.pid,
      // A name Claude derived from the folder says nothing about the work, so a real title wins over it.
      name:
        (s.nameSource !== 'derived' && s.name) ||
        scanner.titleOf(s.sessionId) ||
        meta?.title ||
        tail.title ||
        s.name ||
        path.basename(home),
      cwd: home,
      entrypoint: s.entrypoint,
      ...appLink(s.entrypoint, s.sessionId, s.hostSessionId),
      prs: scanner.prsOf(s.sessionId),
      branch: tail.branch,
      model: tail.model,
      ...derived,
      // The desktop summary describes the last finished turn, so it is stale while a new one runs.
      summary: working ? undefined : meta?.statusDetail,
      activity: working ? tail.activity : undefined,
      output: tail.lastText,
      ask: tail.ask?.text || undefined,
      startedAt: s.startedAt,
      // The prompt that started a long turn is often beyond the tail, so prefer when the session went busy.
      turnStartedAt: working ? (s.statusUpdatedAt ?? tail.lastPromptAt) : undefined,
      lastActivityAt: tail.lastActivityAt,
      contextTokens: tail.contextTokens,
      tokensUsed: transcript ? tokensUsed(transcript) : undefined,
      contextLimit: limit(tail.model, tail.contextTokens),
      compactAt: compactPoint(limit(tail.model, tail.contextTokens)),
      contextLevel: contextLevelFor(tail.model, tail.contextTokens, config.contextAlerts ?? {}),
      subagents: (transcript ? readSubagents(transcript, s.startedAt, now) : []).map((sub) => ({
        ...sub,
        contextLimit: limit(sub.model, sub.contextTokens),
      })),
    };
    if (!tables.has(dir.id)) tables.set(dir.id, { ...ELSEWHERE, agents: [] });
    tables.get(dir.id)!.agents.push(agent);
  }

  const usage = pickUsage(live, readPlanUsage(paths.claudeJson));
  const names = new Map([...tables.values()].flatMap((t) => t.agents.map((a) => [a.sessionId, a.name] as [string, string])));
  usage.window = breakdown(scanner, usage, names, now);

  const liveIds = new Set([...tables.values()].flatMap((t) => t.agents.map((a) => a.sessionId)));
  const liveNames = new Set([...tables.values()].flatMap((t) => t.agents.map((a) => `${a.cwd}|${a.name}`)));
  const history = buildHistory(scanner, liveIds, liveNames, dirs, desktop, now);

  return {
    generatedAt: now,
    history,
    tables: [...tables.values()],
    usage,
    config,
  };
}
