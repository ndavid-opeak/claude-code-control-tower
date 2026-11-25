import { ArrowRight, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatusDot } from "@/components/ui";
import { FAMILIES, providerName } from "@/lib/api";
import { useHealth, useLogs, type AppState } from "@/lib/hooks";
import { ms, timeAgo } from "@/lib/utils";

export function Router({ app }: { app: AppState }) {
  const { config } = app.state!;
  const logs = useLogs();
  const health = useHealth([config.providers.length]);

  const total = logs.length;
  const errors = logs.filter((l) => l.status >= 400).length;
  const fallbacks = logs.filter((l) => (l.attempts?.length ?? 0) > 1).length;
  const avg = total ? Math.round(logs.reduce((s, l) => s + l.ms, 0) / total) : 0;
  const recentErrors = logs.filter((l) => l.error && l.status >= 400).slice(0, 5);

  return (
    <div className="grid gap-6">
      {config.mode === "anthropic" && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <b>Anthropic is the default</b>: every request passes through to Anthropic unchanged, and routes are ignored. Pick a Gemini
            provider under <b>Default</b> at the top right to use them.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requests" value={total} note="last 200 kept" />
        <Stat label="Errors" value={errors} note={total ? `${Math.round((errors / total) * 100)}% of requests` : "—"} tone={errors ? "bad" : undefined} />
        <Stat label="Served after fallback" value={fallbacks} note="needed a second target" />
        <Stat label="Avg latency" value={total ? ms(avg) : "—"} note="whole request" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Routes</CardTitle>
              <CardDescription>Claude Code model family → targets, tried in order</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {FAMILIES.map((f) => (
              <div key={f} className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-sm font-medium capitalize">{f}</span>
                {config.routes[f].map((t, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                    <Badge variant={i === 0 ? "default" : "muted"} className="font-mono text-[11.5px]">
                      {t}
                    </Badge>
                  </span>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Providers</CardTitle>
              <CardDescription>Quick check; use Test on the Providers page for a live call</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {config.providers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <StatusDot ok={p.enabled === false ? undefined : health[p.id]?.ok} />
                  {providerName(p)}
                  {p.enabled === false && <Badge variant="muted">off</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground">{health[p.id]?.detail ?? "…"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Recent errors</CardTitle>
            <CardDescription>Failed requests; see Logs for each attempt</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {recentErrors.length ? (
            <ul className="grid gap-2 text-sm">
              {recentErrors.map((l) => (
                <li key={l.id} className="flex gap-3">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{timeAgo(l.time)}</span>
                  <Badge variant="destructive">{l.status}</Badge>
                  <span className="min-w-0 truncate text-muted-foreground" title={l.error}>
                    <span className="font-mono text-xs text-foreground">{l.modelOut}</span> {l.error}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No errors in the recent requests.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note: string; tone?: "bad" }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </Card>
  );
}
