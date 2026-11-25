import { Activity, Gauge, LayoutGrid, Route, Server, Settings as SettingsIcon, Waypoints, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { DefaultPicker } from "@/components/DefaultProvider";
import { NowServing } from "@/components/NowServing";
import { Badge } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { useWaitingAlerts } from "@/lib/sessions/alerts";
import { historyOf, sessionsOf } from "@/lib/sessions/sessions";
import { useSnapshot } from "@/lib/sessions/useSnapshot";
import { cn } from "@/lib/utils";
import { Analyzer } from "@/pages/Analyzer";
import { Logs } from "@/pages/Logs";
import { Providers } from "@/pages/Providers";
import { Router } from "@/pages/Router";
import { Routing } from "@/pages/Routing";
import { Sessions } from "@/pages/Sessions";
import { Settings } from "@/pages/Settings";

const PAGES = [
  { id: "sessions", label: "Sessions", icon: LayoutGrid },
  { id: "router", label: "Router", icon: Workflow },
  { id: "providers", label: "Providers", icon: Server },
  { id: "routing", label: "Routing", icon: Route },
  { id: "logs", label: "Logs", icon: Activity },
  { id: "analyzer", label: "Analyzer", icon: Gauge },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type PageId = (typeof PAGES)[number]["id"];

function pageFromHash(): PageId {
  const id = location.hash.slice(1);
  return (PAGES.find((p) => p.id === id)?.id ?? "sessions") as PageId;
}

export function App() {
  const app = useAppState();
  const [page, setPage] = useState<PageId>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Sessions are watched on every page, so alerts and the tab title keep working anywhere.
  const { snapshot, connected } = useSnapshot();
  const sessions = useMemo(() => (snapshot ? sessionsOf(snapshot) : []), [snapshot]);
  const history = useMemo(() => (snapshot ? historyOf(snapshot) : []), [snapshot]);
  const sessionNames = useMemo(() => new Map([...sessions, ...history].map((s) => [s.agent.sessionId, s.agent.name])), [sessions, history]);
  const [openId, setOpenId] = useState<string | null>(null);
  const openSession = useCallback((id: string) => {
    setOpenId(id);
    location.hash = "sessions";
  }, []);
  const alerts = useWaitingAlerts(snapshot ? sessions : null, openSession);
  const waiting = sessions.filter((s) => s.agent.state === "waiting").length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) claude-router` : "claude-router";
  }, [waiting]);

  const current = PAGES.find((p) => p.id === page)!;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-card md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4 md:px-5 md:py-5">
          <div className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waypoints className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">claude-router</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`#${p.id}`}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                page === p.id && "bg-muted font-medium text-foreground",
              )}
            >
              <p.icon className="size-4" />
              {p.label}
              {p.id === "sessions" && waiting > 0 && (
                <Badge variant="destructive" className="ml-auto tabular-nums" title={`${waiting} waiting for you`}>
                  {waiting}
                </Badge>
              )}
            </a>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <h1 className="text-lg font-semibold tracking-tight">{current.label}</h1>
          {app.state && (
            <div className="flex items-center gap-3">
              <NowServing config={app.state.config} />
              <DefaultPicker app={app} />
            </div>
          )}
        </header>
        {page === "sessions" ? (
          <Sessions snapshot={snapshot} connected={connected} sessions={sessions} history={history} alerts={alerts} openId={openId} setOpenId={setOpenId} />
        ) : (
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
            {!app.state ? (
              <p className="text-sm text-muted-foreground">Connecting to the router…</p>
            ) : page === "router" ? (
              <Router app={app} />
            ) : page === "providers" ? (
              <Providers app={app} />
            ) : page === "routing" ? (
              <Routing app={app} />
            ) : page === "logs" ? (
              <Logs app={app} sessionNames={sessionNames} />
            ) : page === "analyzer" ? (
              <Analyzer />
            ) : (
              <Settings app={app} />
            )}
          </div>
        )}
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
