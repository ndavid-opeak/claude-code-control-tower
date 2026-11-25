import { Check, Copy } from "lucide-react";
import { DEFAULT_CONTEXT_ALERTS } from "@server/sessions/contextAlerts.ts";
import { Fragment, useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Switch } from "@/components/ui";
import type { AppState } from "@/lib/hooks";

export function Settings({ app }: { app: AppState }) {
  const { config } = app.state!;
  // The router only listens on loopback, so this browser runs on the same machine. Windows gets PowerShell syntax.
  const url = `http://127.0.0.1:${config.port}`;
  const command = navigator.userAgent.includes("Windows") ? `$env:ANTHROPIC_BASE_URL="${url}"; claude` : `ANTHROPIC_BASE_URL=${url} claude`;

  return (
    <div className="grid max-w-3xl gap-4">
      <SessionsSettings app={app} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connect Claude Code</CardTitle>
            <CardDescription>Start Claude Code against the router. Switching mode or routes applies on the next request, no restart needed.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CopyLine text={command} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Where things are stored</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Providers, routes and settings: <code className="font-mono text-xs text-foreground">~/.claude-router/config.json</code> (override with{" "}
            <code className="font-mono text-xs">CLAUDE_ROUTER_HOME</code>).
          </p>
          <p>
            API keys: the repo's <code className="font-mono text-xs text-foreground">.env</code> (mode 600). The dashboard can write keys there but never
            reads them back.
          </p>
          <p>
            Port: <span className="text-foreground tabular-nums">{config.port}</span> (override with <code className="font-mono text-xs">PORT</code>). The
            router only listens on 127.0.0.1.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Debug capture</CardTitle>
            <CardDescription>
              Keep the last 20 Claude Code request bodies in memory, viewable in Logs. They contain your prompts and code, are never written to disk, and are
              lost on restart.
            </CardDescription>
          </div>
          <Switch
            aria-label="Capture request bodies"
            checked={config.capture}
            onCheckedChange={(on) => app.save({ capture: on }, on ? "Capturing request bodies" : "Capture off")}
          />
        </CardHeader>
      </Card>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{text}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

const FAMILIES = ["fable", "opus", "sonnet", "haiku"];
const ALERT_FAMILIES = [...FAMILIES, "other"];
const title = (f: string) => f[0].toUpperCase() + f.slice(1);

/** A number field in thousands of tokens, with a "k" after the number so the unit is clear. */
function KInput(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Input type="number" min={1} {...props} className="pr-7" />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[13px] text-muted-foreground" aria-hidden>
        k
      </span>
    </div>
  );
}

/** Sessions viewer settings (from Claude Office). */
function SessionsSettings({ app }: { app: AppState }) {
  const s = app.state!.config.sessions;
  const [projectsRoot, setProjectsRoot] = useState(s.projectsRoot);
  const [seconds, setSeconds] = useState(String(s.pollMs / 1000));
  const [usageMin, setUsageMin] = useState(String(s.usageCheckMin));
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(FAMILIES.map((f) => [f, s.contextLimits[f] ? String(s.contextLimits[f] / 1000) : ""])),
  );
  // A field holds a size only when it differs from the default; empty shows the default as its placeholder.
  const shown = (f: string, key: "warn" | "danger") => {
    const v = s.contextAlerts?.[f]?.[key];
    return v && v !== DEFAULT_CONTEXT_ALERTS[f][key] ? String(v / 1000) : "";
  };
  const [alerts, setAlerts] = useState<Record<string, { warn: string; danger: string }>>(
    Object.fromEntries(ALERT_FAMILIES.map((f) => [f, { warn: shown(f, "warn"), danger: shown(f, "danger") }])),
  );
  const save = () => {
    const contextAlerts = Object.fromEntries(
      Object.entries(alerts).map(([f, a]) => [
        f,
        {
          warn: a.warn.trim() ? Number(a.warn) * 1000 : DEFAULT_CONTEXT_ALERTS[f].warn,
          danger: a.danger.trim() ? Number(a.danger) * 1000 : DEFAULT_CONTEXT_ALERTS[f].danger,
        },
      ]),
    );
    const contextLimits = Object.fromEntries(
      Object.entries(limits)
        .filter(([, v]) => v.trim() !== "")
        .map(([k, v]) => [k, Number(v) * 1000]),
    );
    void app.save(
      { sessions: { projectsRoot, pollMs: Number(seconds) * 1000, usageCheckMin: Number(usageMin), contextLimits, contextAlerts } },
      "Sessions settings saved",
    );
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>All Claude Code sessions on this machine are shown. A session inside the projects folder is labelled with its project; others with their own folder.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Projects folder" hint="Each folder directly inside it counts as a project.">
          <Input value={projectsRoot} onChange={(e) => setProjectsRoot(e.target.value)} spellCheck={false} className="font-mono text-[13px]" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Refresh every (seconds)">
            <Input type="number" min={1} max={30} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </Field>
          <Field label="Check usage every (minutes)" hint="One tiny Haiku call (about 1,000 tokens), only while the page is open. 0 turns it off.">
            <Input type="number" min={0} max={120} value={usageMin} onChange={(e) => setUsageMin(e.target.value)} />
          </Field>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">Context window size (k = thousands of tokens)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FAMILIES.map((f) => (
              <label key={f} className="grid gap-1 text-xs text-muted-foreground">
                {title(f)}
                <KInput placeholder="Auto" aria-label={`${title(f)} context window size, in thousands of tokens`} value={limits[f]} onChange={(e) => setLimits({ ...limits, [f]: e.target.value })} />
              </label>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Claude does not record the size. Auto uses 1M for current models and 200k for older ones.</span>
        </fieldset>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">Context alerts (k = thousands of tokens)</legend>
          <div className="grid grid-cols-[5rem_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground sm:max-w-md">
            <span />
            <span>Warning (!)</span>
            <span>Danger</span>
            {ALERT_FAMILIES.map((f) => (
              <Fragment key={f}>
                <span>{title(f)}</span>
                <KInput
                  aria-label={`${title(f)} warning size, in thousands of tokens`}
                  placeholder={String(DEFAULT_CONTEXT_ALERTS[f].warn / 1000)}
                  value={alerts[f].warn}
                  onChange={(e) => setAlerts({ ...alerts, [f]: { ...alerts[f], warn: e.target.value } })}
                />
                <KInput
                  aria-label={`${title(f)} danger size, in thousands of tokens`}
                  placeholder={String(DEFAULT_CONTEXT_ALERTS[f].danger / 1000)}
                  value={alerts[f].danger}
                  onChange={(e) => setAlerts({ ...alerts, [f]: { ...alerts[f], danger: e.target.value } })}
                />
              </Fragment>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            A session gets a ! past the warning size and a stop sign past the danger size. Leave a field empty to use the default shown in it. There is
            no official limit; reports put the slip around 200k-250k tokens on 1M models, and smaller models slip sooner.
          </span>
        </fieldset>
        <Button className="justify-self-start" onClick={save}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
