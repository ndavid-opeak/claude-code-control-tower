import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../config.ts';
import { HISTORY_MS } from './state.ts';

/** A session you flagged to keep an eye on. */
export interface Flag {
  /** When it was flagged. */
  at: number;
  /** When it was last on the board or in Ended recently (updated at most hourly). */
  seen: number;
  note?: string;
}

export const NOTE_MAX = 80;
export const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;
const HOUR = 3_600_000;
const file = () => join(STATE_DIR, 'flags.json');

let flags: Record<string, Flag> | undefined;

export function getFlags(): Record<string, Flag> {
  if (!flags) {
    try {
      flags = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Flag>;
    } catch {
      flags = {};
    }
  }
  return flags;
}

function save(): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file(), JSON.stringify(getFlags(), null, 2) + '\n');
}

/** Flags a session, or changes its note. An empty note removes it. */
export function setFlag(id: string, note: string | undefined, now = Date.now()): void {
  const all = getFlags();
  const text = note?.trim();
  all[id] = { at: all[id]?.at ?? now, seen: now, ...(text ? { note: text } : {}) };
  save();
}

export function clearFlag(id: string): void {
  delete getFlags()[id];
  save();
}

/**
 * Notes which flagged sessions are still on the board or in Ended recently, and drops a flag once its
 * session has been gone longer than Ended recently keeps it. Returns whether anything was dropped.
 */
export function syncFlags(visible: Set<string>, now = Date.now()): boolean {
  const all = getFlags();
  let changed = false;
  let dropped = false;
  for (const [id, flag] of Object.entries(all)) {
    if (visible.has(id)) {
      if (now - flag.seen > HOUR) {
        flag.seen = now;
        changed = true;
      }
    } else if (now - flag.seen > HISTORY_MS + HOUR) {
      delete all[id];
      changed = dropped = true;
    }
  }
  if (changed) save();
  return dropped;
}

/** Tests only: forget the loaded flags so the next read uses the file. */
export function resetFlags(): void {
  flags = undefined;
}
