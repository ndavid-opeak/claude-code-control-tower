import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTables, tableFor } from '../../src/sessions/collect/projects.ts';
import { readRegistry } from '../../src/sessions/collect/registry.ts';
import { readSubagents } from '../../src/sessions/collect/subagents.ts';
import { tokensUsed } from '../../src/sessions/collect/tokens.ts';
import { slugFor, summarizeTail } from '../../src/sessions/collect/transcript.ts';
import { LiveUsage, parsePlanUsage, parseRateLimitEvent, TranscriptScanner } from '../../src/sessions/collect/usage.ts';
import { appLink, breakdown, buildHistory, compactPoint, contextLimitFor, deriveMainState, pickUsage } from '../../src/sessions/state.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const row = (o: object) => JSON.stringify(o);
const assistant = (id: string, ts: string, extra: object = {}, content: object[] = []) =>
  row({
    type: 'assistant',
    timestamp: ts,
    message: {
      id,
      model: 'claude-fable-5-2',
      content,
      usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 },
      ...extra,
    },
  });
const prompt = (ts: string) =>
  row({ type: 'user', timestamp: ts, origin: { kind: 'human' }, message: { content: 'hello' } });
const toolResult = (id: string, ts: string) =>
  row({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id }] } });

describe('slugFor', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(slugFor('/Users/me/.claude/my app')).toBe('-Users-me--claude-my-app');
  });
});

describe('summarizeTail', () => {
  it('reads context size, model and branch from the last assistant row', () => {
    const s = summarizeTail([
      row({ type: 'user', timestamp: '2026-11-24T10:00:00Z', gitBranch: 'main', origin: { kind: 'human' }, message: { content: 'x' } }),
      assistant('m1', '2026-11-24T10:00:05Z', { stop_reason: 'end_turn' }),
    ]);
    expect(s.contextTokens).toBe(1210);
    expect(s.model).toBe('claude-fable-5-2');
    expect(s.branch).toBe('main');
    expect(s.turnEndedAt).toBe(Date.parse('2026-11-24T10:00:05Z'));
    expect(s.lastPromptAt).toBe(Date.parse('2026-11-24T10:00:00Z'));
  });

  it('flags an unanswered question, and clears it once answered', () => {
    const ask = assistant('m1', '2026-11-24T10:00:05Z', { stop_reason: 'tool_use' }, [
      { type: 'tool_use', id: 't1', name: 'AskUserQuestion' },
    ]);
    expect(summarizeTail([ask]).ask?.kind).toBe('question');
    expect(summarizeTail([ask, toolResult('t1', '2026-11-24T10:01:00Z')]).ask).toBeUndefined();
  });

  it('flags a plan waiting for approval but not an ordinary tool call', () => {
    const plan = assistant('m1', '2026-11-24T10:00:05Z', {}, [{ type: 'tool_use', id: 't1', name: 'ExitPlanMode' }]);
    const bash = assistant('m2', '2026-11-24T10:00:06Z', {}, [{ type: 'tool_use', id: 't2', name: 'Bash' }]);
    expect(summarizeTail([plan]).ask?.kind).toBe('plan');
    expect(summarizeTail([bash]).ask).toBeUndefined();
    expect(summarizeTail([bash]).activity).toBe('Bash');
  });

  it('treats a new prompt as the start of a new turn', () => {
    const s = summarizeTail([
      assistant('m1', '2026-11-24T10:00:05Z', { stop_reason: 'end_turn' }, [
        { type: 'tool_use', id: 't1', name: 'AskUserQuestion' },
      ]),
      prompt('2026-11-24T10:05:00Z'),
    ]);
    expect(s.turnEndedAt).toBeUndefined();
    expect(s.ask).toBeUndefined();
  });

  it('keeps the question with its options, and the latest message of the turn', () => {
    const s = summarizeTail([
      prompt('2026-11-24T10:00:00Z'),
      assistant('m0', '2026-11-24T10:00:01Z', {}, [{ type: 'text', text: 'Earlier note' }]),
      assistant('m1', '2026-11-24T10:00:05Z', {}, [{ type: 'text', text: ' Two ways to do this. ' }]),
      assistant('m1', '2026-11-24T10:00:05Z', {}, [
        { type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [{ question: 'Which one?', options: [{ label: 'Fast' }, { label: 'Safe' }] }] } },
      ]),
    ]);
    expect(s.lastText).toBe('Two ways to do this.');
    expect(s.ask?.text).toBe('Which one?\n  - Fast\n  - Safe');
    expect(summarizeTail([assistant('m1', '2026-11-24T10:00:05Z', {}, [{ type: 'text', text: 'Old' }]), prompt('2026-11-24T10:05:00Z')]).lastText).toBeUndefined();
  });

  it('ignores synthetic rows and broken lines', () => {
    const s = summarizeTail(['{broken', assistant('m1', '2026-11-24T10:00:05Z'), assistant('m2', '2026-11-24T10:00:06Z', { model: '<synthetic>', usage: {} })]);
    expect(s.contextTokens).toBe(1210);
  });
});

