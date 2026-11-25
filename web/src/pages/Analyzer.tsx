import type { Category, Report, Window } from "@server/analyzer/types.ts";
import { Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { Findings } from "@/pages/analyzer/Findings";
import { ReviewButton, ReviewPanel } from "@/pages/analyzer/Review";
import { ScoreHeader } from "@/pages/analyzer/Scores";
import { UsageBreakdown, WindowToggle } from "@/pages/analyzer/Usage";

export function Analyzer() {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [reviewError, setReviewError] = useState<string>();
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
    api.analyzerReport().then(setReport, (err) => {
      setReport(null);
      toast.error(`Could not load the last report: ${(err as Error).message}`);
    });
  }, []);

  const run = async (window?: Window) => {
    setRunning(true);
    try {
      setReport(await api.runAnalyzer(window ?? report?.window));
      setReviewError(undefined);
    } catch (err) {
      toast.error(`The check failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const runButton = (
    <Button size="sm" onClick={() => run()} disabled={running}>
      {running ? <Loader2 className="animate-spin" /> : <RotateCw />} {report ? "Check again" : "Check my setup"}
    </Button>
  );

  return (
    <div>
      <div className="grid gap-8">
        {report === undefined && <p className="text-sm text-muted-foreground">Loading the last report…</p>}
        {report === null && (
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <p className="max-w-prose text-sm text-muted-foreground">
              Scores your Claude Code setup and the last 30 days of usage, and lists what to fix first. It only reads; nothing is changed.
            </p>
            {runButton}
          </Card>
        )}
        {report && (
          <>
            <ScoreHeader
              report={report}
              category={category}
              onCategory={setCategory}
              actions={
                <>
                  <WindowToggle window={report.window} disabled={running} onChange={run} />
                  <ReviewButton onReport={setReport} onError={setReviewError} />
                  {runButton}
                </>
              }
            />
            <Findings findings={report.findings} category={category} onClearCategory={() => setCategory(null)} />
            <ReviewPanel report={report} error={reviewError} />
            <UsageBreakdown report={report} />
          </>
        )}
      </div>
    </div>
  );
}
