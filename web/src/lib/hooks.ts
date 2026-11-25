import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Config, type Health, type LogEntry, type State } from "./api";

export interface AppState {
  state: State | null;
  /** Save a config patch; shows a toast and returns false on failure. */
  save: (patch: Partial<Config>, message?: string) => Promise<boolean>;
  setState: (s: State) => void;
  reload: () => Promise<void>;
}

export function useAppState(): AppState {
  const [state, setState] = useState<State | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (err) {
      toast.error(`Could not reach the router: ${(err as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = useCallback(async (patch: Partial<Config>, message?: string) => {
    try {
      setState(await api.save(patch));
      if (message) toast.success(message);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  }, []);
  return { state, save, setState, reload };
}

/** Poll the request log (optionally one session's) every `everyMs` while `live` is true. */
export function useLogs(live = true, everyMs = 2000, session?: string): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const next = await api.logs(session);
        if (!stop) setLogs(next);
      } catch {}
    };
    void tick();
    if (!live) return () => void (stop = true);
    const t = setInterval(tick, everyMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, everyMs, session]);
  return logs;
}

export function useHealth(deps: unknown[] = []): Record<string, Health> {
  const [health, setHealth] = useState<Record<string, Health>>({});
  useEffect(() => {
    api.health().then(setHealth, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return health;
}
