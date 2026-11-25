import type { Report } from "@server/analyzer/types.ts";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog } from "@/components/ui";
import { api } from "@/lib/api";

/** "Ask Claude to review": shows the estimated tokens first, runs only after you confirm. */
export function ReviewButton({ onReport, onError }: { onReport: (r: Report) => void; onError: (message: string | undefined) => void }) {
  const [tokens, setTokens] = useState<number>();
  const [estimating, setEstimating] = useState(false);
  const [running, setRunning] = useState(false);

  const ask = async () => {
    onError(undefined);
    setEstimating(true);
    try {
      setTokens((await api.estimateReview()).tokens);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setEstimating(false);
    }
  };

  const confirm = async () => {
    setTokens(undefined);
    setRunning(true);
    try {
      onReport(await api.reviewAnalyzer());
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={ask} disabled={estimating || running}>
        {estimating || running ? <Loader2 className="animate-spin" /> : <Sparkles />} {running ? "Reviewing…" : "Ask Claude to review"}
      </Button>
      <Dialog
        open={tokens !== undefined}
        onOpenChange={(open) => !open && setTokens(undefined)}
        title="Ask Claude to review?"
        description={`This sends about ~${tokens?.toLocaleString()} tokens to Claude Sonnet: the findings and short excerpts of the flagged files. Transcripts are never sent. It uses your Claude plan.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTokens(undefined)}>
              Cancel
            </Button>
            <Button onClick={confirm}>Send</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">The review goes straight to Anthropic, not through the router.</p>
      </Dialog>
    </>
  );
}

export function ReviewPanel({ report, error }: { report: Report; error?: string }) {
  if (!report.review && !error) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude's review</CardTitle>
        {report.review && <CardDescription>{new Date(report.review.at).toLocaleString()}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-2">
        {error && <p className="text-sm text-destructive">Review failed: {error}</p>}
        {report.review && <div className="text-sm whitespace-pre-wrap">{report.review.advice}</div>}
      </CardContent>
    </Card>
  );
}
