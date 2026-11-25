import { CATEGORY_WEIGHTS, type Category, type Report } from "@server/analyzer/types.ts";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription } from "@/components/ui";
import { cn } from "@/lib/utils";

export const CATEGORY_LABELS: Record<Category, string> = {
  usage: "Usage efficiency",
  context: "Context load",
  duplicates: "Duplicates",
  hygiene: "Hygiene",
};

function scoreColor(score: number): string {
  if (score >= 85) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-destructive";
}

export function ScoreHeader({ report, actions }: { report: Report; actions: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
        <div className="flex items-baseline gap-3">
          <span className={cn("text-4xl font-semibold tabular-nums", scoreColor(report.score))}>{report.score}</span>
          <div className="grid">
            <span className="text-sm font-medium">Score out of 100, last {report.window} days</span>
            <span className="text-[13px] text-muted-foreground">Ran {new Date(report.ranAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </CardContent>
    </Card>
  );
}

export function CategoryCards({ report }: { report: Report }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => {
        const count = report.findings.filter((f) => f.category === c).length;
        return (
          <Card key={c}>
            <CardContent className="grid gap-1 pt-4">
              <CardDescription>
                {CATEGORY_LABELS[c]} · weight {CATEGORY_WEIGHTS[c]}
              </CardDescription>
              <span className={cn("text-2xl font-semibold tabular-nums", scoreColor(report.categories[c]))}>{report.categories[c]}</span>
              <span className="text-xs text-muted-foreground">{count === 1 ? "1 finding" : `${count} findings`}</span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
