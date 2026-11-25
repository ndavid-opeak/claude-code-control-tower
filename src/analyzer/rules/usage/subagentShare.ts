import type { Rule } from '../types.ts';
import { pct } from './format.ts';
import { scanUsage } from './scan.ts';

/** Flagged above this share of tokens spent in subagents. */
export const MAX_SUBAGENT_SHARE = 0.4;
const MIN_TOKENS = 100_000;

export const subagentShare: Rule = (ctx) => {
  const { breakdown, subagentTokens } = scanUsage(ctx);
  if (breakdown.totalTokens < MIN_TOKENS) return [];
  const share = subagentTokens / breakdown.totalTokens;
  if (share <= MAX_SUBAGENT_SHARE) return [];
  return [
    {
      id: 'usage/subagent-share',
      severity: 'low',
      title: `Subagents used ${pct(share)} of tokens`,
      detail: `In the last ${ctx.window} days subagents used ${pct(share)} of all tokens (limit ${pct(MAX_SUBAGENT_SHARE)}). Each one starts with its own full setup overhead.`,
      fix: 'Give subagents narrow tasks, run fewer in parallel, and set a cheaper model on agents that only search or read.',
    },
  ];
};
