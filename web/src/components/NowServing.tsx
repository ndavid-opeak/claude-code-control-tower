import { useEffect, useState } from "react";
import { Tip } from "@/components/ui";
import { FAMILIES, providerName, type Config, type Family, type LogEntry } from "@/lib/api";
import { primaryOf } from "@/lib/defaultProvider";
import { useLogs } from "@/lib/hooks";

/** A reply this recent counts as "live"; older than this the router is idle. */
const LIVE_MS = 90_000;

function familyOf(model: string): Family {
  return FAMILIES.find((f) => model.includes(f)) ?? "sonnet";
}

export const TONE = {
  gemini: { dot: "bg-blue-500", chip: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  anthropic: { dot: "bg-orange-500", chip: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400" },
} as const;

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export interface Serving {
  /** The provider that answered within the last 90 seconds, if any. */
  liveId?: string;
  /** Set when that answer came from a provider other than the first in line, because the first failed. */
  fallback?: { from: string; to: string; model: string; at: number };
}

/** Who is answering Claude Code right now, from the router's recent requests. */
export function useServing(config: Config | undefined): Serving {
  const logs = useLogs(true, 2000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const last: LogEntry | undefined = logs.find((l) => l.path.includes("/v1/messages") && l.provider !== "-");
  if (!config || !last) return {};
  const at = new Date(last.time).getTime();
  if (now - at >= LIVE_MS) return {};
  const primary = primaryOf(config, familyOf(last.modelIn));
  const fellBack = (last.attempts?.length ?? 0) > 1 || last.provider !== primary;
  return { liveId: last.provider, fallback: fellBack ? { from: primary, to: last.provider, model: last.modelOut, at } : undefined };
}

/** Shown in the header only after a request fell back to another provider. */
export function FallbackNote({ config, serving }: { config: Config; serving: Serving }) {
  const f = serving.fallback;
  if (!f) return null;
  const name = (id: string) => {
    const p = config.providers.find((x) => x.id === id);
    return p ? providerName(p) : id;
  };
  return (
    <Tip text={`${name(f.from)} failed, so ${name(f.to)} answered with ${f.model} (${ago(Date.now() - f.at)}). Logs has the details.`} side="bottom">
      <a href="#logs" className="hidden rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning sm:inline">
        Fell back to {name(f.to)}
      </a>
    </Tip>
  );
}
