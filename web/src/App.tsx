import { Activity, Gauge, LayoutGrid, Route, Server, Settings as SettingsIcon, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { DefaultPicker } from "@/components/DefaultProvider";
import { FallbackNote, useServing } from "@/components/NowServing";
import { ThemeSwitch, useTheme } from "@/components/ThemeSwitch";
import { Badge, TipProvider } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { useWaitingAlerts } from "@/lib/sessions/alerts";
import { FlaggedEventIds, useFlagEvents } from "@/lib/sessions/flagEvents";
import { FlagEventCards } from "@/components/FlagEventCards";
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
  const serving = useServing(app.state?.config);
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [theme, setTheme] = useTheme();
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
  const flagEvents = useFlagEvents(snapshot ? sessions : null);
  const flaggedIds = useMemo(() => new Set(flagEvents.events.map((e) => e.sessionId)), [flagEvents.events]);
  // Opening a session counts as seeing its card.
  const { dismiss: dismissFlagEvent } = flagEvents;
  useEffect(() => {
    if (openId) dismissFlagEvent(openId);
  }, [openId, dismissFlagEvent]);
  const waiting = sessions.filter((s) => s.agent.state === "waiting").length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) claude-code-control-tower` : "claude-code-control-tower";
  }, [waiting]);

  const current = PAGES.find((p) => p.id === page)!;

  return (
    <TipProvider>
    <FlaggedEventIds.Provider value={flaggedIds}>
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="z-30 flex flex-col border-b bg-card md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4 md:px-5 md:py-5">
          <img src="/favicon.svg" alt="" className="size-7 rounded-md dark:ring-1 dark:ring-white/25" />
          <span className="font-semibold tracking-tight">Control Tower</span>
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
        <ThemeSwitch theme={theme} onChange={setTheme} className="mx-4 mb-3 self-start md:mx-5 md:mt-auto md:mb-5" />
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/55 px-4 backdrop-blur-xl backdrop-saturate-150 md:px-8">
          <h1 className="text-lg font-semibold tracking-tight">{current.label}</h1>
          {app.state && (
            <div className="flex items-center gap-3">
              <FallbackNote config={app.state.config} serving={serving} />
              <DefaultPicker app={app} serving={serving} />
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
      <FlagEventCards events={flagEvents.events} onOpen={openSession} onDismiss={flagEvents.dismiss} onDismissAll={flagEvents.dismissAll} />
      <Toaster position="bottom-right" richColors closeButton theme={theme} />
    </div>
    </FlaggedEventIds.Provider>
    </TipProvider>
  );
}
