import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { FAMILIES, providerName, type Family } from "@/lib/api";
import type { AppState } from "@/lib/hooks";

const FAMILY_NOTE: Record<Family, string> = {
  opus: "Main model for hard tasks (claude-opus-*)",
  sonnet: "Default model and most subagents (claude-sonnet-* and anything else)",
  haiku: "Fast background calls: titles, summaries, checks (claude-haiku-*)",
};

export function Routing({ app }: { app: AppState }) {
  const { config } = app.state!;
  const [routes, setRoutes] = useState(config.routes);
  const [cooldown, setCooldown] = useState(String(config.fallback.cooldownSec));
  const [timeout, setTimeout_] = useState(String(Math.round(config.fallback.timeoutMs / 1000)));
  useEffect(() => setRoutes(config.routes), [config.routes]);

  const dirty =
    JSON.stringify(routes) !== JSON.stringify(config.routes) ||
    Number(cooldown) !== config.fallback.cooldownSec ||
    Number(timeout) * 1000 !== config.fallback.timeoutMs;

  const update = (f: Family, next: string[]) => setRoutes((r) => ({ ...r, [f]: next }));
  const save = () =>
    app.save({ routes, fallback: { cooldownSec: Number(cooldown), timeoutMs: Number(timeout) * 1000 } }, "Routing saved");

  return (
    <div className="grid gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 bg-background/90 px-1 py-1 backdrop-blur">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each request tries its family's targets top to bottom. A target that errors before replying (HTTP error, network, timeout) hands the
          request to the next one. Claude Code never sees the failed tries.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!dirty} onClick={() => setRoutes(config.routes)}>
            <RotateCcw /> Discard
          </Button>
          <Button disabled={!dirty} onClick={save}>
            <Save /> Save
          </Button>
        </div>
      </div>

      {FAMILIES.map((f) => (
        <ChainEditor key={f} family={f} chain={routes[f]} onChange={(n) => update(f, n)} app={app} />
      ))}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Fallback behaviour</CardTitle>
            <CardDescription>After an auth, quota (429) or server error, a key is skipped for the cooldown. A 400 is not cooled down.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid max-w-md gap-4 sm:grid-cols-2">
          <Field label="Cooldown (seconds)">
            <Input type="number" min={0} max={3600} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
          </Field>
          <Field label="Upstream timeout (seconds)">
            <Input type="number" min={1} max={3600} value={timeout} onChange={(e) => setTimeout_(e.target.value)} />
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}

function ChainEditor({ family, chain, onChange, app }: { family: Family; chain: string[]; onChange: (c: string[]) => void; app: AppState }) {
  const { config } = app.state!;
  const [providerId, setProviderId] = useState(config.providers.find((p) => p.type === "gemini")?.id ?? "anthropic");
  const [model, setModel] = useState("");
  const provider = config.providers.find((p) => p.id === providerId);
  const suggestions = provider?.type === "gemini" ? (provider.models ?? []) : [];

  const move = (i: number, d: -1 | 1) => {
    const next = [...chain];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const entry = provider?.type === "anthropic" ? provider.id : `${providerId}/${model.trim()}`;
    if (provider?.type === "gemini" && !model.trim()) return;
    if (!chain.includes(entry)) onChange([...chain, entry]);
    setModel("");
  };
  const listId = `models-${family}`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="capitalize">{family}</CardTitle>
          <CardDescription>{FAMILY_NOTE[family]}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ol className="grid gap-1.5">
          {chain.map((t, i) => {
            const [pid, ...rest] = t.split("/");
            const p = config.providers.find((x) => x.id === pid);
            const off = !p || p.enabled === false;
            return (
              <li key={t} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
                <span className="grid size-5 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-muted-foreground">{p ? providerName(p) : pid}</span>
                  <span className="mx-1.5 text-muted-foreground/60">/</span>
                  <span className="font-mono text-[13px]">{rest.join("/") || "same Claude model"}</span>
                </span>
                {!p && <Badge variant="destructive">unknown provider</Badge>}
                {p && off && <Badge variant="muted">disabled, skipped</Badge>}
                <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === chain.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(chain.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            );
          })}
          {!chain.length && <li className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">No targets: requests for this family will fail.</li>}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Provider">
            {config.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {providerName(p)}
              </option>
            ))}
          </Select>
          {provider?.type === "gemini" && (
            <>
              <Input
                className="w-64 font-mono text-[13px]"
                list={listId}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder={suggestions.length ? "Pick or type a model" : "Model id (probe to get suggestions)"}
                aria-label="Model"
              />
              <datalist id={listId}>
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </>
          )}
          <Button variant="outline" onClick={add}>
            <Plus /> Add target
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
