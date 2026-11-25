import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './types.ts';

/** This repo lives inside the projects folder, so its parent is the default root (as in Claude Office). */
const REPO = fileURLToPath(new URL('../..', import.meta.url));

export function defaultSessionsConfig(): Config {
  return { projectsRoot: path.dirname(path.resolve(REPO)), contextLimits: {}, pollMs: 2000, usageCheckMin: 5 };
}

/** Returns the merged settings, or a message saying what is wrong with the change. (From Claude Office.) */
export function applyConfigPatch(current: Config, patch: any): Config | string {
  const next = { ...current };
  if (patch.projectsRoot !== undefined) {
    const root = String(patch.projectsRoot).replace(/^~(?=\/|$)/, os.homedir());
    if (!path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return `"${patch.projectsRoot}" is not a folder on this Mac. Enter a full path such as ~/Desktop/Projects.`;
    }
    next.projectsRoot = root;
  }
  if (patch.pollMs !== undefined) {
    const ms = Number(patch.pollMs);
    if (!Number.isFinite(ms)) return 'Refresh interval must be a number of seconds.';
    next.pollMs = Math.min(30_000, Math.max(1000, Math.round(ms)));
  }
  if (patch.usageCheckMin !== undefined) {
    const min = Number(patch.usageCheckMin);
    if (!Number.isFinite(min) || min < 0) return 'Usage check interval must be a number of minutes, or 0 to turn it off.';
    next.usageCheckMin = Math.min(120, Math.round(min));
  }
  if (patch.contextLimits !== undefined) {
    const limits: Record<string, number> = {};
    for (const [key, value] of Object.entries(patch.contextLimits ?? {})) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) limits[key] = Math.round(n);
    }
    next.contextLimits = limits;
  }
  return next;
}
