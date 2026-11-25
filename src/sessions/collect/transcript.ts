import fs from 'node:fs';
import path from 'node:path';

export interface TailSummary {
  model?: string;
  contextTokens?: number;
  branch?: string;
  title?: string;
  lastActivityAt?: number;
  lastPromptAt?: number;
  turnEndedAt?: number;
  /** The agent's latest text in the current turn. */
  lastText?: string;
  /** The tool call still running at the end of the tail, if any. */
  activity?: string;
  /** An unanswered question or plan approval. */
  ask?: { kind: 'question' | 'plan'; text: string };
}

const MAX_TEXT = 6000;
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n…' : s);

/** Claude names a project folder after the cwd, with every non-alphanumeric character turned into "-". */
export const slugFor = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const located = new Map<string, string>();

export function findTranscript(projectsDir: string, cwd: string, sessionId: string): string | undefined {
  const cached = located.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;
  const file = `${sessionId}.jsonl`;
  const direct = path.join(projectsDir, slugFor(cwd), file);
  let found = fs.existsSync(direct) ? direct : undefined;
  if (!found) {
    // The session may have moved (worktree, relocated cwd): look in every project folder.
    try {
      for (const dir of fs.readdirSync(projectsDir)) {
        const candidate = path.join(projectsDir, dir, file);
        if (fs.existsSync(candidate)) {
          found = candidate;
          break;
        }
      }
    } catch {
      return undefined;
    }
  }
  if (found) located.set(sessionId, found);
  return found;
}

export function readTailLines(file: string, maxBytes: number): string[] {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is cut off
    return lines.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

const ASK_TOOLS: Record<string, 'question' | 'plan'> = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };

/** The words the user is being asked to answer: each question with its options, or the plan text. */
function askText(name: string, input: any): string {
  if (name === 'ExitPlanMode') return typeof input?.plan === 'string' ? input.plan : '';
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  return questions
    .map((q: any) => [q.question, ...(q.options ?? []).map((o: any) => `  - ${o.label}`)].join('\n'))
    .join('\n\n');
}

export function summarizeTail(lines: string[]): TailSummary {
  const out: TailSummary = {};
  const pending = new Map<string, { name: string; input: unknown }>();
  for (const line of lines) {
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row.gitBranch === 'string' && row.gitBranch) out.branch = row.gitBranch;
    if (row.type === 'ai-title' && row.aiTitle) out.title = row.aiTitle;
    if (row.type === 'custom-title' && row.customTitle) out.title = row.customTitle;
    if (row.type !== 'assistant' && row.type !== 'user') continue;

    const ts = Date.parse(row.timestamp);
    if (!Number.isNaN(ts)) out.lastActivityAt = ts;
    const msg = row.message ?? {};
    const content = Array.isArray(msg.content) ? msg.content : [];

    if (row.type === 'assistant') {
      if (msg.model === '<synthetic>') continue;
      if (msg.model) out.model = msg.model;
      const u = msg.usage;
      if (u) {
        out.contextTokens =
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      }
      for (const block of content) {
        if (block?.type === 'tool_use') pending.set(block.id, { name: block.name, input: block.input });
        if (block?.type === 'text' && block.text?.trim()) out.lastText = clip(block.text.trim());
      }
      if (msg.stop_reason === 'end_turn') out.turnEndedAt = ts;
      continue;
    }

    const results = content.filter((b: any) => b?.type === 'tool_result');
    for (const block of results) pending.delete(block.tool_use_id);
    const kind = row.origin?.kind;
    const isPrompt = kind ? kind === 'human' : results.length === 0 && !row.isMeta;
    if (isPrompt) {
      // A new prompt starts a turn and abandons whatever was still open.
      out.lastPromptAt = ts;
      out.turnEndedAt = undefined;
      out.lastText = undefined;
      pending.clear();
    }
  }
  out.activity = [...pending.values()].at(-1)?.name;
  for (const call of pending.values()) {
    const kind = ASK_TOOLS[call.name];
    if (kind) out.ask = { kind, text: clip(askText(call.name, call.input)) };
  }
  return out;
}

const tails = new Map<string, { size: number; summary: TailSummary }>();

/** Tail summary, re-read only when the file has grown. Values missing from a new tail keep their last known value. */
export function cachedTail(file: string, maxBytes: number): TailSummary {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return {};
  }
  const prev = tails.get(file);
  if (prev && prev.size === size) return prev.summary;
  const next = summarizeTail(readTailLines(file, maxBytes));
  const summary: TailSummary = {
    ...next,
    model: next.model ?? prev?.summary.model,
    contextTokens: next.contextTokens ?? prev?.summary.contextTokens,
    branch: next.branch ?? prev?.summary.branch,
    title: next.title ?? prev?.summary.title,
  };
  tails.set(file, { size, summary });
  return summary;
}
