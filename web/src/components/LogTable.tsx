import { ChevronRight, FileJson } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge, Button, statusVariant } from "@/components/ui";
import { api, type LogEntry } from "@/lib/api";
import { cn, ms, timeAgo } from "@/lib/utils";

/** Router requests with every attempt; rows expand. Used by the Logs page and the session panel's Router tab. */
export function LogTable({
  logs,
  sessionNames,
  empty,
  compact = false,
}: {
  logs: LogEntry[];
  /** When given, a Session column shows each request's session title. */
  sessionNames?: Map<string, string>;
  empty: ReactNode;
  /** Narrow layout for the session panel. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const cols = (compact ? 5 : 7) + (sessionNames ? 1 : 0);
  return (
    <table className={cn("w-full text-sm", !compact && "min-w-[820px]")}>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="w-8" />
          <th className="py-2.5 pr-3 font-medium">Time</th>
          {sessionNames && <th className="py-2.5 pr-3 font-medium">Session</th>}
          {!compact && <th className="py-2.5 pr-3 font-medium">Claude model</th>}
          <th className="py-2.5 pr-3 font-medium">Served by</th>
          <th className="py-2.5 pr-3 font-medium">Status</th>
          <th className="py-2.5 pr-3 text-right font-medium">Latency</th>
          {!compact && <th className="py-2.5 pr-5 text-right font-medium">Tokens in / out</th>}
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <Fragment key={l.id}>
            <tr onClick={() => setOpen(open === l.id ? null : l.id)} className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/60", open === l.id && "bg-muted/60")}>
              <td className="pl-3">
                <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open === l.id && "rotate-90")} />
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground tabular-nums" title={l.time}>
                {timeAgo(l.time)}
              </td>
              {sessionNames && (
                <td className="max-w-[14rem] truncate py-2 pr-3 text-[13px]" title={l.sessionId}>
                  {l.sessionId ? (sessionNames.get(l.sessionId) ?? <span className="font-mono text-xs text-muted-foreground">{l.sessionId.slice(0, 8)}</span>) : <span className="text-muted-foreground">—</span>}
                </td>
              )}
              {!compact && <td className="py-2 pr-3 font-mono text-[12.5px]">{l.modelIn}</td>}
              <td className="py-2 pr-3">
                <span className="text-muted-foreground">{l.provider}</span> <span className="font-mono text-[12.5px]">{l.modelOut}</span>
                {(l.attempts?.length ?? 0) > 1 && (
                  <Badge variant="warning" className="ml-2">
                    fallback ×{l.attempts!.length - 1}
                  </Badge>
                )}
              </td>
              <td className="py-2 pr-3">
                <Badge variant={statusVariant(l.status)}>{l.status}</Badge>
              </td>
              <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">{ms(l.ms)}</td>
              {!compact && (
                <td className="py-2 pr-5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                  {l.inputTokens != null ? `${l.inputTokens.toLocaleString()} / ${l.outputTokens?.toLocaleString()}` : "—"}
                </td>
              )}
            </tr>
            {open === l.id && (
              <tr className="border-b bg-muted/30">
                <td colSpan={cols} className="px-5 py-4">
                  <LogDetail entry={l} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {!logs.length && (
          <tr>
            <td colSpan={cols} className="px-5 py-10 text-center text-muted-foreground">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function LogDetail({ entry }: { entry: LogEntry }) {
  const [body, setBody] = useState<string | null>(null);
  const loadBody = async () => {
    try {
      const full = await api.log(entry.id);
      const raw = full.capture?.request ?? "";
      try {
        setBody(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        setBody(raw);
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="text-xs text-muted-foreground">
        {new Date(entry.time).toLocaleString()} · {entry.stream ? "streaming" : "non-streaming"} · {entry.modelIn}
        {entry.inputTokens != null && ` · ${entry.inputTokens.toLocaleString()} in / ${entry.outputTokens?.toLocaleString()} out`}
      </div>
      <ol className="grid gap-1.5">
        {(entry.attempts ?? []).map((a, i) => (
          <li key={i} className="flex items-start gap-3 text-[13px]">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-card text-[11px] font-medium tabular-nums ring-1 ring-border">{i + 1}</span>
            <Badge variant={statusVariant(a.status)} className="shrink-0">
              {a.status || "no reply"}
            </Badge>
            <span className="shrink-0">
              {a.provider} <span className="font-mono text-[12px]">{a.model}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{ms(a.ms)}</span>
            {a.error && <span className="min-w-0 break-words text-muted-foreground">{a.error}</span>}
          </li>
        ))}
      </ol>
      {entry.error && <p className="text-[13px]">Note: {entry.error}</p>}
      {entry.captured &&
        (body === null ? (
          <Button variant="outline" size="sm" className="justify-self-start" onClick={loadBody}>
            <FileJson /> Show captured request
          </Button>
        ) : (
          <pre className="max-h-96 overflow-auto rounded-lg border bg-card p-3 font-mono text-[11.5px] leading-relaxed">{body}</pre>
        ))}
    </div>
  );
}
