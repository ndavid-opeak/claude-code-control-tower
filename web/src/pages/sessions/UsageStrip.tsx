import { Bell, BellOff, PieChart, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Snapshot, UsageBreakdown, UsageWindow } from "@server/sessions/types.ts";
import { Button, Card, Dialog } from "@/components/ui";
import { duration, MODEL_NAME, tokens } from "@/lib/sessions/format";
import { useNow } from "@/lib/sessions/useSnapshot";
import { cn } from "@/lib/utils";

export interface Alerts {
  on: boolean;
  blocked: boolean;
  toggle: () => void;
}

/** Your plan's session and week usage, how fresh the figures are, and the alerts switch. */
export function UsageStrip({ snapshot, alerts }: { snapshot: Snapshot; alerts: Alerts }) {
  const now = useNow();
  const [breakdown, setBreakdown] = useState(false);
  const { usage } = snapshot;
  const age = usage.fetchedAt ? duration(now - usage.fetchedAt) : "";

  let status: string;
  if (usage.checking) status = "Checking…";
  else if (!usage.fetchedAt) status = usage.problem ?? "No usage figures yet";
  else if (usage.source === "live") status = `Checked ${age} ago`;
  // Claude's saved copy can be hours old, so say so.
  else status = `Saved by Claude ${age} ago`;

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
      <Limit label="Session" window={usage.session} now={now} />
      <Limit label="Week" window={usage.week} now={now} />
      <div className="flex min-w-0 items-center gap-1">
        <span role="status" className="text-xs text-muted-foreground" title={usage.source !== "live" ? usage.problem : undefined}>
          {status}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Check usage now"
          title="Check usage now (one tiny Haiku call)"
          disabled={usage.checking}
          onClick={() => fetch("/api/sessions/usage/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })}
        >
          <RefreshCw className={cn(usage.checking && "animate-spin")} />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {usage.window && usage.window.total > 0 && (
          <Button variant="outline" size="sm" onClick={() => setBreakdown(true)}>
            <PieChart /> What used it
          </Button>
        )}
        <Button
          variant={alerts.on ? "default" : "outline"}
          size="sm"
          aria-pressed={alerts.on}
          onClick={alerts.toggle}
          title={
            alerts.on && alerts.blocked
              ? "Notifications are blocked for this page in your browser settings, so only the chime plays."
              : "Chime, and notify you when the page is in the background, whenever a session starts waiting for you."
          }
        >
          {alerts.on ? <Bell /> : <BellOff />} {alerts.on ? "Alerts on" : "Alerts off"}
        </Button>
      </div>
      {breakdown && usage.window && (
        <Dialog open onOpenChange={(o) => !o && setBreakdown(false)} title="What used it" description={`${tokens(usage.window.total)} tokens since this 5-hour window opened ${duration(now - usage.window.since)} ago.`}>
          <Breakdown b={usage.window} />
        </Dialog>
      )}
    </Card>
  );
}

function Limit({ label, window: w, now }: { label: string; window?: UsageWindow; now: number }) {
  if (!w) return null;
  const left = w.resetsAt ? w.resetsAt - now : 0;
  // Once the reset time has passed, the saved figure belongs to the previous window.
  const expired = w.resetsAt !== undefined && left <= 0;
  const high = w.percent >= 85;
  return (
    <div className={cn("grid w-44 gap-1", expired && "opacity-50")}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", high && "text-destructive")}>{Math.round(w.percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.percent)}>
        <div className={cn("h-full rounded-full", high ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, w.percent)}%` }} />
      </div>
      <span className="text-[11.5px] text-muted-foreground tabular-nums">{expired ? "has reset since, out of date" : left > 0 ? `resets in ${duration(left)}` : ""}</span>
    </div>
  );
}

const MODEL_ORDER = ["opus", "sonnet", "haiku", "fable", "other"];
const MODEL_COLOR: Record<string, string> = {
  opus: "bg-primary",
  sonnet: "bg-success",
  haiku: "bg-warning",
  fable: "bg-destructive",
  other: "bg-muted-foreground/50",
};
const SHOWN_SESSIONS = 8;

/** Which models and which sessions used tokens since the 5-hour window opened. */
function Breakdown({ b }: { b: UsageBreakdown }) {
  const models = MODEL_ORDER.filter((m) => (b.byModel[m] ?? 0) > 0);
  const pct = (n: number) => (b.total ? (n / b.total) * 100 : 0);
  const label = (n: number) => (pct(n) < 1 ? "<1%" : `${Math.round(pct(n))}%`);
  const shown = b.sessions.slice(0, SHOWN_SESSIONS);
  const rest = b.sessions.slice(SHOWN_SESSIONS);
  const restTokens = rest.reduce((sum, s) => sum + s.tokens, 0);
  const rows = [...shown.map((s) => ({ key: s.sessionId, name: s.name, live: s.live, tokens: s.tokens })), ...(rest.length ? [{ key: "rest", name: `${rest.length} more sessions`, live: false, tokens: restTokens }] : [])];

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">By model</h3>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {models.map((m) => (
            <span key={m} className={MODEL_COLOR[m]} style={{ width: `${pct(b.byModel[m])}%` }} />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {models.map((m) => (
            <li key={m} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", MODEL_COLOR[m])} />
              {MODEL_NAME[m]} <strong className="tabular-nums">{label(b.byModel[m])}</strong>
              <span className="text-muted-foreground tabular-nums">{tokens(b.byModel[m])}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">By session</h3>
        <ul className="grid gap-1.5">
          {rows.map((s) => (
            <li key={s.key} className={cn("grid grid-cols-[minmax(0,1fr)_6rem_3rem] items-center gap-3 text-[13px]", !s.live && "text-muted-foreground")}>
              <span className="truncate">{s.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct(s.tokens)}%` }} />
              </span>
              <span className="text-right tabular-nums">{label(s.tokens)}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground">
        Counted from your transcripts: input, output and cache-write tokens, with subagents inside their session. Models use up your limit at different
        rates, so a share of tokens is not the same as a share of the limit.
      </p>
    </div>
  );
}
