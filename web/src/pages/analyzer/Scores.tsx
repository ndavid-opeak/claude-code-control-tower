import { CATEGORY_WEIGHTS, type Category, type Report } from "@server/analyzer/types.ts";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export const CATEGORY_LABELS: Record<Category, string> = {
  usage: "Usage efficiency",
  context: "Context load",
  duplicates: "Duplicates",
  hygiene: "Hygiene",
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

/**
 * The headline score and one meter per category. A meter is also the category filter for the findings
 * below it, so the score and what to fix read as one thing.
 */
export function ScoreHeader({
  report,
  actions,
  category,
  onCategory,
}: {
  report: Report;
  actions: ReactNode;
  category: Category | null;
  onCategory: (c: Category | null) => void;
}) {
  return (
    <Card className="grid gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl leading-none font-semibold tracking-tight tabular-nums">{report.score}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      <p className="-mt-2 text-[13px] text-muted-foreground">
        Last {report.window} days, checked {new Date(report.ranAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4" role="group" aria-label="Filter findings by category">
        {CATEGORIES.map((c) => {
          const score = report.categories[c];
          const count = report.findings.filter((f) => f.category === c).length;
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              onClick={() => onCategory(active ? null : c)}
              className={cn(
                "group grid gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring",
                category && !active && "opacity-45",
              )}
            >
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className={cn("text-muted-foreground group-hover:text-foreground", active && "font-medium text-foreground")}>{CATEGORY_LABELS[c]}</span>
                <span className="font-medium tabular-nums">{score}</span>
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${score}%` }} />
              </span>
              <span className="text-xs text-muted-foreground">
                {count === 0 ? "Nothing to fix" : count === 1 ? "1 issue" : `${count} issues`} · weight {CATEGORY_WEIGHTS[c]}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
