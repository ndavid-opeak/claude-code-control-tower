import type { Rule } from '../types.ts';
import { pct } from './format.ts';
import { scanUsage } from './scan.ts';

/** Flagged below this share of input read from the cache. */
export const MIN_CACHE_SHARE = 0.8;
/** Below this much input there is too little to judge. */
const MIN_INPUT_TOKENS = 50_000;

/** Cache reads as a share of all input-side tokens. */
export const cacheShare: Rule = (ctx) => {
  const { breakdown, inputSide } = scanUsage(ctx);
  if (breakdown.cacheShare === null || inputSide < MIN_INPUT_TOKENS || breakdown.cacheShare >= MIN_CACHE_SHARE) return [];
  return [
    {
      id: 'usage/cache-share',
      severity: 'medium',
      title: `Only ${pct(breakdown.cacheShare)} of input comes from the cache`,
      detail: `In the last ${ctx.window} days ${pct(breakdown.cacheShare)} of input tokens were cache reads (limit ${pct(MIN_CACHE_SHARE)}). The rest was paid for in full or written to the cache again.`,
      fix: 'Keep the start of the prompt stable: do not edit CLAUDE.md, switch models or change MCP servers in the middle of a session, and avoid pauses over 5 minutes that let the cache expire.',
    },
  ];
};
