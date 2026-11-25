import type { Report } from "@server/analyzer/types.ts";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Card, Dialog } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { inline, parseReview } from "@/pages/analyzer/format";

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
      <Button variant="outline" size="sm" onClick={ask} disabled={estimating || running}>
        {estimating || running ? <Loader2 className="animate-spin" /> : <Sparkles />} {running ? "Reviewing…" : "Ask Claude"}
      </Button>
      <Dialog
        open={tokens !== undefined}
        onOpenChange={(open) => !open && setTokens(undefined)}
        title="Ask Claude to review?"
        description={`Sends about ${tokens?.toLocaleString()} tokens to Claude Sonnet: the findings and short excerpts of the flagged files, never transcripts. It goes straight to Anthropic and uses your plan.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTokens(undefined)}>
              Cancel
            </Button>
            <Button onClick={confirm}>Send</Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

/** Claude's advice as a short list of headlines; each opens to its full text. */
export function ReviewPanel({ report, error }: { report: Report; error?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!report.review && !error) return null;
  const { note, items } = report.review ? parseReview(report.review.advice) : { note: [], items: [] };

  return (
    <section className="grid gap-3" aria-labelledby="review-title">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="review-title" className="text-[15px] font-semibold tracking-tight">
          Claude's advice
        </h2>
        {report.review && (
          <span className="text-[13px] text-muted-foreground">
            {new Date(report.review.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {note.length > 0 && `, ${note.join(" ").replace(/\.$/, "").toLowerCase()}`}
          </span>
        )}
      </div>
      <Card className="divide-y overflow-hidden">
        {error && <p className="px-5 py-3 text-sm text-destructive">The review failed: {error}</p>}
        {items.length === 0 && report.review && <p className="px-5 py-3 text-[13px] whitespace-pre-wrap">{report.review.advice}</p>}
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
              >
                <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{inline(item.headline.replace(/\.$/, ""))}</span>
                <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="grid max-w-3xl gap-2 px-5 pb-4 pl-12 text-[13px] leading-relaxed text-muted-foreground">
                  {item.lines.map((line, j) =>
                    /^[-*]\s/.test(line) ? (
                      <p key={j} className="relative pl-3.5 before:absolute before:top-[0.6em] before:left-0 before:size-1 before:rounded-full before:bg-muted-foreground/50">
                        {inline(line.slice(2))}
                      </p>
                    ) : (
                      <p key={j}>{inline(line)}</p>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
