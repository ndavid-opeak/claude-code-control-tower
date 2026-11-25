import type { MainAgent, MainState, PastSession, Snapshot } from '@server/sessions/types.ts';

export interface Session {
  agent: MainAgent;
  project: string;
  /** False when the session runs outside the projects folder (then `project` is its own folder). */
  inProject: boolean;
  /** A session that is no longer running, shown from its transcript. */
  ended?: boolean;
}

export function sessionsOf(snapshot: Snapshot): Session[] {
  return snapshot.tables.flatMap((t) =>
    t.agents.map((agent) => ({
      agent,
      // A session outside the projects folder is named after the folder it runs in.
      project: t.id === 'elsewhere' ? (agent.cwd.split('/').filter(Boolean).at(-1) ?? t.name) : t.name,
      inProject: t.id !== 'elsewhere',
    })),
  );
}

/** Ended sessions in the same shape as live ones, so the panel can show them. */
export function historyOf(snapshot: Snapshot): Session[] {
  return (snapshot.history ?? []).map((h: PastSession) => ({
    project: h.project,
    inProject: h.inProject ?? true,
    ended: true,
    agent: {
      sessionId: h.sessionId,
      pid: 0,
      name: h.name,
      cwd: h.cwd,
      app: h.app,
      openUrl: h.openUrl,
      branch: h.branch,
      model: h.model,
      state: 'done',
      since: h.endedAt,
      output: h.lastText,
      startedAt: h.endedAt,
      lastActivityAt: h.endedAt,
      prs: h.prs,
      subagents: [],
      router: h.router,
    },
  }));
}

export const COLUMNS: { state: MainState; title: string; empty: string }[] = [
  { state: 'waiting', title: 'Waiting for me', empty: 'Nobody is waiting for you.' },
  { state: 'working', title: 'Working', empty: 'Nothing is running.' },
  { state: 'done', title: 'Done', empty: 'No finished sessions.' },
];

/** Longest wait first, longest-running turn first, most recently finished first. Sessions with no activity sit under Done. */
export function inColumn(sessions: Session[], state: MainState): Session[] {
  const list = sessions.filter((s) => s.agent.state === state || (state === 'done' && s.agent.state === 'idle'));
  if (state === 'waiting') return list.sort((a, b) => (a.agent.since ?? 0) - (b.agent.since ?? 0));
  if (state === 'working') return list.sort((a, b) => (a.agent.turnStartedAt ?? 0) - (b.agent.turnStartedAt ?? 0));
  return list.sort((a, b) => (b.agent.since ?? 0) - (a.agent.since ?? 0));
}
