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

export interface Report {
  /** Headline, 0-100: the category scores weighted by CATEGORY_WEIGHTS. */
  score: number;
  window: Window;
  /** Epoch ms. */
  ranAt: number;
  categories: Record<Category, number>;
  /** Worst first. */
  findings: Finding[];
}
