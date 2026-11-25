import { useState } from "react";
import { TONE, type Serving } from "@/components/NowServing";
import { Button, Dialog, Field, Input, Tip } from "@/components/ui";
import { providerName, type Family } from "@/lib/api";
import { defaultProviderOf, familiesMissing, makeDefault } from "@/lib/defaultProvider";
import { useLogs, type AppState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Sessions that sent a request this recently count as running. */
const ACTIVE_MS = 5 * 60_000;

/**
 * `request(id)` makes a provider the default. It first asks for confirmation (running sessions are
 * affected), then for models where the provider's chains have no target.
 */
export function useMakeDefault(app: AppState) {
  const { config } = app.state!;
  const logs = useLogs(true, 5000);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; missing: Family[] } | null>(null);
  const [models, setModels] = useState<Partial<Record<Family, string>>>({});

  const apply = async (id: string, picked: Partial<Record<Family, string>> = {}) => {
    const p = config.providers.find((x) => x.id === id)!;
    const ok = await app.save(makeDefault(config, id, picked), `${providerName(p)} is now the default`);
    if (ok) setPending(null);
  };

  const proceed = (id: string) => {
    setConfirming(null);
    const missing = familiesMissing(config, id);
    if (!missing.length) return void apply(id);
    setModels({});
    setPending({ id, missing });
  };
  const request = (id: string) => setConfirming(id);

  const running = new Set(logs.filter((l) => l.sessionId && Date.now() - new Date(l.time).getTime() < ACTIVE_MS).map((l) => l.sessionId)).size;
  const target = confirming ? config.providers.find((x) => x.id === confirming) : undefined;
  const confirmDialog = target && (
    <Dialog
      open
      onOpenChange={(o) => !o && setConfirming(null)}
      title={`Switch the default to ${providerName(target)}?`}
      description="This applies to the very next request, including sessions that are already running."
      footer={
        <>
          <Button variant="outline" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button onClick={() => proceed(target.id)}>Switch to {providerName(target)}</Button>
        </>
      }
    >
      <p className="text-[13px]">
        {running > 0 ? (
          <strong>
            {running} Claude Code session{running === 1 ? " is" : "s are"} active right now.
          </strong>
        ) : (
          "No Claude Code session has sent a request in the last 5 minutes."
        )}{" "}
        A running session carries on with its next request on the new provider. A different model may not accept the earlier turns (tool calls, thinking blocks), so a session in the middle of a task can fail or lose context and may need restarting.
      </p>
    </Dialog>
  );

  const provider = pending && config.providers.find((x) => x.id === pending.id);
  const suggestions = provider?.type === "gemini" ? (provider.models ?? []) : [];
  const dialog = pending && provider && (
    <Dialog
      open
      onOpenChange={(o) => !o && setPending(null)}
      title={`Make ${providerName(provider)} the default`}
      description="These model families have no target on this provider yet. Pick a model for each; the current targets stay as fallbacks."
      footer={
        <>
          <Button variant="outline" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button disabled={pending.missing.some((f) => !models[f]?.trim())} onClick={() => apply(pending.id, models)}>
            Make default
          </Button>
        </>
      }
    >
      <datalist id="default-models">
        {suggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {pending.missing.map((f) => (
        <Field key={f} label={f[0].toUpperCase() + f.slice(1)}>
          <Input
            className="font-mono text-[13px]"
            list="default-models"
            value={models[f] ?? ""}
            onChange={(e) => setModels((m) => ({ ...m, [f]: e.target.value }))}
            placeholder={suggestions.length ? "Pick or type a model" : "Model id"}
          />
        </Field>
      ))}
    </Dialog>
  );

  return {
    request,
    dialog: (
      <>
        {confirmDialog}
        {dialog}
      </>
    ),
  };
}

/** Header control: one click picks the provider that answers Claude Code first. */
export function DefaultPicker({ app, serving }: { app: AppState; serving?: Serving }) {
  const { config } = app.state!;
  const { request, dialog } = useMakeDefault(app);
  const current = defaultProviderOf(config);

  return (
    <>
      <div className="flex items-center gap-2">
        <span id="provider-label" className="hidden text-[13px] text-muted-foreground md:inline">
          Provider
        </span>
        <div
          role="radiogroup"
          aria-labelledby="provider-label"
          aria-label="Provider"
          className="inline-flex rounded-lg border bg-muted p-0.5 text-[13px]"
        >
          {config.providers.map((p) => {
            const live = serving?.liveId === p.id;
            const tone = TONE[p.type === "gemini" ? "gemini" : "anthropic"];
            return (
              <Tip
                key={p.id}
                side="bottom"
                text={
                  current === p.id
                    ? `Claude Code's requests go to ${providerName(p)} first${live ? ". It answered in the last 90 seconds." : "."}`
                    : current
                      ? `Send Claude Code's requests to ${providerName(p)} first instead`
                      : "Model families start with different providers; see Routing"
                }
              >
                <button
                  role="radio"
                  aria-checked={current === p.id}
                  onClick={() => current !== p.id && request(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground",
                    current === p.id && "bg-card text-foreground shadow-xs",
                  )}
                >
                  <span className="relative flex size-2">
                    {live && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:hidden", tone.dot)} />}
                    <span className={cn("relative inline-flex size-2 rounded-full", tone.dot, current !== p.id && !live && "opacity-40")} />
                  </span>
                  {providerName(p)}
                </button>
              </Tip>
            );
          })}
        </div>
      </div>
      {dialog}
    </>
  );
}
