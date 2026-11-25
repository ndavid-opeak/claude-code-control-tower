import { CheckCircle2, KeyRound, Loader2, Pencil, Plus, Radar, Star, Trash2, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, Field, Input, Select, Switch } from "@/components/ui";
import { api, providerName, type GeminiProvider, type Health, type Provider } from "@/lib/api";
import { useMakeDefault } from "@/components/DefaultProvider";
import { defaultProviderOf } from "@/lib/defaultProvider";
import type { AppState } from "@/lib/hooks";

export function Providers({ app }: { app: AppState }) {
  const { config, keys } = app.state!;
  const [editing, setEditing] = useState<GeminiProvider | "new" | null>(null);
  const [results, setResults] = useState<Record<string, Health | "running">>({});
  const [probing, setProbing] = useState<string | null>(null);
  const makeDefault = useMakeDefault(app);
  const defaultId = defaultProviderOf(config);

  const saveProviders = (providers: Provider[], message: string) => app.save({ providers }, message);

  const test = async (p: Provider) => {
    setResults((r) => ({ ...r, [p.id]: "running" }));
    try {
      const res = await api.test(p.id);
      setResults((r) => ({ ...r, [p.id]: res }));
    } catch (err) {
      setResults((r) => ({ ...r, [p.id]: { ok: false, detail: (err as Error).message } }));
    }
  };

  const probe = async (p: GeminiProvider) => {
    setProbing(p.id);
    try {
      const { models } = await api.probe(p.id);
      toast.success(`${models.length} models answered for ${providerName(p)}`);
      await app.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProbing(null);
    }
  };

  const remove = (p: Provider) => {
    const used = Object.values(config.routes).some((r) => r.some((t) => t === p.id || t.startsWith(`${p.id}/`)));
    if (used) return toast.error(`${providerName(p)} is used in a route; remove it from Routing first.`);
    void saveProviders(config.providers.filter((x) => x.id !== p.id), `Removed ${providerName(p)}`);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Where requests can go. Keys stay in the repo's <code className="font-mono text-xs">.env</code> and are never shown again.
        </p>
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add Gemini provider
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {config.providers.map((p) => {
          const r = results[p.id];
          return (
            <Card key={p.id} className={p.enabled === false ? "opacity-70" : undefined}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    {providerName(p)}
                    <Badge variant="muted" className="font-mono">
                      {p.id}
                    </Badge>
                    {p.id === defaultId && <Badge variant="success">Default</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {p.type === "anthropic"
                      ? "Pass-through to api.anthropic.com using Claude Code's own login"
                      : p.api === "vertex"
                        ? `Vertex AI · project ${p.project} · ${p.location || "global"}`
                        : "Google AI Studio"}
                  </CardDescription>
                </div>
                <Switch
                  aria-label={`Enable ${providerName(p)}`}
                  checked={p.enabled !== false}
                  onCheckedChange={(on) =>
                    saveProviders(
                      config.providers.map((x) => (x.id === p.id ? { ...x, enabled: on } : x)),
                      `${providerName(p)} ${on ? "enabled" : "disabled"}`,
                    )
                  }
                />
              </CardHeader>
              <CardContent className="grid gap-3">
                {p.type === "gemini" && (
                  <div className="grid gap-1.5">
                    {p.keyEnv.map((name) => (
                      <div key={name} className="flex items-center gap-2 text-sm">
                        <KeyRound className="size-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">{name}</span>
                        {keys[name]?.source ? (
                          <Badge variant="success">
                            set {keys[name].source === "env" && "(shell env)"}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">not set</Badge>
                        )}
                      </div>
                    ))}
                    {p.models?.length ? (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {p.models.map((m) => (
                          <Badge key={m} variant="outline" className="font-mono text-[11px]">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No models probed yet.</p>
                    )}
                  </div>
                )}

                {r && r !== "running" && (
                  <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-[13px] ${r.ok ? "bg-success/10" : "bg-destructive/10"}`}>
                    {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                    <span className="break-words">{r.detail}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {p.id !== defaultId && (
                    <Button variant="outline" size="sm" onClick={() => makeDefault.request(p.id)}>
                      <Star /> Make default
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => test(p)} disabled={r === "running"}>
                    {r === "running" ? <Loader2 className="animate-spin" /> : <Zap />} Test
                  </Button>
                  {p.type === "gemini" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => probe(p)} disabled={probing === p.id}>
                        {probing === p.id ? <Loader2 className="animate-spin" /> : <Radar />} Probe models
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        <Pencil /> Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => remove(p)}>
                        <Trash2 /> Remove
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {makeDefault.dialog}
      {editing && (
        <ProviderDialog
          app={app}
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null);
            void test(p);
          }}
        />
      )}
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
}

function uniqueId(base: string, providers: Provider[]) {
  let id = base;
  for (let n = 2; providers.some((p) => p.id === id); n++) id = `${base}-${n}`;
  return id;
}

function ProviderDialog({
  app,
  initial,
  onClose,
  onSaved,
}: {
  app: AppState;
  initial?: GeminiProvider;
  onClose: () => void;
  onSaved: (p: GeminiProvider) => void;
}) {
  const { config, keys } = app.state!;
  const [name, setName] = useState(initial?.name ?? "");
  const [api_, setApi] = useState<"aistudio" | "vertex">(initial?.api ?? "vertex");
  const [project, setProject] = useState(initial?.project ?? "");
  const [location, setLocation] = useState(initial?.location ?? "global");
  const [keyEnv, setKeyEnv] = useState(initial?.keyEnv.join(", ") ?? "");
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState(false);

  const id = initial?.id ?? uniqueId(slug(name || (api_ === "vertex" ? "vertex" : "gemini")) || "gemini", config.providers);
  const envNames = (keyEnv.trim() ? keyEnv : `${id.toUpperCase().replace(/-/g, "_")}_KEY`)
    .split(/[\s,]+/)
    .filter(Boolean);
  const firstKeySet = !!keys[envNames[0]]?.source;

  const submit = async () => {
    if (!initial && config.providers.some((p) => p.id === id)) return toast.error(`A provider with id "${id}" exists`);
    const provider: GeminiProvider = {
      id,
      type: "gemini",
      name: name.trim() || undefined,
      api: api_,
      keyEnv: envNames,
      ...(api_ === "vertex" ? { project: project.trim(), location: location.trim() || "global" } : {}),
      ...(initial?.models ? { models: initial.models } : {}),
      ...(initial?.enabled === false ? { enabled: false } : {}),
    };
    setBusy(true);
    const providers = initial ? config.providers.map((p) => (p.id === id ? provider : p)) : [...config.providers, provider];
    const ok = await app.save({ providers });
    if (ok && keyValue.trim()) {
      try {
        app.setState(await api.setKey(envNames[0], keyValue.trim()));
      } catch (err) {
        toast.error(`Key not saved: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    if (ok) {
      toast.success(`${initial ? "Updated" : "Added"} ${name || id}; testing it now`);
      onSaved(provider);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? `Edit ${providerName(initial)}` : "Add a Gemini provider"}
      description="Requests are translated from Claude Code's format to Gemini's. After saving, the key is tested with a 1-token request."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (api_ === "vertex" && !project.trim())}>
            {busy && <Loader2 className="animate-spin" />} {initial ? "Save" : "Add and test"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" hint={!initial && <>Id: <span className="font-mono">{id}</span> (used in routes)</>}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gemini (Vertex AI)" autoFocus />
        </Field>
        <Field label="Key type">
          <div className="grid grid-cols-2 gap-2">
            {(["vertex", "aistudio"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setApi(a)}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${api_ === a ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted"}`}
              >
                <div className="font-medium">{a === "vertex" ? "Vertex AI" : "AI Studio"}</div>
                <div className="text-xs text-muted-foreground">{a === "vertex" ? "Express-mode key + project" : "Key from aistudio.google.com"}</div>
              </button>
            ))}
          </div>
        </Field>
        {api_ === "vertex" && (
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field label="Project" hint="Project ID or number">
              <Input value={project} onChange={(e) => setProject(e.target.value)} placeholder="123456789012" />
            </Field>
            <Field label="Location" hint="global has the newest models">
              <Select value={location} onChange={(e) => setLocation(e.target.value)}>
                {["global", "us-central1", "europe-west1", "europe-west4", "europe-west3"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label="Key variable(s) in .env" hint="Several names, comma-separated, are tried in order when one is rate-limited.">
          <Input value={keyEnv} onChange={(e) => setKeyEnv(e.target.value)} placeholder={envNames.join(", ")} className="font-mono text-[13px]" />
        </Field>
        <Field label={`Key value for ${envNames[0] ?? "…"}`} hint={firstKeySet ? "Already set; leave empty to keep it." : "Saved to .env, never shown again."}>
          <Input type="password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} placeholder={firstKeySet ? "••••••••" : "Paste key"} autoComplete="off" />
        </Field>
      </div>
    </Dialog>
  );
}
