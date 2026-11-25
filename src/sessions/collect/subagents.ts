import fs from 'node:fs';
import path from 'node:path';
import type { SubAgent } from '../types.ts';
import { tokensUsed } from './tokens.ts';
import { cachedTail } from './transcript.ts';

export const STALLED_AFTER_MS = 10 * 60_000;
/** A session can run hundreds of subagents; keep the most recent finished ones. */
const MAX_FINISHED = 40;

/** Subagents of one live session, from <session>/subagents/agent-<id>.meta.json and its transcript. */
export function readSubagents(transcriptPath: string, sessionStartedAt: number, now: number): SubAgent[] {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: SubAgent[] = [];
  for (const name of names) {
    const id = /^agent-(.+)\.meta\.json$/.exec(name)?.[1];
    if (!id) continue;
    const jsonl = path.join(dir, `agent-${id}.jsonl`);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(jsonl);
    } catch {
      continue;
    }
    // Anything last written before this process started belongs to an earlier run of the session.
    if (stat.mtimeMs < sessionStartedAt) continue;
    const quietFor = now - stat.mtimeMs;

    let meta: any;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    const finished = meta.finished === true;

    const tail = cachedTail(jsonl, 64 * 1024);
    out.push({
      id,
      parentAgentId: meta.parentAgentId,
      type: meta.agentType ?? 'agent',
      description: meta.description ?? '',
      model: tail.model ?? meta.model,
      state: finished ? 'finished' : quietFor > STALLED_AFTER_MS ? 'stalled' : 'working',
      startedAt: stat.birthtimeMs,
      endedAt: finished ? stat.mtimeMs : undefined,
      lastActivityAt: stat.mtimeMs,
      contextTokens: tail.contextTokens,
      tokensUsed: tokensUsed(jsonl),
    });
  }
  out.sort((a, b) => a.startedAt - b.startedAt);
  const finished = out.filter((s) => s.state === 'finished');
  const dropped = new Set(finished.slice(0, Math.max(0, finished.length - MAX_FINISHED)));
  return out.filter((s) => !dropped.has(s));
}
