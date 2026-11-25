import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';
import { ANALYZER_REVIEW_DIR } from '../../src/config.ts';

let tmp: string;
let home: string;
let claudeJsonPath: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-usage-'));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
  claudeJsonPath = path.join(tmp, '.claude.json');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const RECENT = '2026-11-23T10:00:00Z'; // inside 7 days
const OLDER = '2026-11-12T10:00:00Z'; // inside 30 days only
const run = (window: 7 | 30 = 30) => analyze({ claudeHome: home, claudeJsonPath, now: NOW, window });
const usageFindings = (window: 7 | 30 = 30) => run(window).findings.filter((f) => f.category === 'usage');

const row = (o: object) => JSON.stringify(o);
const reply = (id: string, ts: string, u: { input?: number; read?: number; write?: number; output?: number }, model = 'claude-sonnet-4-5') =>
  row({
    type: 'assistant',
    timestamp: ts,
    cwd: '/work/app',
    message: {
      id,
      model,
      usage: {
        input_tokens: u.input ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        cache_creation_input_tokens: u.write ?? 0,
        output_tokens: u.output ?? 0,
      },
    },
  });
const compact = (ts: string) => row({ type: 'user', timestamp: ts, isCompactSummary: true, message: { content: 'summary' } });

/** Writes a main transcript; the first row carries the project's cwd. */
function session(project: string, id: string, rows: string[], cwd = '/work/app'): void {
  const dir = path.join(home, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    [row({ type: 'user', timestamp: RECENT, cwd, message: { content: 'hi' } }), ...rows].join('\n') + '\n',
  );
}
function subagent(project: string, sessionId: string, agent: string, rows: string[]): void {
  const dir = path.join(home, 'projects', project, sessionId, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${agent}.jsonl`), rows.join('\n') + '\n');
}

describe('cache share', () => {
  it('flags a cache share under the limit with the numbers and a fix', () => {
    session('p', 's1', [reply('m1', RECENT, { input: 10_000, read: 10_000, write: 40_000 })]);
    const f = usageFindings().find((x) => x.id === 'usage/cache-share');
    expect(f?.detail).toContain('17%');
    expect(f?.fix).not.toBe('');
  });

  it('stays quiet at a healthy share', () => {
    session('p', 's1', [reply('m1', RECENT, { input: 5_000, read: 90_000, write: 5_000 })]);
    expect(usageFindings()).toEqual([]);
  });

  it('counts a reply once however many rows repeat it', () => {
    session('p', 's1', [
      reply('m1', RECENT, { input: 5_000, read: 90_000, write: 5_000 }),
      reply('m1', RECENT, { input: 5_000, read: 90_000, write: 5_000 }),
    ]);
    expect(run().usage.totalTokens).toBe(10_000);
  });
});

describe('large sessions', () => {
  it('flags a session whose context grew past the limit without compacting', () => {
    session('p', 'big', [reply('m1', RECENT, { input: 1_000, read: 350_000, write: 1_000 })]);
    const f = usageFindings().find((x) => x.id === 'usage/large-session:big');
    expect(f?.detail).toContain('352,000');
    expect(f?.project).toBe('/work/app');
  });

  it('does not flag one that compacted', () => {
    session('p', 'big', [compact(RECENT), reply('m1', RECENT, { input: 1_000, read: 350_000, write: 1_000 })]);
    expect(usageFindings()).toEqual([]);
  });
});

describe('model and subagent share', () => {
  it('flags Opus above half of all tokens', () => {
    session('p', 's1', [
      reply('m1', RECENT, { input: 10_000, output: 80_000, read: 900_000 }, 'claude-opus-4-5'),
      reply('m2', RECENT, { input: 20_000, read: 900_000 }),
    ]);
    const f = usageFindings().find((x) => x.id === 'usage/opus-share');
    expect(f?.detail).toContain('82%');
  });

  it('does not flag Opus at a small share', () => {
    session('p', 's1', [
      reply('m1', RECENT, { input: 10_000, read: 900_000 }, 'claude-opus-4-5'),
      reply('m2', RECENT, { input: 100_000, read: 900_000 }),
    ]);
    expect(usageFindings().find((x) => x.id === 'usage/opus-share')).toBeUndefined();
  });

  it('flags subagents above their limit, counting subagent transcripts', () => {
    session('p', 's1', [reply('m1', RECENT, { input: 30_000, read: 900_000 })]);
    subagent('p', 's1', 'a1', [reply('a-m1', RECENT, { input: 90_000, read: 900_000 })]);
    const f = usageFindings().find((x) => x.id === 'usage/subagent-share');
    expect(f?.detail).toContain('75%');
  });
});

describe('baseline overhead', () => {
  it('flags a high average context before the first message', () => {
    for (const id of ['a', 'b', 'c']) session('p', id, [reply(`m-${id}`, RECENT, { input: 1_000, read: 30_000, write: 29_000 })]);
    const f = usageFindings().find((x) => x.id === 'usage/baseline-overhead');
    expect(f?.detail).toContain('60,000');
  });

  it('needs a few sessions before judging', () => {
    session('p', 'a', [reply('m1', RECENT, { input: 1_000, read: 30_000, write: 29_000 })]);
    expect(usageFindings().find((x) => x.id === 'usage/baseline-overhead')).toBeUndefined();
  });
});

describe('windows and scope', () => {
  it('counts only replies inside the window and leaves setup findings unchanged', () => {
    fs.writeFileSync(path.join(home, 'settings.json.bak-1'), '{}');
    session('p', 's1', [reply('m1', RECENT, { input: 1_000 }), reply('m2', OLDER, { input: 5_000 })]);
    expect(run(7).usage.totalTokens).toBe(1_000);
    expect(run(30).usage.totalTokens).toBe(6_000);
    expect(run(7).findings.filter((f) => f.category === 'hygiene')).toEqual(run(30).findings.filter((f) => f.category === 'hygiene'));
    expect(run(7).window).toBe(7);
  });

  it('leaves out transcripts from the analyzer review folder', () => {
    session('review', 's1', [reply('m1', RECENT, { input: 9_000 })], ANALYZER_REVIEW_DIR);
    session('app', 's2', [reply('m2', RECENT, { input: 1_000 })]);
    const u = run().usage;
    expect(u.totalTokens).toBe(1_000);
    expect(u.byProject.map((p) => p.project)).toEqual(['/work/app']);
  });

  it('still counts a project whose folder is gone', () => {
    session('gone', 's1', [reply('m1', RECENT, { input: 2_000 })], '/no/such/folder');
    expect(run().usage.byProject).toMatchObject([{ project: '/no/such/folder', tokens: 2_000 }]);
  });
});

describe('projects without a recorded folder', () => {
  it('still counts a project folder whose transcripts have no cwd, labelled by the folder name', () => {
    const dir = path.join(home, 'projects', '-Users-me-lost');
    fs.mkdirSync(dir, { recursive: true });
    const noCwd = JSON.parse(reply('m1', RECENT, { input: 2_000 }));
    delete noCwd.cwd;
    fs.writeFileSync(path.join(dir, 's1.jsonl'), JSON.stringify(noCwd) + '\n');
    session('app', 's2', [reply('m2', RECENT, { input: 1_000 })]);
    const u = run().usage;
    expect(u.totalTokens).toBe(3_000);
    expect(u.byProject).toMatchObject([{ project: '-Users-me-lost', tokens: 2_000 }, { project: '/work/app', tokens: 1_000 }]);
  });
});

describe('breakdown', () => {
  it('splits tokens by project, model family and session, biggest first', () => {
    session('a', 's1', [reply('m1', RECENT, { input: 1_000, output: 500 }, 'claude-opus-4-5')]);
    session('b', 's2', [reply('m2', RECENT, { input: 3_000, write: 1_000 })], '/work/other');
    subagent('b', 's2', 'x', [reply('x1', RECENT, { input: 500 })]);
    const u = run().usage;
    expect(u.totalTokens).toBe(6_000);
    expect(u.byProject).toMatchObject([{ project: '/work/other', tokens: 4_500 }, { project: '/work/app', tokens: 1_500 }]);
    expect(u.byModel).toMatchObject([{ model: 'sonnet', tokens: 4_500 }, { model: 'opus', tokens: 1_500 }]);
    expect(u.bySession).toMatchObject([
      { sessionId: 's2', tokens: 4_500, subagentTokens: 500 },
      { sessionId: 's1', tokens: 1_500, subagentTokens: 0 },
    ]);
  });
});
