import type { Report, Window } from "@server/analyzer/types.ts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { baseName, shortPath, tokensShort } from "@/pages/analyzer/format";

const WINDOWS: Window[] = [7, 30];

/** Picks the window the usage checks cover; choosing one re-runs the analysis. */
export function WindowToggle({ window, disabled, onChange }: { window: Window; disabled: boolean; onChange: (w: Window) => void }) {
  return (
    <div className="inline-flex h-8 rounded-md border p-0.5" role="group" aria-label="Usage window">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={w === window}
          disabled={disabled}
          onClick={() => w !== window && onChange(w)}
          className={cn(
            "rounded px-2.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50",
            w === window ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {w} days
        </button>
      ))}
    </div>
  );
}

const num = (n: number) => n.toLocaleString("en-US");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-lg font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** A plain table: the first column truncates, numbers line up on the right. */
function Table({ head, rows }: { head: string[]; rows: { key: string; cells: string[]; title?: string }[] }) {
  return (
    <table className="w-full table-fixed self-start text-[13px]">
      <thead>
        <tr className="text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={cn("pb-1.5 font-normal", i === 0 ? "text-left" : "w-24 text-right")}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border/60">
            {r.cells.map((c, i) => (
              <td key={i} className={cn("py-1.5", i === 0 ? "truncate pr-3" : "text-right tabular-nums")} title={i === 0 ? r.title : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Usage in the window: three numbers up front, the tables behind "Details". */
export function UsageBreakdown({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const u = report.usage;
  const top = u.byModel[0];
  const topShare = top && u.totalTokens > 0 ? Math.round((top.tokens / u.totalTokens) * 100) : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 p-5">
        <Stat label={`tokens in ${u.window} days`} value={tokensShort(u.totalTokens)} />
        {u.cacheShare !== null && <Stat label="of input read from cache" value={`${Math.round(u.cacheShare * 100)}%`} />}
        {top && topShare !== null && <Stat label={`of tokens on ${top.model}`} value={`${topShare}%`} />}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ml-auto inline-flex items-center gap-1 rounded-md text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
        >
          {open ? "Hide details" : "Details"}
          <ChevronRight className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
        </button>
      </div>
      {open && (
        <div className="grid gap-6 border-t p-5 lg:grid-cols-2">
          <Table
            head={["Project", "Sessions", "Tokens"]}
            rows={u.byProject.slice(0, 10).map((p) => ({ key: p.project, title: p.project, cells: [baseName(p.project), num(p.sessions), tokensShort(p.tokens)] }))}
          />
          <Table head={["Model", "Tokens"]} rows={u.byModel.map((m) => ({ key: m.model, cells: [m.model, tokensShort(m.tokens)] }))} />
          <div className="lg:col-span-2">
            <Table
              head={["Largest sessions", "Tokens", "Subagents"]}
              rows={u.bySession.slice(0, 10).map((s) => ({
                key: s.sessionId,
                title: `${s.sessionId}\n${shortPath(s.project)}`,
                cells: [`${baseName(s.project)} · ${s.sessionId.slice(0, 8)}`, tokensShort(s.tokens), tokensShort(s.subagentTokens)],
              }))}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
