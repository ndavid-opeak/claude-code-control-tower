import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONTEXT_ALERTS } from './contextAlerts.ts';
import type { Config } from './types.ts';

export { DEFAULT_CONTEXT_ALERTS };

/** This repo lives inside the projects folder, so its parent is the default root (as in Claude Office). */
const REPO = fileURLToPath(new URL('../..', import.meta.url));

export function defaultSessionsConfig(): Config {
  return {
    projectsRoot: path.dirname(path.resolve(REPO)),
    contextLimits: {},
    pollMs: 2000,
    usageCheckMin: 5,
    contextAlerts: structuredClone(DEFAULT_CONTEXT_ALERTS),
  };
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
  if (patch.contextAlerts !== undefined) {
    const alerts = { ...DEFAULT_CONTEXT_ALERTS, ...current.contextAlerts };
    for (const [family, value] of Object.entries<any>(patch.contextAlerts ?? {})) {
      if (!(family in DEFAULT_CONTEXT_ALERTS)) return `"${family}" is not a model family. Use fable, opus, sonnet, haiku or other.`;
      const warn = Number(value?.warn);
      const danger = Number(value?.danger);
      if (!(warn > 0) || !(danger > 0)) return `Context alert sizes for ${family} must be numbers of tokens above 0.`;
      if (warn >= danger) return `The warning size for ${family} must be below its danger size.`;
      alerts[family] = { warn: Math.round(warn), danger: Math.round(danger) };
    }
    next.contextAlerts = alerts;
  }
  return next;
}
