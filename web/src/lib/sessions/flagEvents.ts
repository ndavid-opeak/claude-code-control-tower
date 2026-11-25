import { createContext, useCallback, useEffect, useRef, useState } from 'react';

/** The parts of a board session these cards look at (kept narrow so tests need no server types). */
export interface Watched {
  agent: { sessionId: string; name: string; state: string; flag?: { note?: string }; contextLevel?: string };
}

// Cards for flagged sessions: one per session, showing the latest thing that happened to it, kept until
// you open the session or close the card.

export type FlagEventKind = 'waiting' | 'done' | 'ended' | 'context';

export interface FlagEvent {
  sessionId: string;
  name: string;
  kind: FlagEventKind;
  at: number;
  note?: string;
}

export const FLAG_EVENT_TEXT: Record<FlagEventKind, string> = {
  waiting: 'is waiting for you',
  done: 'finished its turn',
  ended: 'ended',
  context: 'passed its context danger size',
};

/** What the last snapshot showed of a session, enough to tell what changed. */
export interface Seen {
  state: string;
  flagged: boolean;
  name: string;
  note?: string;
}

/**
 * The events between two snapshots of the board, for flagged sessions only. Nothing fires on the first
 * snapshot (`before` is null) except a context already past danger, and that fires once per session ever
 * (`dangerSeen`).
 */
export function flagEventsBetween(before: Map<string, Seen> | null, sessions: Watched[], dangerSeen: Set<string>, now: number): FlagEvent[] {
  const out: FlagEvent[] = [];
  const live = new Set(sessions.map((s) => s.agent.sessionId));
  for (const { agent } of sessions) {
    if (!agent.flag) continue;
    const base = { sessionId: agent.sessionId, name: agent.name, at: now, note: agent.flag.note };
    const was = before?.get(agent.sessionId)?.state;
    if (before && was !== undefined) {
      if (agent.state === 'waiting' && was !== 'waiting') out.push({ ...base, kind: 'waiting' });
      else if (agent.state === 'done' && (was === 'working' || was === 'waiting')) out.push({ ...base, kind: 'done' });
    }
    if (agent.contextLevel === 'danger' && !dangerSeen.has(agent.sessionId)) out.push({ ...base, kind: 'context' });
  }
  if (before) {
    for (const [id, s] of before) {
      if (s.flagged && !live.has(id)) out.push({ sessionId: id, name: s.name, kind: 'ended', at: now, note: s.note });
    }
  }
  return out;
}

/** Adds new events, one card per session: a newer event replaces that session's card. Newest first. */
export function mergeEvents(events: FlagEvent[], fresh: FlagEvent[]): FlagEvent[] {
  if (fresh.length === 0) return events;
  const bySession = new Map(events.map((e) => [e.sessionId, e]));
  for (const e of fresh) bySession.set(e.sessionId, e);
  return [...bySession.values()].sort((a, b) => b.at - a.at);
}

const KEY = 'flag-events';
const DANGER_KEY = 'flag-events-danger';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept after a reload; the cards still work now.
  }
}

export interface FlagEvents {
  events: FlagEvent[];
  dismiss: (sessionId: string) => void;
  dismissAll: () => void;
}

/** Watches the board for flagged sessions and keeps their cards in this browser until dismissed. */
export function useFlagEvents(sessions: Watched[] | null): FlagEvents {
  const [events, setEvents] = useState<FlagEvent[]>(() => load(KEY, []));
  const previous = useRef<Map<string, Seen> | null>(null);

  useEffect(() => {
    if (!sessions) return;
    const dangerSeen = new Set<string>(load(DANGER_KEY, []));
    const fresh = flagEventsBetween(previous.current, sessions, dangerSeen, Date.now());
    previous.current = new Map(
      sessions.map(({ agent }) => [agent.sessionId, { state: agent.state, flagged: !!agent.flag, name: agent.name, note: agent.flag?.note }]),
    );
    if (fresh.length === 0) return;
    for (const e of fresh) if (e.kind === 'context') dangerSeen.add(e.sessionId);
    store(DANGER_KEY, [...dangerSeen]);
    setEvents((current) => {
      const next = mergeEvents(current, fresh);
      store(KEY, next);
      return next;
    });
  }, [sessions]);

  const dismiss = useCallback((sessionId: string) => {
    setEvents((current) => {
      if (!current.some((e) => e.sessionId === sessionId)) return current;
      const next = current.filter((e) => e.sessionId !== sessionId);
      store(KEY, next);
      return next;
    });
  }, []);
  const dismissAll = useCallback(() => {
    setEvents([]);
    store(KEY, []);
  }, []);

  return { events, dismiss, dismissAll };
}

/** Session ids that have an open card, so the board can outline them. */
export const FlaggedEventIds = createContext<Set<string>>(new Set());
