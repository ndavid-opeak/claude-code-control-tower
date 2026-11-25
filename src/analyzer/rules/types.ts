import type { Finding, Window } from '../types.ts';

/** What every rule gets: where Claude Code keeps its setup, and the time window for usage rules. */
export interface RuleContext {
  /** ~/.claude */
  claudeHome: string;
  /** ~/.claude.json */
  claudeJsonPath: string;
  now: number;
  window: Window;
}

/** A finding as a rule reports it; `analyze()` fills in the category and points. */
export type RuleFinding = Omit<Finding, 'category' | 'points'>;

/** One check. It reads what it needs itself and returns zero or more findings. It must never write. */
export type Rule = (ctx: RuleContext) => RuleFinding[];
