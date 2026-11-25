import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { STATE_DIR } from '../config.ts';
import { analyze } from './analyze.ts';
import type { Report, Window } from './types.ts';

const REPORT_FILE = path.join(STATE_DIR, 'analyzer-report.json');

/** Claude Code's home folder and .claude.json; CLAUDE_CONFIG_DIR moves both, as it does for Claude Code. */
function claudePaths(): { claudeHome: string; claudeJsonPath: string } {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir) return { claudeHome: dir, claudeJsonPath: path.join(dir, '.claude.json') };
  return { claudeHome: path.join(os.homedir(), '.claude'), claudeJsonPath: path.join(os.homedir(), '.claude.json') };
}

function loadReport(): Report | null {
  try {
    return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')) as Report;
  } catch {
    return null;
  }
}

/** Only the latest report is kept: each run replaces it. */
function saveReport(report: Report): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
}

export function analyzerRoutes(app: Hono): void {
  app.get('/api/analyzer/report', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(loadReport());
  });

  app.post('/api/analyzer/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { window?: unknown };
    const window = body.window ?? 30;
    if (window !== 7 && window !== 30) return c.json({ error: 'window must be 7 or 30' }, 400);
    const report = analyze({ ...claudePaths(), now: Date.now(), window: window as Window });
    saveReport(report);
    return c.json(report);
  });
}
