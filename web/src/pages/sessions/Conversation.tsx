import { ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationItem, ConversationPage } from "@server/sessions/types.ts";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Rich } from "./bits";

/** Bytes per "Show earlier" step; the server reads the same amount by default. */
const PAGE_BYTES = 1.5 * 1024 * 1024;

const clock = (at?: number) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

type Block = { kind: "steps"; steps: ConversationItem[] } | ConversationItem;

/** Consecutive steps fold into one collapsible group, so the conversation reads as messages. */
function toBlocks(items: ConversationItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    const last = blocks.at(-1);
    if (item.kind === "tool") {
      if (last?.kind === "steps") last.steps.push(item);
      else blocks.push({ kind: "steps", steps: [item] });
    } else {
      blocks.push(item);
    }
  }
  return blocks;
}

/**
 * The session's conversation, read-only. It reloads whenever the session writes something new,
 * and stays scrolled to the bottom unless you have scrolled up to read.
 */
export function Conversation({ sessionId, version }: { sessionId: string; version?: number }) {
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [from, setFrom] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const keepFromBottom = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ session: sessionId });
    if (from !== undefined) query.set("from", String(from));
    fetch(`/api/sessions/conversation?${query}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "The conversation could not be loaded.");
        setPage(body);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadingEarlier(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId, from, version]);

  // Follow new messages when you are at the bottom; keep your place when earlier ones are added above.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [page]);

  const showEarlier = () => {
    if (!page?.cursor || !box.current) return;
    keepFromBottom.current = box.current.scrollHeight - box.current.scrollTop;
    setLoadingEarlier(true);
    setFrom(Math.max(0, page.cursor - PAGE_BYTES));
  };

  const blocks = page ? toBlocks(page.items) : [];
  // The newest reply is shown in full; older long ones fold.
  const newest = blocks.findLastIndex((b) => b.kind === "claude");

  return (
    <div
      ref={box}
      className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-5 py-4"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}
      {!page && !error && <p className="text-[13px] text-muted-foreground">Loading the conversation…</p>}
      {page && page.cursor !== null && (
        <Button variant="outline" size="sm" className="justify-self-center" onClick={showEarlier} disabled={loadingEarlier}>
          {loadingEarlier && <Loader2 className="animate-spin" />} {loadingEarlier ? "Loading…" : "Show earlier messages"}
        </Button>
      )}
      {page && page.items.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing has been said in this session yet.</p>}
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} unfolded={i === newest} />
      ))}
    </div>
  );
}

function Who({ children, at }: { children: ReactNode; at?: number }) {
  return (
    <p className="mb-1 flex items-baseline gap-2 text-xs font-semibold">
      {children}
      <span className="font-normal text-muted-foreground tabular-nums">{clock(at)}</span>
    </p>
  );
}

function BlockView({ block, unfolded = false }: { block: Block; unfolded?: boolean }) {
  if (block.kind === "steps") return <Steps steps={block.steps} />;
  switch (block.kind) {
    case "you":
      return (
        <div className="ml-8 justify-self-end rounded-xl rounded-br-sm bg-primary/10 px-3.5 py-2.5 text-[13.5px]" title={clock(block.at)}>
          <Foldable>{block.text}</Foldable>
        </div>
      );
    case "claude":
      return (
        <div className="text-[13.5px]">
          <Who at={block.at}>Claude</Who>
          <Foldable startOpen={unfolded}>
            <Rich text={block.text} />
          </Foldable>
        </div>
      );
    case "ask":
    case "plan": {
      const open = !block.answer;
      return (
        <div className={cn("rounded-xl border px-3.5 py-3 text-[13.5px]", open ? "border-destructive/40 bg-destructive/5" : "bg-card")}>
          <Who at={block.at}>{block.kind === "ask" ? "Claude asked you" : "Plan for your approval"}</Who>
          {block.kind === "ask" ? (
            <div className="whitespace-pre-wrap">{block.text}</div>
          ) : (
            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-primary">Read the plan</summary>
              <div className="mt-2 whitespace-pre-wrap">
                <Rich text={block.text} />
              </div>
            </details>
          )}
          <p className={cn("mt-2 border-t pt-2 text-[13px]", open ? "font-medium text-destructive" : "text-muted-foreground")}>
            {block.answer ?? (block.kind === "ask" ? "Not answered yet" : "Waiting for your decision")}
          </p>
        </div>
      );
    }
    default:
      return <p className="text-center text-xs text-muted-foreground">{block.text}</p>;
  }
}

function Steps({ steps }: { steps: ConversationItem[] }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(steps.map((s) => s.name))].slice(0, 4).join(", ");
  const failed = steps.filter((s) => s.result?.error).length;
  return (
    <div className="rounded-lg border bg-muted/30 text-[12.5px]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="truncate">
          {steps.length} {steps.length === 1 ? "step" : "steps"}: {names}
        </span>
        {failed > 0 && <span className="shrink-0 text-destructive">({failed} failed)</span>}
      </button>
      {open && (
        <ul className="grid gap-1 border-t px-2 py-2">
          {steps.map((step, i) => (
            <li key={i}>
              <details className="group rounded-md">
                <summary className={cn("cursor-pointer truncate rounded-md px-1.5 py-1 hover:bg-muted", step.result?.error && "text-destructive")}>
                  <strong className="font-semibold">{step.name}</strong> <span className="text-muted-foreground">{step.text}</span>
                </summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded-md border bg-card p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                  {step.result ? step.result.text || "(no output)" : "Still running"}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Long messages show their first lines; "Show more" opens the rest. */
function Foldable({ children, startOpen = false }: { children: ReactNode; startOpen?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(startOpen);
  // A reply that stops being the newest folds again.
  useEffect(() => setOpen(startOpen), [startOpen]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [children, open]);
  return (
    <>
      <div ref={ref} className={cn("break-words whitespace-pre-wrap", !open && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", !open && !long && "[mask-image:none]")}>
        {children}
      </div>
      {(long || (open && !startOpen)) && (
        <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
