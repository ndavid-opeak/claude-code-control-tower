import { useEffect, useState } from 'react';
import type { Snapshot } from '@server/sessions/types.ts';

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    const source = new EventSource('/api/sessions/stream');
    source.onopen = () => setConnected(true);
    source.onmessage = (e) => setSnapshot(JSON.parse(e.data));
    source.onerror = () => setConnected(false); // the browser retries by itself
    return () => source.close();
  }, []);
  return { snapshot, connected };
}

export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
