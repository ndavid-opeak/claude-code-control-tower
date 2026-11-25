import type { Report } from "@server/analyzer/types.ts";
import { Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent } from "@/components/ui";
import { api } from "@/lib/api";
import { CategoryCards, ScoreHeader } from "@/pages/analyzer/Scores";
import { Findings } from "@/pages/analyzer/Findings";
import { ReviewButton, ReviewPanel } from "@/pages/analyzer/Review";

export function Analyzer() {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [reviewError, setReviewError] = useState<string>();

  useEffect(() => {
    api.analyzerReport().then(setReport, (err) => {
      setReport(null);
      toast.error(`Could not load the last report: ${(err as Error).message}`);
    });
  }, []);

  const run = async () => {
    setRunning(true);
    try {
      setReport(await api.runAnalyzer(report?.window));
      setReviewError(undefined);
    } catch (err) {
      toast.error(`Analysis failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const runButton = (
    <Button onClick={run} disabled={running}>
      {running ? <Loader2 className="animate-spin" /> : <Play />} Run
    </Button>
  );

  if (report === undefined) return <p className="text-sm text-muted-foreground">Loading the last report…</p>;
  if (report === null) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
          <p className="text-sm text-muted-foreground">
            No report yet. Run checks your Claude Code setup and usage and scores it. It only reads; nothing is changed.
          </p>
          {runButton}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4">
      <ScoreHeader
        report={report}
        actions={
          <>
            <ReviewButton onReport={setReport} onError={setReviewError} />
            {runButton}
          </>
        }
      />
      <ReviewPanel report={report} error={reviewError} />
      <CategoryCards report={report} />
      <Findings findings={report.findings} />
    </div>
  );
}
