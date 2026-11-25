import { ExternalLink, GitPullRequest, SquareTerminal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { MainAgent, PullRequest, RouterSummary } from "@server/sessions/types.ts";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { APP_NAME, withoutLinks } from "@/lib/sessions/format";
import { cn } from "@/lib/utils";

/** A ring that fills as the context window fills, turning red when it is nearly full. */
export function ContextRing({ fraction, size = 16 }: { fraction: number; size?: number }) {
  const r = size / 2 - 2;
  const length = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} aria-hidden="true" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className="stroke-border" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        className={fraction > 0.85 ? "stroke-destructive" : "stroke-primary"}
        strokeDasharray={`${length * fraction} ${length}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Small links to the pull requests a session opened, newest first. */
export function PrLinks({ prs, max = 3 }: { prs?: PullRequest[]; max?: number }) {
  if (!prs?.length) return null;
  const shown = [...prs].reverse().slice(0, max);
  return (
    <>
      {shown.map((pr) => (
        <a
          key={pr.url}
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title={`${pr.repo} #${pr.number}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <GitPullRequest className="size-3" />
          PR #{pr.number}
        </a>
      ))}
      {prs.length > max && <span className="text-xs text-muted-foreground">+{prs.length - max}</span>}
    </>
  );
}

const OPEN_NOTE: Record<string, string> = {
  vscode: "Opens in the VS Code window that has this project open. If another folder is in front, VS Code may start a new conversation instead.",
  desktop: "Opens this session in the Claude desktop app.",
};

/** A link that switches to the session in the app it runs in, or a terminal button for terminal sessions. */
export function OpenLink({ agent, strong = false, ended = false }: { agent: MainAgent; strong?: boolean; ended?: boolean }) {
  if (!agent.openUrl) {
    return agent.app === "terminal" && !ended ? <TerminalButton agent={agent} strong={strong} /> : null;
  }
  return (
    <a
      href={agent.openUrl}
      title={OPEN_NOTE[agent.app]}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        strong ? "bg-destructive text-white shadow-xs hover:bg-destructive/90" : "text-primary hover:bg-primary/10",
      )}
    >
      {strong ? `Reply in ${APP_NAME[agent.app]}` : `Open in ${APP_NAME[agent.app]}`}
      <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * A running terminal session: brings its Terminal or iTerm2 window to the front.
 * An ended session (`ended`): opens a new Terminal window that resumes it in its folder.
 */
export function TerminalButton({ agent, strong = false, ended = false }: { agent: MainAgent; strong?: boolean; ended?: boolean }) {
  const [busy, setBusy] = useState(false);
  const open = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const r = await api.openTerminal(agent.sessionId);
      if (r.resumed) toast.success("Resuming in a new Terminal window");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={ended ? "Opens a new Terminal window in the session's folder and resumes it with claude --resume." : "Brings the Terminal or iTerm2 window running this session to the front."}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
        strong ? "bg-destructive text-white shadow-xs hover:bg-destructive/90" : "text-primary hover:bg-primary/10",
      )}
    >
      {ended ? "Resume in Terminal" : strong ? "Reply in Terminal" : "Show terminal"}
      <SquareTerminal className="size-3" />
    </button>
  );
}

/**
 * Claude writes Markdown. This shows the parts that matter for reading, **bold** and `code`,
 * and keeps everything else as plain text with its line breaks. Nothing is rendered as HTML.
 */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  const source = withoutLinks(text);
  let last = 0;
  for (const m of source.matchAll(pattern)) {
    if (m.index > last) parts.push(source.slice(last, m.index));
    parts.push(
      m[1] !== undefined ? (
        <strong key={m.index} className="font-semibold">
          {m[1]}
        </strong>
      ) : (
        <code key={m.index} className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">
          {m[2]}
        </code>
      ),
    );
    last = m.index + m[0].length;
  }
  parts.push(source.slice(last));
  return <>{parts}</>;
}

/** Which provider served the session's latest request through claude-router. */
export function RouterBadge({ router }: { router?: RouterSummary }) {
  if (!router) return null;
  const failed = router.status >= 400;
  const title = `Latest request served by ${router.provider} / ${router.model} (HTTP ${router.status}); ${router.requests} request${router.requests === 1 ? "" : "s"} through the router`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={title}>
      <Badge variant={failed ? "destructive" : "muted"} className="font-mono text-[11px]">
        {failed ? `error ${router.status}` : `${router.provider} · ${router.model}`}
      </Badge>
      {router.fallbacks > 0 && !failed && <Badge variant="warning">fallback ×{router.fallbacks}</Badge>}
    </span>
  );
}

export function ProjectLabel({ project, inProject, branch }: { project: string; inProject: boolean; branch?: string }) {
  const b = branch && branch !== "HEAD" ? branch : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {inProject ? (
        <span className="max-w-[65%] shrink-0 truncate font-medium text-foreground/80" title={project}>
          {project}
        </span>
      ) : (
        <span className="max-w-[65%] shrink-0 truncate" title="Runs outside the projects folder; named after its own folder">
          {project} <span className="text-muted-foreground/70">(no project)</span>
        </span>
      )}
      {b && (
        <span className="min-w-0 truncate rounded bg-muted px-1 py-px font-mono text-[11px]" title={b}>
          {b}
        </span>
      )}
    </span>
  );
}
