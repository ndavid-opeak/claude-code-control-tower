import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { activityText, contextFraction, duration, lineOf, nearCompact, QUIET_MS } from "@/lib/sessions/format";
import { COLUMNS, inColumn, type Session } from "@/lib/sessions/sessions";
import { useNow } from "@/lib/sessions/useSnapshot";
import { cn } from "@/lib/utils";
import { ContextRing, OpenLink, PrLinks, ProjectLabel, RouterBadge } from "./bits";

interface Props {
  sessions: Session[];
  history: Session[];
  openId: string | null;
  onOpen: (sessionId: string) => void;
}

const DOT = { waiting: "bg-destructive", working: "bg-primary", done: "bg-success" } as const;

/** Every running session on this Mac, in three columns by state. Each card names its project. */
export function Board({ sessions, history, openId, onOpen }: Props) {
  const now = useNow();
  return (
    // Columns follow the board's own width (container queries), which shrinks when the session panel is open.
    <div className="@container grid gap-6">
      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No Claude sessions are running. Start one and it appears here.
        </div>
      ) : (
        <div className="grid items-start gap-4 @3xl:grid-cols-3">
          {COLUMNS.map((column) => {
            const list = inColumn(sessions, column.state);
            const key = column.state as keyof typeof DOT;
            return (
              <section key={column.state} aria-label={column.title} className="grid min-w-0 gap-2.5">
                <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
                  <span className={cn("size-2 rounded-full", DOT[key])} />
                  {column.title}
                  <Badge variant="muted" className="tabular-nums">
                    {list.length}
                  </Badge>
                </h2>
                {list.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-5 text-[13px] text-muted-foreground">{column.empty}</p>
                ) : (
                  <ul className="grid gap-2.5">
                    {list.map((s) => (
                      <li key={s.agent.sessionId}>
                        <Card session={s} now={now} open={s.agent.sessionId === openId} onOpen={onOpen} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {history.length > 0 && <History history={history} now={now} openId={openId} onOpen={onOpen} />}
    </div>
  );
}

/** One session: its title, where it runs, what it says or is doing, and how long, how full, how many helpers. */
function Card({ session: { agent, project, inProject }, now, open, onOpen }: { session: Session; now: number; open: boolean; onOpen: Props["onOpen"] }) {
  const helpers = agent.subagents.filter((s) => s.state !== "finished").length;
  let says: string;
  let when: string;
  let quietFor = 0;
  if (agent.state === "waiting") {
    // The question itself when there is one, else why it is blocked.
    says = lineOf(agent.ask, "first") || agent.reason || "Waiting for you";
    when = agent.since ? `waiting ${duration(now - agent.since)}` : "waiting";
  } else if (agent.state === "working") {
    says = activityText(agent.activity);
    quietFor = agent.lastActivityAt ? now - agent.lastActivityAt : 0;
    when = agent.turnStartedAt ? `${duration(now - agent.turnStartedAt)} into this turn` : "working";
  } else if (agent.state === "done") {
    says = agent.summary || lineOf(agent.output, "first") || "Finished its turn";
    when = agent.since ? `finished ${duration(now - agent.since)} ago` : "finished";
  } else {
    says = "No activity yet";
    when = `open ${duration(now - agent.startedAt)}`;
  }
  const fraction = contextFraction(agent);
  const accent = agent.state === "waiting" ? "before:bg-destructive" : agent.state === "working" ? "before:bg-primary" : "before:bg-success/60";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:shadow-md",
        accent,
        open && "ring-2 ring-primary/50",
      )}
    >
      <button type="button" aria-pressed={open} onClick={() => onOpen(agent.sessionId)} className="grid w-full min-w-0 gap-1.5 px-4 pt-3 pb-2 text-left">
        <span className="line-clamp-2 text-[14px] leading-snug font-semibold">{agent.name}</span>
        <ProjectLabel project={project} inProject={inProject} branch={agent.branch} />
        <span className={cn("line-clamp-2 text-[13px]", agent.state === "waiting" ? "text-foreground" : "text-muted-foreground")}>{says}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{when}</span>
          {agent.contextTokens !== undefined && (
            <span className="inline-flex items-center gap-1 tabular-nums" title="How full the context window is">
              <ContextRing fraction={fraction} />
              {Math.round(fraction * 100)}%
            </span>
          )}
          {helpers > 0 && (
            <span>
              {helpers} {helpers === 1 ? "subagent" : "subagents"}
            </span>
          )}
          {nearCompact(agent) && <Badge variant="warning">Near auto-compact</Badge>}
          {quietFor >= QUIET_MS && <Badge variant="warning">Nothing new for {duration(quietFor)}</Badge>}
        </span>
      </button>
      {(agent.openUrl || agent.app === "terminal" || agent.prs?.length || agent.router) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/30 px-4 py-2">
          <OpenLink agent={agent} strong={agent.state === "waiting"} />
          <PrLinks prs={agent.prs} max={2} />
          <span className="ml-auto">
            <RouterBadge router={agent.router} />
          </span>
        </div>
      )}
    </div>
  );
}

/** Sessions that ended in the last day. Folded by default; the board is about what is running. */
const HISTORY_SHOWN = 8;

function History({ history, now, openId, onOpen }: { history: Session[]; now: number; openId: string | null; onOpen: Props["onOpen"] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? history : history.slice(0, HISTORY_SHOWN);
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold">
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        Ended recently
        <Badge variant="muted" className="tabular-nums">
          {history.length}
        </Badge>
        <span className="ml-1 text-xs font-normal text-muted-foreground">last 24 hours</span>
      </button>
      {open && (
        <div className="border-t">
          <ul className="divide-y">
            {shown.map(({ agent, project, inProject }) => (
              <li key={agent.sessionId} className={cn("flex items-center gap-3 px-4 py-2 hover:bg-muted/50", agent.sessionId === openId && "bg-muted/60")}>
                <button type="button" onClick={() => onOpen(agent.sessionId)} className="grid min-w-0 flex-1 gap-0.5 text-left @xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_6rem] @xl:items-center @xl:gap-3">
                  <span className="truncate text-[13px] font-medium">{agent.name}</span>
                  <ProjectLabel project={project} inProject={inProject} branch={agent.branch} />
                  <span className="text-xs text-muted-foreground tabular-nums @xl:text-right">{agent.since ? `${duration(now - agent.since)} ago` : ""}</span>
                </button>
                <span className="hidden shrink-0 items-center gap-1 @xl:flex">
                  <RouterBadge router={agent.router} />
                  <PrLinks prs={agent.prs} max={2} />
                </span>
              </li>
            ))}
          </ul>
          {history.length > HISTORY_SHOWN && (
            <button type="button" className="w-full border-t px-4 py-2 text-[13px] font-medium text-primary hover:bg-muted/50" onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `Show all ${history.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
