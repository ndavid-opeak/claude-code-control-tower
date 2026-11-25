import type { Rule } from '../types.ts';
import { pct } from './format.ts';
import { scanUsage } from './scan.ts';

/** Flagged above this share of tokens on Opus. */
export const MAX_OPUS_SHARE = 0.5;
const MIN_TOKENS = 100_000;

export const opusShare: Rule = (ctx) => {
  const { breakdown, byModel } = scanUsage(ctx);
  if (breakdown.totalTokens < MIN_TOKENS) return [];
  const share = (byModel.get('opus') ?? 0) / breakdown.totalTokens;
  if (share <= MAX_OPUS_SHARE) return [];
  return [
    {
      id: 'usage/opus-share',
      severity: 'medium',
      title: `Opus used ${pct(share)} of tokens`,
      detail: `In the last ${ctx.window} days Opus produced ${pct(share)} of all tokens (limit ${pct(MAX_OPUS_SHARE)}). It uses your plan limit fastest.`,
      fix: 'Default to Sonnet (/model sonnet) and switch to Opus only for hard planning or debugging.',
    },
  ];
};
