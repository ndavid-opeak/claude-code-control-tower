import type { ContextAlert } from './types.ts';

/**
 * Where long contexts start to hurt, in tokens, per model family. There is no official number: community
 * reports put the slip around 200k-250k tokens on 1M-window models and serious trouble near half the
 * window, and smaller models slip sooner. Adjustable in Settings. No Node imports: the dashboard uses it too.
 */
export const DEFAULT_CONTEXT_ALERTS: Record<string, ContextAlert> = {
  fable: { warn: 250_000, danger: 500_000 },
  opus: { warn: 250_000, danger: 500_000 },
  sonnet: { warn: 200_000, danger: 400_000 },
  haiku: { warn: 120_000, danger: 250_000 },
  other: { warn: 150_000, danger: 300_000 },
};
