import { ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SubAgent } from "@server/sessions/types.ts";
import { LogTable } from "@/components/LogTable";
import { Badge, Button } from "@/components/ui";
import { useLogs } from "@/lib/hooks";
import { activityText, contextFraction, duration, MAIN_STATE_LABEL, modelName, nearCompact, SUB_STATE_LABEL, subClock, tokens } from "@/lib/sessions/format";
import type { Session } from "@/lib/sessions/sessions";
import { useNow } from "@/lib/sessions/useSnapshot";
import { cn } from "@/lib/utils";
import { Conversation } from "./Conversation";
import { FlagButton, FlagNote, OpenLink, PrLinks, ProjectLabel, Rich, TerminalButton } from "./bits";

export type PanelView = "overview" | "conversation" | "router";

/** What the session is doing, in a few words, and for how long. */
function statusLine(agent: Session["agent"], now: number): { text: string; time?: string } {
  switch (agent.state) {
    case "waiting":
      return { text: agent.reason ?? "Waiting for you", time: agent.since ? `for ${duration(now - agent.since)}` : undefined };
    case "working":
      return { text: activityText(agent.activity), time: agent.turnStartedAt ? `${duration(now - agent.turnStartedAt)} into this turn` : undefined };
    case "done":
      return { text: "Done", time: agent.since ? `finished ${duration(now - agent.since)} ago` : undefined };
    default:
      return { text: MAIN_STATE_LABEL[agent.state] };
  }
}

const PILL = {
  waiting: "bg-destructive/10 text-destructive",
  working: "bg-primary/10 text-primary",
  done: "bg-success/12 text-success",
  idle: "bg-muted text-muted-foreground",
  ended: "bg-muted text-muted-foreground",
} as const;

export function SessionPanel({ session, view, onView, onClose }: { session: Session; view: PanelView; onView: (v: PanelView) => void; onClose: () => void }) {
  const { agent, project, inProject } = session;
  const now = useNow();
  const status = session.ended ? { text: "Session ended", time: agent.since ? `${duration(now - agent.since)} ago` : undefined } : statusLine(agent, now);
  const tabs: { id: PanelView; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "conversation", label: "Conversation" },
    { id: "router", label: agent.router ? `Router (${agent.router.requests})` : "Router" },
  ];

  return (
    <aside aria-label="Session details" className="flex h-full min-h-0 flex-col bg-card">
      <header className="grid gap-2 border-b px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", PILL[session.ended ? "ended" : agent.state])}>
            <span className="size-1.5 rounded-full bg-current" />
            {status.text}
            {status.time && <span className="font-normal opacity-80">{status.time}</span>}
          </span>
          <span className="flex items-center gap-1">
            <FlagButton agent={agent} className="size-9" />
            <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
              <X />
            </Button>
          </span>
        </div>
        <h2 className="text-base leading-snug font-semibold">{agent.name}</h2>
        {agent.flag && <FlagNote key={`${agent.sessionId}:${agent.flag.note ?? ""}`} agent={agent} />}
        <ProjectLabel project={project} inProject={inProject} branch={agent.branch} />
        <div className="flex flex-wrap items-center gap-1.5">
          <OpenLink agent={agent} strong={agent.state === "waiting" && !session.ended} ended={session.ended} />
          {session.ended && <TerminalButton agent={agent} ended />}
          <PrLinks prs={agent.prs} max={4} />
        </div>
      </header>
      <div role="tablist" className="flex gap-1 border-b px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            onClick={() => onView(t.id)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-2.5 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground",
              view === t.id && "border-primary text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view === "overview" && <Overview session={session} />}
      {view === "conversation" && <Conversation key={agent.sessionId} sessionId={agent.sessionId} version={agent.lastActivityAt} />}
      {view === "router" && <RouterTab sessionId={agent.sessionId} />}
    </aside>
  );
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        {title}
        {extra}
      </h3>
      {children}
    </section>
  );
}

function Overview({ session: { agent, ended } }: { session: Session }) {
  const now = useNow();
  const fraction = contextFraction(agent);
  const near = nearCompact(agent);
  let timeLabel = "Session open";
  let timeValue = duration(now - agent.startedAt);
  if (agent.state === "waiting" && agent.since) [timeLabel, timeValue] = ["Waiting for you", duration(now - agent.since)];
  if (agent.state === "working" && agent.turnStartedAt) [timeLabel, timeValue] = ["This turn", duration(now - agent.turnStartedAt)];
  if (agent.state === "done" && agent.since) [timeLabel, timeValue] = ["Finished", `${duration(now - agent.since)} ago`];

  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
      {agent.ask && (
        <Section title={agent.reason === "Plan ready for your approval" ? "The plan" : "It asks"}>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-[13.5px] break-words whitespace-pre-wrap">
            <Rich text={agent.ask} />
          </div>
        </Section>
      )}
      {agent.output && agent.state !== "working" && (
        <Section title="Its last message">
          <div className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 px-3.5 py-3 text-[13.5px] break-words whitespace-pre-wrap">
            <Rich text={agent.output} />
          </div>
        </Section>
      )}

      {ended ? (
        <p className="text-[13px] text-muted-foreground">This session has ended. Its full conversation is in the Conversation tab.</p>
      ) : (
        <Section title="Details">
          <div className="grid grid-cols-2 gap-2">
            <div className={cn("col-span-2 grid gap-1.5 rounded-lg border px-3 py-2.5", near && "border-warning/50 bg-warning/5")}>
              <span className="text-xs text-muted-foreground">Context window</span>
              {agent.contextTokens && agent.contextLimit ? (
                <>
                  <span className="flex items-baseline gap-1.5 text-sm font-semibold tabular-nums">
                    {tokens(agent.contextTokens)} <span className="text-xs font-normal text-muted-foreground">of {tokens(agent.contextLimit)} tokens</span>
                    <span className="ml-auto">{Math.round(fraction * 100)}%</span>
                  </span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", near ? "bg-warning" : "bg-primary")} style={{ width: `${fraction * 100}%` }} />
                  </div>
                  {near && <span className="text-xs">Close to auto-compact (about {tokens(agent.compactAt!)}). Wrap up or start a fresh session.</span>}
                </>
              ) : (
                <span className="text-sm">Not known yet</span>
              )}
            </div>
            <Tile label="Model">{modelName(agent.model)}</Tile>
            <Tile label={timeLabel}>{timeValue}</Tile>
            {timeLabel !== "Session open" && <Tile label="Session open">{duration(now - agent.startedAt)}</Tile>}
            {agent.lastActivityAt && <Tile label="Last activity">{duration(now - agent.lastActivityAt)} ago</Tile>}
          </div>
        </Section>
      )}

      {agent.subagents.length > 0 && <Subagents subs={agent.subagents} own={agent.tokensUsed} now={now} />}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-lg border px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{children}</span>
    </div>
  );
}

