import fs from 'node:fs';
import path from 'node:path';

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  entrypoint?: string;
  name?: string;
  /** "derived" when Claude made the name up from the folder. */
  nameSource?: string;
  status: string;
  waitingFor?: string;
  statusUpdatedAt?: number;
  hostSessionId?: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Live sessions from ~/.claude/sessions/<pid>.json. The *.key files beside them are never opened. */
export function readRegistry(dir: string, alive: (pid: number) => boolean = isAlive): LiveSession[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (typeof j.pid !== 'number' || typeof j.sessionId !== 'string' || typeof j.cwd !== 'string') continue;
      if (!alive(j.pid)) continue;
      out.push({
        pid: j.pid,
        sessionId: j.sessionId,
        cwd: j.cwd,
        startedAt: typeof j.startedAt === 'number' ? j.startedAt : Date.now(),
        entrypoint: j.entrypoint,
        name: j.name,
        nameSource: j.nameSource,
        status: typeof j.status === 'string' ? j.status : 'idle',
        waitingFor: j.waitingFor,
        statusUpdatedAt: j.statusUpdatedAt,
        hostSessionId: j.hostSessionId,
      });
    } catch {
      // A file caught mid-write is picked up on the next poll.
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}
