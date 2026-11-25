import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ReviewRunner } from '../../src/analyzer/review.ts';
import type { Report } from '../../src/analyzer/types.ts';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-router-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'review-files-'));
process.env.CLAUDE_ROUTER_HOME = stateDir;

const flagged = path.join(work, 'CLAUDE.md');
fs.writeFileSync(flagged, Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
const transcript = path.join(work, 'transcript.jsonl');
fs.writeFileSync(transcript, 'RAW-TRANSCRIPT-TEXT');

const report: Report = {
  score: 80,
  window: 30,
  ranAt: 1000,
  categories: { usage: 100, context: 85, duplicates: 100, hygiene: 100 },
  findings: [
    { id: 'context/big:1', category: 'context', severity: 'medium', points: 8, title: 'Big memory file', detail: 'too long', file: flagged, line: 20, fix: 'trim it' },
    { id: 'usage/x:1', category: 'usage', severity: 'low', points: 3, title: 'No file', detail: 'd', fix: 'f' },
  ],
};

const calls: { prompt: string; cwd: string }[] = [];
let runner: ReviewRunner = async (input) => {
  calls.push(input);
  return '1. Trim CLAUDE.md first.';
};

let app: Hono;
let review: typeof import('../../src/analyzer/review.ts');
beforeAll(async () => {
  review = await import('../../src/analyzer/review.ts');
  const { analyzerRoutes } = await import('../../src/analyzer/routes.ts');
  app = new Hono();
  analyzerRoutes(app, { runReview: (i) => runner(i) });
});

const post = (url: string) => app.request(url, { method: 'POST' });
const saveReport = () => fs.writeFileSync(path.join(stateDir, 'analyzer-report.json'), JSON.stringify(report));

describe('analyzer review', () => {
  it('refuses to estimate or review when there is no report', async () => {
    expect((await post('/api/analyzer/review/estimate')).status).toBe(404);
    expect((await post('/api/analyzer/review')).status).toBe(404);
  });

  it('estimates tokens for the findings and the flagged lines only', async () => {
    saveReport();
    const { tokens } = await (await post('/api/analyzer/review/estimate')).json();
    const prompt = review.buildPrompt(report);
    expect(tokens).toBe(Math.ceil(prompt.length / 4));
    expect(prompt).toContain('Big memory file');
    expect(prompt).toContain('line 20');
    expect(prompt).toContain('line 17');
    expect(prompt).not.toContain('line 40');
    expect(calls).toHaveLength(0);
  });

  it('runs in its own folder, saves the advice with the report and returns it after reload', async () => {
    const res = await post('/api/analyzer/review');
    expect(res.status).toBe(200);
    expect((await res.json()).review).toMatchObject({ advice: '1. Trim CLAUDE.md first.' });
    expect(calls).toHaveLength(1);
    expect(calls[0].cwd).toBe(review.REVIEW_DIR);
    expect(fs.existsSync(review.REVIEW_DIR)).toBe(true);
    const saved = await (await app.request('/api/analyzer/report')).json();
    expect(saved.review.advice).toBe('1. Trim CLAUDE.md first.');
  });

  it('refuses a second review while one is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    runner = async () => {
      await gate;
      return 'done';
    };
    const first = post('/api/analyzer/review');
    await new Promise((r) => setTimeout(r, 20));
    expect((await post('/api/analyzer/review')).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it('shows a runner failure as an error, then allows another review', async () => {
    runner = async () => {
      throw new Error('The claude command was not found.');
    };
    const res = await post('/api/analyzer/review');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('not found');
    runner = async () => 'ok';
    expect((await post('/api/analyzer/review')).status).toBe(200);
  });

  it('only sends excerpts of flagged files, never transcripts', () => {
    const r: Report = { ...report, findings: [{ ...report.findings[0], file: transcript, line: undefined }] };
    const prompt = review.buildPrompt(r);
    expect(prompt).not.toContain('RAW-TRANSCRIPT-TEXT');
  });
});

describe('claude invocation', () => {
  it('uses print mode, Sonnet, no tools, JSON output, no saved session', () => {
    const args = review.claudeArgs('SYS');
    expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'sonnet', '--output-format', 'json', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('drops the router base URL so the call goes straight to Anthropic', () => {
    expect(review.reviewEnv({ ANTHROPIC_BASE_URL: 'http://localhost:8080', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('reads the answer from claude JSON output and reports an error result', () => {
    expect(review.parseOutput(JSON.stringify({ is_error: false, result: 'advice' }))).toBe('advice');
    expect(() => review.parseOutput(JSON.stringify({ is_error: true, result: 'Credit balance too low' }))).toThrow('Credit balance');
    expect(() => review.parseOutput('not json')).toThrow();
  });

  it('recognises the review folder so the Sessions board can skip it', () => {
    expect(review.isReviewCwd(review.REVIEW_DIR)).toBe(true);
    expect(review.isReviewCwd('/Users/me/project')).toBe(false);
  });
});
