// Shapes of the Analyzer report. Shared with the dashboard (web/tsconfig.json includes this file).

export type Category = 'usage' | 'context' | 'duplicates' | 'hygiene';
export type Severity = 'high' | 'medium' | 'low';
export type Window = 7 | 30;

/** Share of the headline score per category; sums to 100. */
export const CATEGORY_WEIGHTS: Record<Category, number> = { usage: 40, context: 30, duplicates: 20, hygiene: 10 };

export interface Finding {
  /** Stable for the same problem across runs, e.g. "hygiene/settings-backup:/path". */
  id: string;
  category: Category;
  severity: Severity;
  /** Points this finding takes off its category's score. */
  points: number;
  title: string;
  detail: string;
  project?: string;
  file?: string;
  line?: number;
  fix: string;
  /** True when a number in it is an estimate (characters ÷ 4); shown with "~". */
  estimated?: boolean;
}

/** Claude's ranked advice on a report, saved with it. */
export interface Review {
  /** Epoch ms. */
  at: number;
  /** Markdown, as Claude wrote it. */
  advice: string;
}

export interface Report {
  /** Headline, 0-100: the category scores weighted by CATEGORY_WEIGHTS. */
  score: number;
  window: Window;
  /** Epoch ms. */
  ranAt: number;
  categories: Record<Category, number>;
  /** Worst first. */
  findings: Finding[];
  /** Where the tokens in `window` went. */
  usage: UsageBreakdown;
  review?: Review;
}

/** Tokens are input, output and cache writes (cache reads are left out, as in the Sessions breakdown). */
export interface UsageBreakdown {
  window: Window;
  totalTokens: number;
  /** Cache reads as a share of all input-side tokens (0-1); null when there was no input. */
  cacheShare: number | null;
  /** Biggest first. */
  byProject: { project: string; tokens: number; sessions: number }[];
  /** By model family (opus, sonnet, haiku, ...), biggest first. */
  byModel: { model: string; tokens: number }[];
  /** The biggest sessions, subagents included in their session. */
  bySession: { sessionId: string; project: string; tokens: number; subagentTokens: number; peakContext: number; compacted: boolean }[];
}
