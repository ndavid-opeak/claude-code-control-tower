import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { FAMILIES, providerName, type Config, type Family, type LogEntry } from "@/lib/api";
import { primaryOf } from "@/lib/defaultProvider";
import { useLogs } from "@/lib/hooks";
import { cn } from "@/lib/utils";

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

/** Header chip showing which provider is answering Claude Code right now (or last did). */
export function NowServing({ config }: { config: Config }) {
  const logs = useLogs(true, 2000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const last: LogEntry | undefined = logs.find((l) => l.path.includes("/v1/messages") && l.provider !== "-");
  const live = !!last && now - new Date(last.time).getTime() < LIVE_MS;
  const providerOf = (id: string) => config.providers.find((p) => p.id === id);

  // Live: show who actually answered. Idle: show who would answer next.
  const shownId = live ? last!.provider : primaryOf(config, last ? familyOf(last.modelIn) : "sonnet");
  const shown = providerOf(shownId);
  const tone = TONE[shown?.type === "gemini" ? "gemini" : "anthropic"];
  const name = shown ? providerName(shown) : shownId;
  const fellBack = live && !!last && (last.attempts?.length ?? 0) > 1;
  const offPrimary = live && !!last && last.provider !== primaryOf(config, familyOf(last.modelIn));

  return (
    <div
      className={cn("flex items-center gap-2 rounded-lg border px-3 py-1 text-[13px] font-medium", tone.chip, !live && "opacity-70")}
      title={last ? `Last request: ${last.modelIn} → ${last.provider}/${last.modelOut} (${ago(now - new Date(last.time).getTime())})` : "No requests yet"}
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {live && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", tone.dot)} />}
        <span className={cn("relative inline-flex size-2 rounded-full", tone.dot)} />
      </span>
      <span>
        {live ? "Serving" : "Next"}: {name}
      </span>
      {live && last && <span className="hidden font-normal opacity-80 md:inline">{last.modelOut}</span>}
      {!live && last && <span className="hidden font-normal opacity-80 md:inline">idle · {ago(now - new Date(last.time).getTime())}</span>}
      {(fellBack || offPrimary) && (
        <Badge variant="warning" title="The primary provider failed, so a fallback answered">
          fallback
        </Badge>
      )}
    </div>
  );
}
