import type { Report, Window } from "@server/analyzer/types.ts";
import { Button, Card, CardContent, CardDescription } from "@/components/ui";

const WINDOWS: Window[] = [7, 30];

/** Picks the window the usage checks cover; choosing one re-runs the analysis. */
export function WindowToggle({ window, disabled, onChange }: { window: Window; disabled: boolean; onChange: (w: Window) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Usage window">
      {WINDOWS.map((w) => (
        <Button key={w} size="sm" variant={w === window ? "default" : "outline"} disabled={disabled} onClick={() => w !== window && onChange(w)}>
          {w} days
        </Button>
      ))}
    </div>
  );
}

const tokens = (n: number) => n.toLocaleString("en-US");

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <Card>
      <CardContent className="grid gap-2 pt-4">
        <CardDescription>{title}</CardDescription>
        {rows.length === 0 && <p className="text-[13px] text-muted-foreground">No usage in this window.</p>}
        {rows.length > 0 && (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {head.map((h, i) => (
                  <th key={h} className={i === 0 ? "font-normal" : "text-right font-normal"}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  {r.map((c, i) => (
                    <td key={i} className={i === 0 ? "max-w-72 truncate py-0.5 pr-3 font-mono text-xs" : "py-0.5 text-right tabular-nums"}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export function UsageBreakdown({ report }: { report: Report }) {
  const u = report.usage;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Last {u.window} days: {tokens(u.totalTokens)} tokens (input, output and cache writes)
        {u.cacheShare !== null && `, ${Math.round(u.cacheShare * 100)}% of input read from the cache`}.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="By project" head={["Project", "Sessions", "Tokens"]} rows={u.byProject.map((p) => [p.project, String(p.sessions), tokens(p.tokens)])} />
        <Table title="By model" head={["Model", "Tokens"]} rows={u.byModel.map((m) => [m.model, tokens(m.tokens)])} />
      </div>
      <Table
        title="By session (largest first)"
        head={["Session", "Project", "Tokens", "Subagents"]}
        rows={u.bySession.map((s) => [s.sessionId, s.project, tokens(s.tokens), tokens(s.subagentTokens)])}
      />
    </div>
  );
}
