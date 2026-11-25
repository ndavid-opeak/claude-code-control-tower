import fs from 'node:fs';
import path from 'node:path';
import { familyOf } from '../../../sessions/collect/usage.ts';
import { listProjects } from '../../projects.ts';
import { isReviewCwd } from '../../review.ts';
import type { UsageBreakdown } from '../../types.ts';
import type { RuleContext } from '../types.ts';

const DAY = 24 * 3_600_000;
/** Sessions listed in the breakdown. */
const TOP_SESSIONS = 20;

export interface SessionUsage {
  sessionId: string;
  project: string;
  /** Input, output and cache writes of the main transcript and its subagents. */
  tokens: number;
  subagentTokens: number;
  peakContext: number;
  compacted: boolean;
  /** Context size of the session's first reply, when that reply is inside the window. */
  baseline?: number;
}

export interface UsageScan {
  breakdown: UsageBreakdown;
  sessions: SessionUsage[];
  /** Tokens by model family. */
  byModel: Map<string, number>;
  subagentTokens: number;
  /** Input-side tokens: fresh input, cache reads and cache writes. */
  inputSide: number;
}

const cache = new WeakMap<RuleContext, UsageScan>();

/** Reads the transcripts in the window once per run; every usage rule and the report share the result. */
export function scanUsage(ctx: RuleContext): UsageScan {
  let scan = cache.get(ctx);
  if (!scan) {
    scan = readUsage(ctx);
    cache.set(ctx, scan);
  }
  return scan;
}

function readUsage(ctx: RuleContext): UsageScan {
  const since = ctx.now - ctx.window * DAY;
  const sessions: SessionUsage[] = [];
  const byModel = new Map<string, number>();
  const byProject = new Map<string, { tokens: number; sessions: number }>();
  let totalTokens = 0;
  let subagentTokens = 0;
  let cacheRead = 0;
  let inputSide = 0;

  for (const project of listProjects(ctx.claudeHome)) {
    if (isReviewCwd(project.path)) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(project.transcriptsDir);
    } catch {}
    for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
      const sessionId = name.slice(0, -'.jsonl'.length);
      const main = readTranscript(path.join(project.transcriptsDir, name), since, true);
      const subs = subagentFiles(path.join(project.transcriptsDir, sessionId, 'subagents')).map((f) => readTranscript(f, since, false));
      const parts = [main, ...subs];
      const tokens = parts.reduce((n, p) => n + p.tokens, 0);
      if (tokens === 0 && main.replies === 0) continue;
      const sub = subs.reduce((n, p) => n + p.tokens, 0);
      for (const p of parts) {
        for (const [family, n] of p.byFamily) byModel.set(family, (byModel.get(family) ?? 0) + n);
        cacheRead += p.cacheRead;
        inputSide += p.inputSide;
      }
      totalTokens += tokens;
      subagentTokens += sub;
      const proj = byProject.get(project.path) ?? { tokens: 0, sessions: 0 };
      byProject.set(project.path, { tokens: proj.tokens + tokens, sessions: proj.sessions + 1 });
      sessions.push({
        sessionId,
        project: project.path,
        tokens,
        subagentTokens: sub,
        peakContext: main.peakContext,
        compacted: main.compacted,
        baseline: main.baseline,
      });
    }
  }

  const biggestFirst = <T extends { tokens: number }>(a: T, b: T) => b.tokens - a.tokens;
  const breakdown: UsageBreakdown = {
    window: ctx.window,
    totalTokens,
    cacheShare: inputSide > 0 ? cacheRead / inputSide : null,
    byProject: [...byProject].map(([project, v]) => ({ project, ...v })).sort(biggestFirst),
    byModel: [...byModel].map(([model, tokens]) => ({ model, tokens })).sort(biggestFirst),
    bySession: [...sessions]
      .sort(biggestFirst)
      .slice(0, TOP_SESSIONS)
      .map(({ sessionId, project, tokens, subagentTokens, peakContext, compacted }) => ({
        sessionId,
        project,
        tokens,
        subagentTokens,
        peakContext,
        compacted,
      })),
  };
  return { breakdown, sessions, byModel, subagentTokens, inputSide };
}

function subagentFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.jsonl'))
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

interface Transcript {
  /** Replies counted (inside the window). */
  replies: number;
  tokens: number;
  byFamily: Map<string, number>;
  cacheRead: number;
  inputSide: number;
  peakContext: number;
  compacted: boolean;
  baseline?: number;
}

/** Each reply is counted once (Claude Code repeats a reply's usage on every row it writes for it). */
function readTranscript(file: string, since: number, isMain: boolean): Transcript {
  const t: Transcript = { replies: 0, tokens: 0, byFamily: new Map(), cacheRead: 0, inputSide: 0, peakContext: 0, compacted: false };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return t;
  }
  const seen = new Set<string>();
  let first = true;
  for (const line of text.split('\n')) {
    if (isMain && line.includes('"isCompactSummary":true')) t.compacted = true;
    if (!line.includes('"usage"')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = row.message;
    if (row.type !== 'assistant' || !msg?.usage || !msg.id || msg.model === '<synthetic>' || seen.has(msg.id)) continue;
    seen.add(msg.id);
    const u = msg.usage;
    const input = u.input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    const write = u.cache_creation_input_tokens ?? 0;
    const context = input + read + write;
    const at = Date.parse(row.timestamp);
    const inWindow = !Number.isNaN(at) && at >= since;
    if (isMain && first && inWindow) t.baseline = context;
    first = false;
    if (!inWindow) continue;
    const tokens = input + (u.output_tokens ?? 0) + write;
    t.replies++;
    t.tokens += tokens;
    t.cacheRead += read;
    t.inputSide += context;
    if (isMain && context > t.peakContext) t.peakContext = context;
    const family = familyOf(msg.model ?? '');
    t.byFamily.set(family, (t.byFamily.get(family) ?? 0) + tokens);
  }
  return t;
}