describe('deriveMainState', () => {
  const ended = Date.parse('2026-11-24T11:00:00Z');
  const base = { status: 'idle', tail: {} };

  it('puts a waiting session ahead of everything', () => {
    const r = deriveMainState({ ...base, status: 'waiting', waitingFor: 'permission prompt' });
    expect(r).toMatchObject({ state: 'waiting', reason: 'Permission prompt' });
  });
  it('puts an open question ahead of busy', () => {
    const r = deriveMainState({ ...base, status: 'busy', tail: { ask: { kind: 'question', text: 'Which?' } } });
    expect(r).toMatchObject({ state: 'waiting', reason: 'Asked you a question' });
  });
  it('is working when busy, and for a moment after', () => {
    expect(deriveMainState({ ...base, status: 'busy', desktop: { statusCategory: 'blocked' } }).state).toBe('working');
    expect(deriveMainState({ ...base, recentlyBusy: true, tail: { turnEndedAt: ended } }).state).toBe('working');
  });
  it('waits when the desktop app says the session is blocked or needs an action', () => {
    expect(deriveMainState({ ...base, desktop: { statusCategory: 'blocked' } }).state).toBe('waiting');
    expect(deriveMainState({ ...base, desktop: { interrupted: true } }).state).toBe('waiting');
    expect(deriveMainState({ ...base, desktop: { statusCategory: 'completed', needsAction: 'Approve the PR' } })).toMatchObject({
      state: 'waiting',
      reason: 'Approve the PR',
    });
  });
  it('is done, never waiting, once a turn has finished with nothing open', () => {
    const tail = { turnEndedAt: ended, lastText: 'All set. Want me to open a PR as well?' };
    expect(deriveMainState({ ...base, tail })).toEqual({ state: 'done', since: ended });
    expect(deriveMainState({ ...base, tail, desktop: { statusCategory: 'review_ready', needsAction: '' } }).state).toBe('done');
  });
  it('is idle when nothing has happened yet', () => {
    expect(deriveMainState(base).state).toBe('idle');
  });
});

describe('contextLimitFor', () => {
  it('uses 1M for the models documented as 1M', () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'claude-opus-4-7']) {
      expect(contextLimitFor(m, 50_000, {})).toBe(1_000_000);
    }
  });
  it('uses 200k for older models unless they have been seen above it', () => {
    expect(contextLimitFor('claude-sonnet-4-6', 50_000, {})).toBe(200_000);
    expect(contextLimitFor('claude-sonnet-4-20250514', 50_000, {})).toBe(200_000);
    expect(contextLimitFor('claude-sonnet-4-6', 250_000, {})).toBe(1_000_000);
    expect(contextLimitFor('claude-sonnet-4-6', 50_000, {}, { sonnet: 300_000 })).toBe(1_000_000);
    expect(contextLimitFor(undefined, undefined, {})).toBe(200_000);
  });
  it('lets an override win, by model id before family', () => {
    expect(contextLimitFor('claude-opus-5-5', 50_000, { opus: 500_000 })).toBe(500_000);
    expect(contextLimitFor('claude-opus-5-5', 50_000, { 'claude-opus-5-5': 300_000, opus: 500_000 })).toBe(300_000);
  });
});

