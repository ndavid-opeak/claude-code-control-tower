import { RULES } from './rules/index.ts';
import type { RuleContext } from './rules/types.ts';
import { CATEGORY_WEIGHTS, type Category, type Finding, type Report, type Severity } from './types.ts';

// Reads Claude Code's setup and transcripts, runs every rule, and scores the result. Read-only.

/** Points a finding takes off its category, by severity. */
export const SEVERITY_POINTS: Record<Severity, number> = { high: 15, medium: 8, low: 3 };

export type AnalyzeInput = RuleContext;

export function analyze(input: AnalyzeInput): Report {
  const findings: Finding[] = [];
  for (const [category, rules] of Object.entries(RULES) as [Category, (typeof RULES)[Category]][]) {
    for (const rule of rules) {
      for (const f of rule(input)) findings.push({ ...f, category, points: SEVERITY_POINTS[f.severity] });
    }
  }
  findings.sort((a, b) => b.points - a.points || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

  const categories = {} as Record<Category, number>;
  let weighted = 0;
  for (const category of Object.keys(CATEGORY_WEIGHTS) as Category[]) {
    const lost = findings.filter((f) => f.category === category).reduce((sum, f) => sum + f.points, 0);
    categories[category] = Math.max(0, 100 - lost);
    weighted += categories[category] * CATEGORY_WEIGHTS[category];
  }
  return { score: Math.round(weighted / 100), window: input.window, ranAt: input.now, categories, findings };
}
