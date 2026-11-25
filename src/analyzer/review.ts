import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from '../config.ts';
import type { Report } from './types.ts';

// "Ask Claude to review": sends the report's findings plus short excerpts of the flagged files to `claude -p`.

/** Where the review runs. Its sessions are not your work, so the Sessions board skips them. */
export const REVIEW_DIR = path.join(STATE_DIR, 'analyzer-review');

export const isReviewCwd = (cwd: string) => cwd === REVIEW_DIR || cwd.endsWith(path.sep + 'analyzer-review');

/** Runs one review and returns Claude's advice. Injected into the routes so tests never call the real CLI. */
export type ReviewRunner = (input: { prompt: string; cwd: string }) => Promise<string>;

const CONTEXT_LINES = 3;
const HEAD_LINES = 20;
const MAX_EXCERPT_CHARS = 3000;
const MAX_FILES = 15;

const SYSTEM_PROMPT =
  'You review a Claude Code setup. You get an automated report: findings, each with a title, detail, suggested fix and sometimes an excerpt of the flagged file. ' +
  'Reply with a numbered list of advice, most valuable first. For each item say what to change, where, and why it matters, in plain language. ' +
  'Merge findings that share a cause, call out any finding that looks like a false alarm, and do not invent files or settings that are not in the report.';

/** Flagged lines with a little context. Transcripts are never excerpted. */
function excerpt(file: string, line?: number): string | undefined {
  if (file.endsWith('.jsonl')) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const lines = text.split('\n');
  const from = line ? Math.max(0, line - 1 - CONTEXT_LINES) : 0;
  const to = line ? Math.min(lines.length, line + CONTEXT_LINES) : Math.min(lines.length, HEAD_LINES);
  return lines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}: ${l}`)
    .join('\n')
    .slice(0, MAX_EXCERPT_CHARS);
}

export function buildPrompt(report: Report): string {
  const parts = [`Score ${report.score}/100 over the last ${report.window} days. Findings, worst first:`];
  let files = 0;
  for (const f of report.findings) {
    parts.push(`\n[${f.severity}] ${f.title} (${f.id})\n${f.detail}\nSuggested fix: ${f.fix}`);
    if (f.project) parts.push(`Project: ${f.project}`);
    if (!f.file) continue;
    parts.push(`File: ${f.file}${f.line ? `:${f.line}` : ''}`);
    const text = files < MAX_FILES ? excerpt(f.file, f.line) : undefined;
    if (text) {
      files++;
      parts.push('```\n' + text + '\n```');
    }
  }
  return parts.join('\n');
}

/** Characters ÷ 4, like the rest of the Analyzer. The short system prompt is not counted. */
export const estimateTokens = (prompt: string) => Math.ceil(prompt.length / 4);

export function claudeArgs(systemPrompt = SYSTEM_PROMPT): string[] {
  return [
    '-p',
    '--model',
    'sonnet',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--system-prompt',
    systemPrompt,
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    'project',
  ];
}

/** Straight to Anthropic: without these a router pointed at itself would send the review through the router. */
export function reviewEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ANTHROPIC_BASE_URL: _url, ANTHROPIC_AUTH_TOKEN: _token, ...rest } = env;
  return rest;
}

export function parseOutput(stdout: string): string {
  let out: { is_error?: boolean; result?: unknown };
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new Error('Claude answered with something unreadable.');
  }
  if (out.is_error) throw new Error(`Claude could not finish the review: ${typeof out.result === 'string' ? out.result : 'unknown error'}`);
  if (typeof out.result !== 'string' || !out.result.trim()) throw new Error('Claude returned no advice.');
  return out.result.trim();
}

/** The real thing: the prompt goes in on stdin. Your Claude login is used by the claude command itself. */
export const runClaude: ReviewRunner = ({ prompt, cwd }) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      claudeArgs(),
      { cwd, timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024, env: reviewEnv(process.env) },
      (err, stdout) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return reject(new Error('The claude command was not found. Start Claude Router from a terminal where "claude" works.'));
        try {
          resolve(parseOutput(stdout));
        } catch (parseErr) {
          reject(err ? new Error(`The review did not finish: ${err.message}`) : parseErr);
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
