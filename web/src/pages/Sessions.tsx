import { useEffect, useState } from "react";
import type { Snapshot } from "@server/sessions/types.ts";
import type { Session } from "@/lib/sessions/sessions";
import { usePanelWidth } from "@/lib/sessions/usePanelWidth";
import { CanFocusTerminal } from "./sessions/bits";
import { Board } from "./sessions/Board";
import { SessionPanel, type PanelView } from "./sessions/SessionPanel";
import { UsageStrip, type Alerts } from "./sessions/UsageStrip";

interface Props {
  snapshot: Snapshot | null;
  connected: boolean;
  sessions: Session[];
  history: Session[];
  alerts: Alerts;
  openId: string | null;
  setOpenId: (id: string | null | ((cur: string | null) => string | null)) => void;
}

/** Every Claude Code session on this Mac (from Claude Office), with a resizable detail panel. */
export function Sessions({ snapshot, connected, sessions, history, alerts, openId, setOpenId }: Props) {
  const [view, setView] = useState<PanelView>("overview");
  const panel = usePanelWidth();
  const open = sessions.find((s) => s.agent.sessionId === openId) ?? history.find((s) => s.agent.sessionId === openId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the panel unless a dialog is open; the dialog handles its own Escape.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) setOpenId(null);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [setOpenId]);

  if (!snapshot) {
    return <p className="px-4 py-6 text-sm text-muted-foreground md:px-8">{connected ? "Looking for Claude sessions…" : disconnected}</p>;
  }

  return (
    <CanFocusTerminal.Provider value={snapshot.canFocusTerminal ?? true}>
      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-5">
            {!connected && <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">{disconnected}</p>}
            <UsageStrip snapshot={snapshot} alerts={alerts} />
            <p className="-mb-2 px-1 text-[13px] text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"} running on this machine
            </p>
            <Board sessions={sessions} history={history} openId={openId} onOpen={(id) => setOpenId((cur) => (cur === id ? null : id))} />
          </div>
        </div>
        {open && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the session panel"
              aria-valuenow={panel.width}
              aria-valuemin={panel.min}
              tabIndex={0}
              title="Drag to resize. Double-click to reset."
              onPointerDown={panel.onPointerDown}
              onKeyDown={panel.onKeyDown}
              onDoubleClick={panel.reset}
              className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-1.5 shrink-0 cursor-col-resize border-l bg-border/40 outline-none hover:bg-primary/30 focus-visible:bg-primary/40 md:block"
            />
            <div className="fixed inset-0 z-30 md:sticky md:top-14 md:z-auto md:h-[calc(100dvh-3.5rem)] md:shrink-0">
              <div className="h-full md:w-[var(--panel-w)]" style={{ ["--panel-w" as string]: `${panel.width}px` }}>
                <SessionPanel session={open} view={view} onView={setView} onClose={() => setOpenId(null)} />
              </div>
            </div>
          </>
        )}
      </div>
    </CanFocusTerminal.Provider>
  );
}

const disconnected = "Lost contact with the router. Check that it is still running in the terminal; this page reconnects by itself.";