const SUB_DOT = { working: "bg-primary", stalled: "bg-warning", finished: "bg-muted-foreground/40" } as const;

/** Running subagents first; finished ones fold away so a long-running session stays readable. */
function Subagents({ subs, own, now }: { subs: SubAgent[]; own?: number; now: number }) {
  const [showDone, setShowDone] = useState(false);
  const active = subs.filter((s) => s.state !== "finished");
  const finished = subs.filter((s) => s.state === "finished").reverse(); // most recent first
  const list = (items: SubAgent[]) => (
    <ul className="divide-y">
      {items.map((sub) => (
        <li
          key={sub.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-2 text-[13px]"
          title={`${sub.type}, ${SUB_STATE_LABEL[sub.state].toLowerCase()}${sub.contextTokens ? `, ${tokens(sub.contextTokens)} tokens` : ""}`}
        >
          <span className={cn("size-2 rounded-full", SUB_DOT[sub.state])} />
          <span className="min-w-0 truncate">
            {sub.description || sub.type} <span className="text-xs text-muted-foreground">{sub.type}</span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{sub.tokensUsed ? tokens(sub.tokensUsed) : ""}</span>
          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{subClock(sub, now)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <Section title="Subagents" extra={<Badge variant="muted">{subs.length}</Badge>}>
      <SubagentTokens subs={subs} own={own} />
      <div className="overflow-hidden rounded-lg border">
        {active.length > 0 ? list(active) : <p className="px-3 py-2 text-[13px] text-muted-foreground">None running</p>}
        {finished.length > 0 && (
          <>
            <button type="button" onClick={() => setShowDone((s) => !s)} className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted/50">
              <ChevronRight className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />
              {finished.length} finished
            </button>
            {showDone && <div className="border-t">{list(finished)}</div>}
          </>
        )}
      </div>
    </Section>
  );
}

const TOP_SPENDERS = 3;

/** How many tokens the subagents used, against the session's own, and which used the most. */
function SubagentTokens({ subs, own }: { subs: SubAgent[]; own?: number }) {
  const total = subs.reduce((n, s) => n + (s.tokensUsed ?? 0), 0);
  if (!total) return null;
  const whole = total + (own ?? 0);
  const share = whole ? (total / whole) * 100 : 0;
  const running = subs.filter((s) => s.state !== "finished").reduce((n, s) => n + (s.tokensUsed ?? 0), 0);
  const top = [...subs].sort((a, b) => (b.tokensUsed ?? 0) - (a.tokensUsed ?? 0)).slice(0, TOP_SPENDERS);
  // Bars compare the top spenders with each other, so the biggest fills its bar.
  const pct = (n: number) => (top[0]?.tokensUsed ? (n / top[0].tokensUsed) * 100 : 0);
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {tokens(total)} <span className="text-xs font-normal text-muted-foreground">tokens used by subagents</span>
        </span>
        {own !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{Math.round(share)}% of this session</span>}
      </div>
      {own !== undefined && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" title={`Session itself ${tokens(own)}, subagents ${tokens(total)}`}>
          <span className="bg-muted-foreground/30" style={{ width: `${100 - share}%` }} />
          <span className="bg-primary" style={{ width: `${share}%` }} />
        </div>
      )}
      <ul className="grid gap-1">
        {top.map((s) => (
          <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_5rem_3rem] items-center gap-2 text-xs">
            <span className="truncate">{s.description || s.type}</span>
            <span className="h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct(s.tokensUsed ?? 0)}%` }} />
            </span>
            <span className="text-right text-muted-foreground tabular-nums">{tokens(s.tokensUsed ?? 0)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-muted-foreground">
        {running > 0 ? `${tokens(running)} by subagents still running. ` : ""}Input, output and cache-write tokens; cache reads are left out.
      </p>
    </div>
  );
}

/** This session's requests through claude-router. */
function RouterTab({ sessionId }: { sessionId: string }) {
  const logs = useLogs(true, 3000, sessionId);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <LogTable
        logs={logs}
        compact
        empty={
          <span className="text-[13px]">
            No requests from this session went through the router. Sessions started with <code className="font-mono text-xs">ANTHROPIC_BASE_URL</code> pointing at
            the router show up here.
          </span>
        }
      />
    </div>
  );
}
