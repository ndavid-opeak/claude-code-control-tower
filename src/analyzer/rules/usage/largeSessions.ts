import type { Rule } from '../types.ts';
import { num } from './format.ts';
import { scanUsage } from './scan.ts';

/** A session whose context grew past this many tokens without compacting is flagged. */
export const LARGE_CONTEXT_TOKENS = 300_000;
const MAX_FINDINGS = 5;

export const largeSessions: Rule = (ctx) =>
  scanUsage(ctx)
    .sessions.filter((s) => s.peakContext >= LARGE_CONTEXT_TOKENS && !s.compacted)
    .sort((a, b) => b.peakContext - a.peakContext)
    .slice(0, MAX_FINDINGS)
    .map((s) => ({
      id: `usage/large-session:${s.sessionId}`,
      severity: 'medium' as const,
      title: `Session ${s.sessionId.slice(0, 8)} grew to ${num(s.peakContext)} tokens without compacting`,
      detail: `Its context reached ${num(s.peakContext)} tokens (limit ${num(LARGE_CONTEXT_TOKENS)}) and it never compacted, so every reply re-reads all of it.`,
      project: s.project,
      fix: 'Run /compact when a task is done, or start a new session with /clear for the next task.',
    }));
