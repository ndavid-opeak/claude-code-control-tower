import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { LogTable } from "@/components/LogTable";
import { Button, Card, Select, Switch } from "@/components/ui";
import { useLogs, type AppState } from "@/lib/hooks";

export function Logs({ app, sessionNames }: { app: AppState; sessionNames: Map<string, string> }) {
  const { config } = app.state!;
  const [live, setLive] = useState(true);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [session, setSession] = useState("");
  const all = useLogs(live);
  const sessions = [...new Set(all.map((l) => l.sessionId).filter((s): s is string => !!s))];
  const logs = all.filter((l) => (!onlyErrors || l.status >= 400 || (l.attempts?.length ?? 0) > 1) && (!session || l.sessionId === session));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Select value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session" className="max-w-64">
            <option value="">All sessions</option>
            {sessions.map((id) => (
              <option key={id} value={id}>
                {sessionNames.get(id) ?? id.slice(0, 8)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2">
            <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} /> Errors and fallbacks only
          </label>
          <label className="flex items-center gap-2" title="Keeps the last 20 request bodies in memory (never on disk)">
            <Switch checked={config.capture} onCheckedChange={(on) => app.save({ capture: on }, on ? "Capturing request bodies" : "Capture off")} />
            Capture request bodies
          </label>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLive((l) => !l)}>
          {live ? <Pause /> : <Play />} {live ? "Pause" : "Resume"}
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <LogTable
          logs={logs}
          sessionNames={sessionNames}
          empty={
            <>
              No requests yet. Start Claude Code with <code className="font-mono text-xs">ANTHROPIC_BASE_URL=http://127.0.0.1:{config.port}</code>
            </>
          }
        />
      </Card>
    </div>
  );
}
