import type { Rule } from '../types.ts';
import { num } from './format.ts';
import { scanUsage } from './scan.ts';

/** Flagged when sessions already use more than this many tokens at their first reply, on average. */
export const MAX_BASELINE_TOKENS = 40_000;
/** Fewer sessions than this is too few to average. */
const MIN_SESSIONS = 3;

export const baselineOverhead: Rule = (ctx) => {
  const baselines = scanUsage(ctx).sessions.flatMap((s) => (s.baseline === undefined ? [] : [s.baseline]));
  if (baselines.length < MIN_SESSIONS) return [];
  const avg = baselines.reduce((a, b) => a + b, 0) / baselines.length;
  if (avg <= MAX_BASELINE_TOKENS) return [];
  return [
    {
      id: 'usage/baseline-overhead',
      severity: 'medium',
      title: `Sessions start with ${num(avg)} tokens already used`,
      detail: `Across ${baselines.length} sessions in the last ${ctx.window} days, the first reply already carried ${num(avg)} tokens on average (limit ${num(MAX_BASELINE_TOKENS)}): instructions, tools, skills and MCP servers.`,
      fix: 'Trim CLAUDE.md files, disable plugins and MCP servers you do not use, and see the Context load findings for the biggest loads.',
    },
  ];
};
