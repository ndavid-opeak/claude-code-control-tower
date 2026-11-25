import fs from 'node:fs';
import path from 'node:path';

export interface DesktopMeta {
  /** The desktop app's own id for the session (local_...), used in its links. */
  hostId?: string;
  title?: string;
  originCwd?: string;
  statusCategory?: string;
  statusDetail?: string;
  needsAction?: string | boolean;
  interrupted?: boolean;
}

const cache = new Map<string, { mtimeMs: number; keys: string[]; meta: DesktopMeta }>();

/**
 * Desktop app session metadata, keyed by every id a session may be known by
 * (file id with and without the "local_" prefix, and the CLI session id).
 */
export function readDesktopSessions(root: string): Map<string, DesktopMeta> {
  const out = new Map<string, DesktopMeta>();
  for (const file of listSessionFiles(root)) {
    try {
      const mtimeMs = fs.statSync(file).mtimeMs;
      let entry = cache.get(file);
      if (!entry || entry.mtimeMs !== mtimeMs) {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        const fileId = path.basename(file, '.json');
        entry = {
          mtimeMs,
          keys: [fileId, fileId.replace(/^local_/, ''), j.sessionId, j.cliSessionId].filter(
            (k): k is string => typeof k === 'string' && k.length > 0,
          ),
          meta: {
            hostId: fileId,
            title: j.title,
            originCwd: j.originCwd,
            statusCategory: j.postTurnSummary?.status_category,
            statusDetail: j.postTurnSummary?.status_detail,
            needsAction: j.postTurnSummary?.needs_action,
            interrupted: j.interruptedAwaitingPerson === true,
          },
        };
        cache.set(file, entry);
      }
      for (const key of entry.keys) out.set(key, entry.meta);
    } catch {
      // Unreadable or mid-write: skip this poll.
    }
  }
  return out;
}

function listSessionFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
      else if (e.isFile() && /^local_.+\.json$/.test(e.name)) files.push(full);
    }
  };
  walk(root, 0);
  return files;
}
