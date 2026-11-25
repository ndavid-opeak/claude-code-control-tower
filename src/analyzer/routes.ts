import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { STATE_DIR } from '../config.ts';
import { analyze } from './analyze.ts';
import { buildPrompt, estimateTokens, REVIEW_DIR, runClaude, type ReviewRunner } from './review.ts';
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

export interface AnalyzerOptions {
  /** Asks Claude for the review; tests pass a fake. */
  runReview?: ReviewRunner;
}

export function analyzerRoutes(app: Hono, { runReview = runClaude }: AnalyzerOptions = {}): void {
  let reviewing = false;

  app.get('/api/analyzer/report', (c) => {
    c.header('cache-control', 'no-store');
    return c.json(loadReport());
  });

  app.post('/api/analyzer/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { window?: unknown };
    const window = body.window ?? 30;
    if (window !== 7 && window !== 30) return c.json({ error: 'window must be 7 or 30' }, 400);
    const report = analyze({ ...claudePaths(), now: Date.now(), window: window as Window });
    // A paid review survives a rerun; when only the window changed it is marked as made for the earlier run.
    const previous = loadReport();
    if (previous?.review) {
      const { advice } = previous.review;
      const note = `> Made for the earlier ${previous.window}-day run.\n\n`;
      report.review = { ...previous.review, advice: previous.window === report.window || advice.startsWith('> Made for the earlier') ? advice : note + advice };
    }
    saveReport(report);
    return c.json(report);
  });

  app.post('/api/analyzer/review/estimate', (c) => {
    const report = loadReport();
    if (!report) return c.json({ error: 'run the analysis first' }, 404);
    return c.json({ tokens: estimateTokens(buildPrompt(report)) });
  });

  app.post('/api/analyzer/review', async (c) => {
    const report = loadReport();
    if (!report) return c.json({ error: 'run the analysis first' }, 404);
    if (reviewing) return c.json({ error: 'A review is already running.' }, 409);
    reviewing = true;
    try {
      fs.mkdirSync(REVIEW_DIR, { recursive: true });
      const advice = await runReview({ prompt: buildPrompt(report), cwd: REVIEW_DIR });
      // A new run during the review replaced the report; the advice would not match it.
      if (loadReport()?.ranAt !== report.ranAt) return c.json({ error: 'The report changed while Claude was reviewing. Review again.' }, 409);
      const reviewed = { ...report, review: { at: Date.now(), advice } };
      saveReport(reviewed);
      return c.json(reviewed);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    } finally {
      reviewing = false;
    }
  });
}
