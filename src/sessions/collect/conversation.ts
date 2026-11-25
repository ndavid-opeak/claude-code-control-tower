import fs from 'node:fs';
import type { ConversationItem, ConversationPage } from '../types.ts';

const WINDOW_BYTES = 1.5 * 1024 * 1024;
const MAX_TEXT = 20_000;
const MAX_RESULT = 1_500;

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() + '\n…' : s);

/** Claude Code wraps some of what it adds to a prompt in tags; those are not what you typed. */
const stripInjected = (s: string) =>
  s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<\/?pasted_content[^>]*>/g, '').trim();

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n');
}

/** A few words saying what a tool call was about, for the collapsed step list. */
export function describeTool(name: string, input: any): string {
  const s = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const base = (p: unknown) => s(p).split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  switch (name) {
    case 'Bash':
      return s(input?.description) || s(input?.command).slice(0, 120);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return base(input?.file_path ?? input?.notebook_path);
    case 'Grep':
    case 'Glob':
      return s(input?.pattern);
    case 'Agent':
    case 'Task':
      return s(input?.description);
    case 'WebSearch':
      return s(input?.query);
    case 'WebFetch':
      try {
        return new URL(s(input?.url)).host;
      } catch {
        return '';
      }
    default: {
      const first = Object.values(input ?? {}).find((v) => typeof v === 'string');
      return s(first).slice(0, 120);
    }
  }
}

/** The tool's short name: an MCP tool like mcp__server__browser_click reads as browser_click. */
export const toolName = (name: string) => (name.startsWith('mcp__') ? (name.split('__').at(-1) ?? name) : name);

function askText(input: any): string {
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  return questions
    .map((q: any) => [q.question, ...(q.options ?? []).map((o: any) => `  - ${o.label}`)].join('\n'))
    .join('\n\n');
}

/** Your answers to a question, from the structured result, one line per question. */
function answerText(result: any, fallback: string): string {
  const answers = result?.answers;
  if (answers && typeof answers === 'object') {
    return Object.entries(answers)
      .map(([q, a]) => `${q}\n→ ${a}`)
      .join('\n\n');
  }
  return fallback;
}

/**
 * Turns transcript rows into the conversation as a person reads it: your prompts, Claude's replies,
 * the steps it took with their results, questions it asked with your answers, and plans with your decision.
 * Thinking, injected context and bookkeeping rows are left out.
 */
export function parseConversation(lines: string[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const byToolId = new Map<string, ConversationItem>();

  for (const line of lines) {
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type !== 'user' && row.type !== 'assistant') continue;
    if (row.isSidechain) continue;
    const at = Date.parse(row.timestamp) || undefined;
    const content = row.message?.content;

    if (row.type === 'assistant') {
      if (row.message?.model === '<synthetic>') continue;
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'text' && block.text?.trim()) {
          const last = items.at(-1);
          // One reply often arrives as several rows; show it as one message.
          if (last?.kind === 'claude' && last.messageId === row.message?.id) {
            last.text = clip(`${last.text}\n\n${block.text.trim()}`, MAX_TEXT);
          } else {
            items.push({ kind: 'claude', text: clip(block.text.trim(), MAX_TEXT), at, messageId: row.message?.id });
          }
        } else if (block?.type === 'tool_use') {
          let item: ConversationItem;
          if (block.name === 'AskUserQuestion') item = { kind: 'ask', text: askText(block.input), at };
          else if (block.name === 'ExitPlanMode') item = { kind: 'plan', text: clip(String(block.input?.plan ?? ''), MAX_TEXT), at };
          else item = { kind: 'tool', name: toolName(block.name), text: describeTool(block.name, block.input), at };
          items.push(item);
          byToolId.set(block.id, item);
        }
      }
      continue;
    }

    // A user row is either the results of tool calls, or something said to Claude.
    const results = Array.isArray(content) ? content.filter((b: any) => b?.type === 'tool_result') : [];
    for (const block of results) {
      const item = byToolId.get(block.tool_use_id);
      if (!item) continue;
      const text = textOf(block.content).trim();
      if (item.kind === 'ask') item.answer = clip(answerText(row.toolUseResult, text), MAX_RESULT);
      else if (item.kind === 'plan') item.answer = block.is_error ? clip(text, MAX_RESULT) : 'Approved';
      else item.result = { text: clip(text, MAX_RESULT), error: block.is_error === true };
    }
    if (results.length > 0 || row.isMeta) continue;

    const text = stripInjected(textOf(content));
    if (!text) continue;
    if (row.origin?.kind === 'task-notification') {
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim();
      items.push({ kind: 'note', text: summary ?? 'A background task finished', at });
    } else if (row.origin?.kind === 'peer') {
      items.push({ kind: 'note', text: 'Message from another Claude session', at });
    } else if (!text.startsWith('<')) {
      items.push({ kind: 'you', text: clip(text, MAX_TEXT), at });
    }
  }
  for (const item of items) delete item.messageId;
  return items;
}

/** Never parse more than this much in one request, however far back you have scrolled. */
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * A session's conversation from byte `from` to the end of the transcript (default: the last WINDOW_BYTES).
 * `cursor` is where this page starts, to ask for earlier messages with `from = cursor - WINDOW_BYTES`,
 * or null when it starts at the beginning.
 */
export function readConversation(file: string, from?: number): ConversationPage {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let start = from === undefined ? size - WINDOW_BYTES : Math.min(from, size);
    start = Math.max(0, start, size - MAX_BYTES);
    // Read from one byte early so a start that is already at a row boundary keeps that row.
    const begin = start > 0 ? start - 1 : 0;
    const buf = Buffer.alloc(size - begin);
    fs.readSync(fd, buf, 0, buf.length, begin);
    let offset = 0;
    let body = buf;
    if (start > 0) {
      const firstNewline = buf.indexOf(10);
      if (firstNewline === -1) return { items: [], cursor: start, size };
      offset = begin + firstNewline + 1;
      body = buf.subarray(firstNewline + 1);
    }
    const lines = body.toString('utf8').split('\n').filter(Boolean);
    return { items: parseConversation(lines), cursor: offset > 0 ? offset : null, size };
  } finally {
    fs.closeSync(fd);
  }
}

export const PAGE_BYTES = WINDOW_BYTES;
