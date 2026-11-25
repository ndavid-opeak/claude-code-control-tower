import { Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { duration } from "@/lib/sessions/format";
import { FLAG_EVENT_TEXT, type FlagEvent, type FlagEventKind } from "@/lib/sessions/flagEvents";
import { cn } from "@/lib/utils";

const ACCENT: Record<FlagEventKind, string> = {
  waiting: "before:bg-destructive",
  done: "before:bg-success",
  ended: "before:bg-muted-foreground/50",
  context: "before:bg-destructive",
};

/** Cards for flagged sessions, top right on every page, each kept until you open it or close it. */
export function FlagEventCards({ events, onOpen, onDismiss, onDismissAll }: {
  events: FlagEvent[];
  onOpen: (sessionId: string) => void;
  onDismiss: (sessionId: string) => void;
  onDismissAll: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (events.length === 0) return null;

  return (
    <section aria-label="Flagged sessions" aria-live="polite" className="fixed top-16 right-4 z-40 grid w-[min(20rem,calc(100vw-2rem))] gap-2">
      <div className="grid max-h-[calc(100dvh-7rem)] gap-2 overflow-y-auto p-0.5">
        {events.map((e) => (
          <div
            key={e.sessionId}
            className={cn(
              "relative grid gap-2 overflow-hidden rounded-xl border bg-card-solid px-4 py-3 shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
              "animate-in-card",
              ACCENT[e.kind],
            )}
          >
            <div className="flex items-start gap-2">
              <Star className="mt-0.5 size-3.5 shrink-0 fill-warning text-warning" aria-hidden />
              <p className="min-w-0 flex-1 text-[13px] leading-snug">
                <span className="font-medium">{e.name}</span> {FLAG_EVENT_TEXT[e.kind]}
                <span className="block text-xs text-muted-foreground">
                  {duration(now - e.at)} ago{e.note ? `, ${e.note}` : ""}
                </span>
              </p>
              <button
                type="button"
                onClick={() => onDismiss(e.sessionId)}
                aria-label={`Dismiss ${e.name}`}
                className="-mt-0.5 -mr-1.5 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {e.kind !== "ended" && (
              <Button size="sm" variant="outline" className="h-7 justify-self-start" onClick={() => onOpen(e.sessionId)}>
                Open session
              </Button>
            )}
          </div>
        ))}
      </div>
      {events.length > 1 && (
        <button
          type="button"
          onClick={onDismissAll}
          className="justify-self-end rounded-md px-2 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          Dismiss all
        </button>
      )}
    </section>
  );
}