describe('parsePlanUsage', () => {
  it('reads the session and week windows from the copy Claude saved', () => {
    const u = parsePlanUsage({
      cachedUsageUtilization: {
        fetchedAtMs: 123,
        utilization: {
          five_hour: { utilization: 42, resets_at: '2026-11-24T15:00:00Z' },
          seven_day: { utilization: 7, resets_at: null },
          seven_day_opus: null,
        },
      },
    });
    expect(u.session).toEqual({ percent: 42, resetsAt: Date.parse('2026-11-24T15:00:00Z') });
    expect(u.week).toEqual({ percent: 7, resetsAt: undefined });
    expect(u.fetchedAt).toBe(123);
  });
  it('returns nothing when the cache is absent', () => {
    expect(parsePlanUsage({})).toEqual({ session: undefined, week: undefined, fetchedAt: undefined });
  });
});

describe('parseRateLimitEvent', () => {
  const event = row({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      unifiedWindows: {
        five_hour: { utilization: 0.59, resetsAt: 1795542000, status: 'allowed' },
        seven_day: { utilization: 0.31, resetsAt: 1795690800, status: 'allowed' },
      },
    },
  });
  it('turns the live event into percentages and millisecond reset times', () => {
    const u = parseRateLimitEvent([row({ type: 'system', subtype: 'init' }), '{broken', event].join('\n'));
    expect(u).toEqual({
      session: { percent: 59, resetsAt: 1795542000000 },
      week: { percent: 31, resetsAt: 1795690800000 },
    });
  });
  it('returns nothing when Claude reports no limit windows', () => {
    expect(parseRateLimitEvent(row({ type: 'result', result: 'OK' }))).toBeUndefined();
    expect(parseRateLimitEvent(row({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toBeUndefined();
  });
});

describe('pickUsage', () => {
  const saved = { session: { percent: 25 }, week: { percent: 20 }, fetchedAt: 1000 };
  it('prefers a live check that is newer than the saved copy', () => {
    const live = new LiveUsage();
    live.latest = { session: { percent: 59 }, week: { percent: 31 }, fetchedAt: 2000 };
    expect(pickUsage(live, saved)).toMatchObject({ session: { percent: 59 }, source: 'live', checking: false });
  });
  it('falls back to the saved copy and passes on why the live check failed', () => {
    const live = new LiveUsage();
    live.problem = 'The usage check did not finish. It will be tried again.';
    expect(pickUsage(live, saved)).toMatchObject({ session: { percent: 25 }, source: 'saved', problem: live.problem });
    expect(pickUsage(new LiveUsage(), {}).source).toBeUndefined();
  });
});

describe('TranscriptScanner', () => {
  it('collects titles and the largest context per model, reading only new bytes on a rescan', async () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const dir = path.join(tmp, 'proj');
    fs.mkdirSync(dir);
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(
      file,
      [
        assistant('m1', '2026-11-24T10:00:00Z'),
        assistant('m2', '2026-11-24T11:00:00Z', { model: 'claude-opus-5-5' }),
        row({ type: 'ai-title', aiTitle: 'Fix login' }),
      ].join('\n') + '\n',
    );
    fs.utimesSync(file, now / 1000, now / 1000);
    const scanner = new TranscriptScanner(tmp);
    await scanner.scan(now);
    expect(scanner.maxContext).toEqual({ fable: 1210, opus: 1210 });
    expect(scanner.titleOf('s')).toBe('Fix login');

    const big = { usage: { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    fs.appendFileSync(file, assistant('m3', '2026-11-24T11:30:00Z', big) + '\n' + row({ type: 'custom-title', customTitle: 'Login bug' }) + '\n');
    fs.utimesSync(file, now / 1000, now / 1000);
    await scanner.scan(now);
    expect(scanner.maxContext.fable).toBe(5000);
    expect(scanner.titleOf('s')).toBe('Login bug');
  });
});

describe('readRegistry', () => {
  it('lists live sessions and never opens key files or dead pids', () => {
    fs.writeFileSync(path.join(tmp, '11.json'), row({ pid: 11, sessionId: 'a', cwd: '/x', startedAt: 2, status: 'busy' }));
    fs.writeFileSync(path.join(tmp, '12.json'), row({ pid: 12, sessionId: 'b', cwd: '/y', startedAt: 1, status: 'idle' }));
    fs.writeFileSync(path.join(tmp, '13.json'), row({ pid: 13, sessionId: 'dead', cwd: '/z', startedAt: 3 }));
    fs.writeFileSync(path.join(tmp, '11.abc.key'), 'not json');
    const live = readRegistry(tmp, (pid) => pid !== 13);
    expect(live.map((s) => s.sessionId)).toEqual(['b', 'a']);
    expect(live[1].status).toBe('busy');
  });
});

describe('tables', () => {
  it('lists visible folders in order and maps a cwd to its table', () => {
    for (const d of ['beta', 'alpha', '.hidden']) fs.mkdirSync(path.join(tmp, d));
    fs.writeFileSync(path.join(tmp, 'notes.md'), '');
    const tables = listTables(tmp);
    expect(tables.map((t) => t.name)).toEqual(['alpha', 'beta']);
    expect(tableFor(path.join(tmp, 'alpha', 'src'), tables).id).toBe('alpha');
    expect(tableFor(path.join(tmp, 'alphabet'), tables).id).toBe('elsewhere');
  });
});

describe('readSubagents', () => {
  it('shows running and finished subagents from this run of the session, and marks quiet ones stalled', () => {
    const now = Date.now();
    const transcript = path.join(tmp, 'sess.jsonl');
    const dir = path.join(tmp, 'sess', 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const add = (id: string, meta: object, quietMs: number) => {
      fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
      const f = path.join(dir, `agent-${id}.jsonl`);
      fs.writeFileSync(f, assistant(id, new Date(now).toISOString()) + '\n');
      fs.utimesSync(f, (now - quietMs) / 1000, (now - quietMs) / 1000);
    };
    add('run', { agentType: 'Explore', description: 'Map files' }, 1000);
    add('fresh', { agentType: 'Plan', finished: true }, 30_000);
    add('gone', { agentType: 'Plan', finished: true }, 5 * 60_000);
    add('quiet', { agentType: 'general-purpose' }, 20 * 60_000);
    add('before', { agentType: 'Explore' }, 50 * 60_000);

    const subs = readSubagents(transcript, now - 40 * 60_000, now);
    const byId = Object.fromEntries(subs.map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['fresh', 'gone', 'quiet', 'run']);
    expect(byId.run).toMatchObject({ state: 'working', type: 'Explore', description: 'Map files', contextTokens: 1210 });
    expect(byId.fresh.state).toBe('finished');
    expect(byId.quiet.state).toBe('stalled');
  });
});

describe('appLink', () => {
  it('links desktop sessions by their desktop id and VS Code sessions by their session id', () => {
    expect(appLink('claude-desktop', 'c79f', 'local_b892')).toEqual({ app: 'desktop', openUrl: 'claude://code/continue?session=local_b892' });
    expect(appLink('claude-desktop', 'c79f')).toEqual({ app: 'desktop', openUrl: undefined });
    expect(appLink('claude-vscode', '95a8-1')).toEqual({ app: 'vscode', openUrl: 'vscode://anthropic.claude-code/open?session=95a8-1' });
    expect(appLink('cli', 'a910')).toEqual({ app: 'terminal' });
    expect(appLink(undefined, 'x')).toEqual({ app: 'other' });
  });
});

describe('usage breakdown', () => {
  it('counts recent tokens per session and model, puts subagents in their session, and names closed sessions', async () => {
    const now = Date.now();
    const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(proj, 'live', 'subagents'), { recursive: true });
    const write = (file: string, lines: string[]) => {
      fs.writeFileSync(file, lines.join('\n') + '\n');
    };
    write(path.join(proj, 'live.jsonl'), [
      assistant('a1', at(30)),
      assistant('a1', at(30)), // same reply, second row: counted once
      assistant('a2', at(400)), // before the window
    ]);
    write(path.join(proj, 'live', 'subagents', 'agent-x.jsonl'), [assistant('s1', at(20), { model: 'claude-haiku-5-5' })]);
    write(path.join(proj, 'old.jsonl'), [row({ type: 'ai-title', aiTitle: 'Old work' }), assistant('o1', at(10), { model: 'claude-opus-5-5' })]);
    const scanner = new TranscriptScanner(tmp);
    await scanner.scan(now);

    const usage = { session: { percent: 50, resetsAt: now + 3 * 3_600_000 }, checking: false };
    const b = breakdown(scanner, usage, new Map([['live', 'My session']]), now);
    expect(b.since).toBe(now - 2 * 3_600_000);
    expect(b.byModel).toEqual({ fable: 260, haiku: 260, opus: 260 });
    expect(b.total).toBe(780);
    expect(b.sessions).toEqual([
      { sessionId: 'live', name: 'My session', live: true, tokens: 520 },
      { sessionId: 'old', name: 'Closed: Old work', live: false, tokens: 260 },
    ]);
  });

  it('places auto-compact near 967k for 1M windows and at the window otherwise', () => {
    expect(compactPoint(1_000_000)).toBe(967_000);
    expect(compactPoint(200_000)).toBe(200_000);
  });
});

describe('tokensUsed', () => {
  it('counts each reply once, skips cache reads, and reads only new rows later', () => {
    const file = path.join(tmp, 'agent.jsonl');
    fs.writeFileSync(file, [assistant('m1', '2026-11-24T10:00:00Z'), assistant('m1', '2026-11-24T10:00:00Z')].join('\n') + '\n');
    expect(tokensUsed(file)).toBe(260); // 10 input + 50 output + 200 cache writes
    fs.appendFileSync(file, assistant('m2', '2026-11-24T10:01:00Z') + '\n' + '{"type":"assistant","partial');
    expect(tokensUsed(file)).toBe(520);
    expect(tokensUsed(path.join(tmp, 'missing.jsonl'))).toBeUndefined();
  });
});

describe('session history and pull requests', () => {
  it('lists recently ended sessions with their PRs, and leaves out live ones and resumed copies', async () => {
    const now = Date.now();
    const proj = path.join(tmp, 'projects', 'repo');
    fs.mkdirSync(proj, { recursive: true });
    const rows = (cwd: string, title: string, extra: string[] = []) =>
      [
        row({ type: 'user', timestamp: new Date(now).toISOString(), cwd, entrypoint: 'claude-vscode', gitBranch: 'main', origin: { kind: 'human' }, message: { content: 'go' } }),
        row({ type: 'ai-title', aiTitle: title }),
        assistant('r-' + title, new Date(now).toISOString(), {}, [{ type: 'text', text: `Finished ${title}` }]),
        ...extra,
      ].join('\n') + '\n';
    const pr = (n: number) => row({ type: 'pr-link', prNumber: n, prUrl: `https://github.com/o/r/pull/${n}`, prRepository: 'o/r' });
    fs.writeFileSync(path.join(proj, 'ended.jsonl'), rows('/work/repo', 'Fix login', [pr(4), pr(4), pr(7)]));
    fs.writeFileSync(path.join(proj, 'live.jsonl'), rows('/work/repo', 'Running now'));
    fs.writeFileSync(path.join(proj, 'earlier-run.jsonl'), rows('/work/repo', 'Running now'));
    const scanner = new TranscriptScanner(path.join(tmp, 'projects'));
    await scanner.scan(now);

    const dirs = [{ id: 'repo', name: 'repo', path: '/work/repo' }];
    const h = buildHistory(scanner, new Set(['live']), new Set(['/work/repo|Running now']), dirs, new Map(), now + 1000);
    expect(h.map((s) => s.sessionId)).toEqual(['ended']);
    expect(h[0]).toMatchObject({
      name: 'Fix login',
      project: 'repo',
      branch: 'main',
      lastText: 'Finished Fix login',
      app: 'vscode',
      openUrl: 'vscode://anthropic.claude-code/open?session=ended',
    });
    expect(h[0].prs.map((p) => p.number)).toEqual([4, 7]);
    expect(scanner.prsOf('live')).toEqual([]);
  });
});
