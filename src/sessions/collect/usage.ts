import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PullRequest, UsageWindow } from '../types.ts';

const WEEK = 7 * 24 * 3_600_000;
/** Token counts are kept in 5-minute buckets for the last 6 hours, enough to cover a 5-hour limit window. */
const BUCKET = 5 * 60_000;
const KEEP_BUCKETS = 6 * 3_600_000;

export interface PlanUsage {
  session?: UsageWindow;
  week?: UsageWindow;
  fetchedAt?: number;
}

/** Claude's own saved copy: the cachedUsageUtilization key of ~/.claude.json. Claude rarely refreshes it. */
export function parsePlanUsage(json: any): PlanUsage {
  const cached = json?.cachedUsageUtilization;
  const u = cached?.utilization ?? {};
  const win = (w: any): UsageWindow | undefined =>
    w && typeof w.utilization === 'number'
      ? { percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined }
      : undefined;
  return {
    session: win(u.five_hour),
    week: win(u.seven_day),
    fetchedAt: typeof cached?.fetchedAtMs === 'number' ? cached.fetchedAtMs : undefined,
  };
}

let planCache: { mtimeMs: number; usage: PlanUsage } | undefined;

export function readPlanUsage(claudeJsonPath: string): PlanUsage {
  try {
    const mtimeMs = fs.statSync(claudeJsonPath).mtimeMs;
    if (planCache?.mtimeMs !== mtimeMs) {
      planCache = { mtimeMs, usage: parsePlanUsage(JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'))) };
    }
    return planCache.usage;
  } catch {
    return planCache?.usage ?? {};
  }
}

/**
 * Live figures from the rate_limit_event Claude prints in stream-json output:
 * utilization is 0 to 1 and resetsAt is in seconds.
 */
export function parseRateLimitEvent(output: string): Omit<PlanUsage, 'fetchedAt'> | undefined {
  for (const line of output.split('\n')) {
    if (!line.includes('rate_limit_event')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const windows = row.rate_limit_info?.unifiedWindows;
    if (row.type !== 'rate_limit_event' || !windows) continue;
    const win = (w: any): UsageWindow | undefined =>
      w && typeof w.utilization === 'number'
        ? { percent: Math.round(w.utilization * 100), resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined }
        : undefined;
    return { session: win(windows.five_hour), week: win(windows.seven_day) };
  }
  return undefined;
}

export function withoutRouterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ANTHROPIC_BASE_URL: _url, ANTHROPIC_AUTH_TOKEN: _token, ...rest } = env;
  return rest;
}

/** Sessions in this folder are the app's own usage checks, not your work. */
export const USAGE_CHECK_DIR = 'claude-office-usage-check';

/**
 * Asks Claude for the current limits by making one very small Haiku call (about a thousand tokens).
 * It runs in an empty folder with only project settings, so none of your hooks, plugins or MCP servers load,
 * and it saves no transcript. Your Claude login is used by the claude command itself; this app never reads it.
 */
export class LiveUsage {
  latest?: PlanUsage;
  /** Why the last check failed, in plain words. */
  problem?: string;
  checking = false;

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const cwd = path.join(os.tmpdir(), USAGE_CHECK_DIR);
      fs.mkdirSync(cwd, { recursive: true });
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          'claude',
          [
            '-p',
            'Reply with the single word OK.',
            '--model',
            'haiku',
            '--output-format',
            'stream-json',
            '--verbose',
            '--no-session-persistence',
            '--system-prompt',
            'Reply with the single word OK.',
            '--tools',
            '',
            '--strict-mcp-config',
            '--disable-slash-commands',
            '--setting-sources',
            'project',
          ],
          // Without these, a router started from a shell pointed at itself would send this check through
          // the router (maybe to Gemini), and the reply would carry no Anthropic limits.
          { cwd, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: withoutRouterEnv(process.env) },
          (err, stdout) => (stdout ? resolve(stdout) : reject(err ?? new Error('no output'))),
        );
      });
      const parsed = parseRateLimitEvent(output);
      if (parsed) {
        this.latest = { ...parsed, fetchedAt: Date.now() };
        this.problem = undefined;
      } else {
        this.problem = 'Claude answered without limit figures (they are only reported for subscription plans).';
      }
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
      this.problem = missing
        ? 'The claude command was not found. Start Claude Office from a terminal where "claude" works.'
        : 'The usage check did not finish. It will be tried again.';
    } finally {
      this.checking = false;
    }
  }
}

export function familyOf(model: string): string {
  return ['fable', 'opus', 'sonnet', 'haiku'].find((f) => model.includes(f)) ?? 'other';
}

export interface WindowTokens {
  byModel: Record<string, number>;
  /** Session id -> tokens, subagents included in their session. */
  bySession: Record<string, number>;
}

/**
 * One incremental pass over the transcripts changed in the last 7 days. It collects each session's title,
 * the largest context each model family has reached (evidence of how big that model's window really is),
 * and recent token use per session and model (input, output and cache writes; cache reads are left out).
 */
export class TranscriptScanner {
  maxContext: Record<string, number> = {};
  private projectsDir: string;
  private scanning = false;
  private offsets = new Map<string, number>();
  private titles = new Map<string, { ai?: string; custom?: string }>(); // session id -> titles
  private seen = new Map<string, number>(); // message id -> bucket, so a reply split over rows counts once
  private recent = new Map<number, Map<string, number>>(); // bucket -> "session|family" -> tokens
  private prs = new Map<string, Map<string, PullRequest>>(); // session id -> PR url -> PR
  private info = new Map<string, { cwd?: string; entrypoint?: string; file?: string }>(); // session id -> where it ran

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  async scan(now = Date.now()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const file of await listRecent(this.projectsDir, now - WEEK)) {
        await this.scanFile(file).catch(() => {});
      }
    } finally {
      this.scanning = false;
    }
  }

  /** Tokens used since `since`, per model family and per session. */
  windowTokens(since: number, now = Date.now()): WindowTokens {
    const out: WindowTokens = { byModel: {}, bySession: {} };
    const first = Math.floor(since / BUCKET);
    for (const [bucket, counts] of this.recent) {
      if (bucket * BUCKET < now - KEEP_BUCKETS) {
        this.recent.delete(bucket);
        continue;
      }
      if (bucket < first) continue;
      for (const [key, n] of counts) {
        const [session, family] = key.split('|');
        out.byModel[family] = (out.byModel[family] ?? 0) + n;
        out.bySession[session] = (out.bySession[session] ?? 0) + n;
      }
    }
    for (const [id, bucket] of this.seen) if (bucket * BUCKET < now - KEEP_BUCKETS) this.seen.delete(id);
    return out;
  }

  /** Pull requests a session opened or linked, oldest first. */
  prsOf(sessionId: string): PullRequest[] {
    return [...(this.prs.get(sessionId)?.values() ?? [])];
  }

  /** Main transcripts seen in the last 7 days, with where each session ran. */
  sessions(): { sessionId: string; file: string; cwd?: string; entrypoint?: string }[] {
    return [...this.info.entries()]
      .filter(([, i]) => i.file)
      .map(([sessionId, i]) => ({ sessionId, file: i.file!, cwd: i.cwd, entrypoint: i.entrypoint }));
  }

  /** The title the user gave the session, else the one Claude wrote for it. */
  titleOf(sessionId: string): string | undefined {
    const t = this.titles.get(sessionId);
    return t?.custom || t?.ai;
  }

  private async scanFile(file: string): Promise<void> {
    const fh = await fs.promises.open(file, 'r');
    try {
      const size = (await fh.stat()).size;
      let offset = this.offsets.get(file) ?? 0;
      if (size < offset) offset = 0;
      let carry = Buffer.alloc(0);
      const chunk = Buffer.alloc(4 * 1024 * 1024);
      // A subagent's transcript sits in <session>/subagents/, and its tokens count toward that session.
      const isSubagent = path.basename(path.dirname(file)) === 'subagents';
      const session = isSubagent ? path.basename(path.dirname(path.dirname(file))) : path.basename(file, '.jsonl');
      if (!isSubagent) this.info.set(session, { ...this.info.get(session), file });
      while (offset < size) {
        const { bytesRead } = await fh.read(chunk, 0, Math.min(chunk.length, size - offset), offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
        const lastNewline = data.lastIndexOf(10);
        if (lastNewline === -1) {
          carry = data;
          continue;
        }
        for (const line of data.subarray(0, lastNewline).toString('utf8').split('\n')) this.addLine(line, session);
        carry = Buffer.from(data.subarray(lastNewline + 1));
      }
      // An unfinished last line is re-read next time.
      this.offsets.set(file, offset - carry.length);
    } finally {
      await fh.close();
    }
  }

  private addLine(line: string, session: string): void {
    const isTitle = line.includes('-title"');
    const isPr = line.includes('"pr-link"');
    const where = !this.info.get(session)?.cwd && line.includes('"cwd"');
    if (!isTitle && !isPr && !where && (!line.includes('"usage"') || !line.includes('"assistant"'))) return;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (where && typeof row.cwd === 'string' && !row.isSidechain) {
      this.info.set(session, { ...this.info.get(session), cwd: row.cwd, entrypoint: row.entrypoint });
    }
    if (row.type === 'pr-link' && typeof row.prUrl === 'string') {
      const prs = this.prs.get(session) ?? new Map<string, PullRequest>();
      prs.set(row.prUrl, { number: row.prNumber, url: row.prUrl, repo: row.prRepository ?? '' });
      this.prs.set(session, prs);
      return;
    }
    if (row.type === 'ai-title' && row.aiTitle) this.titles.set(session, { ...this.titles.get(session), ai: row.aiTitle });
    if (row.type === 'custom-title' && row.customTitle) {
      this.titles.set(session, { ...this.titles.get(session), custom: row.customTitle });
    }
    const msg = row.message;
    if (row.type !== 'assistant' || !msg?.usage || !msg.model || msg.model === '<synthetic>') return;
    const context =
      (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    const family = familyOf(msg.model);
    if (context > (this.maxContext[family] ?? 0)) this.maxContext[family] = context;

    const at = Date.parse(row.timestamp);
    if (!msg.id || Number.isNaN(at) || at < Date.now() - KEEP_BUCKETS || this.seen.has(msg.id)) return;
    const bucket = Math.floor(at / BUCKET);
    this.seen.set(msg.id, bucket);
    const tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    const counts = this.recent.get(bucket) ?? new Map<string, number>();
    const key = `${session}|${family}`;
    counts.set(key, (counts.get(key) ?? 0) + tokens);
    this.recent.set(bucket, counts);
  }
}

async function listRecent(root: string, since: number): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) await walk(full, depth + 1);
      } else if (e.name.endsWith('.jsonl')) {
        const stat = await fs.promises.stat(full).catch(() => undefined);
        if (stat && stat.mtimeMs >= since) files.push(full);
      }
    }
  };
  await walk(root, 0);
  return files;
}
