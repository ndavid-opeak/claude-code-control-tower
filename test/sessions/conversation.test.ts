import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeTool, parseConversation, readConversation, toolName } from '../../src/sessions/collect/conversation.ts';

const row = (o: object) => JSON.stringify(o);
const ts = '2026-11-24T10:00:00Z';
const said = (text: unknown, extra: object = {}) =>
  row({ type: 'user', timestamp: ts, origin: { kind: 'human' }, message: { content: text }, ...extra });
const reply = (id: string, content: object[]) => row({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5-5', content } });
const result = (id: string, content: unknown, extra: object = {}) =>
  row({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });

describe('parseConversation', () => {
  it('keeps prompts and replies, merges a reply split over rows, and drops thinking', () => {
    const items = parseConversation([
      said('Fix the login bug'),
      reply('m1', [{ type: 'thinking', thinking: 'hmm' }]),
      reply('m1', [{ type: 'text', text: 'Looking now.' }]),
      reply('m1', [{ type: 'text', text: 'Found it.' }]),
    ]);
    expect(items).toEqual([
      { kind: 'you', text: 'Fix the login bug', at: Date.parse(ts) },
      { kind: 'claude', text: 'Looking now.\n\nFound it.', at: Date.parse(ts) },
    ]);
  });

  it('pairs each step with its result and flags failures', () => {
    const items = parseConversation([
      reply('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]),
      result('t1', 'Tests 3 passed'),
      reply('m2', [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/src/app.ts' } }]),
      result('t2', [{ type: 'text', text: 'ENOENT' }], { message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ENOENT', is_error: true }] } }),
    ]);
    expect(items.map((i) => [i.name, i.text, i.result])).toEqual([
      ['Bash', 'Run the tests', { text: 'Tests 3 passed', error: false }],
      ['Read', 'app.ts', { text: 'ENOENT', error: true }],
    ]);
  });

  it('shows a question with your answers, and a plan with your decision', () => {
    const items = parseConversation([
      reply('m1', [
        { type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } },
      ]),
      result('q', 'Your questions have been answered', { toolUseResult: { answers: { 'Which?': 'B' } } }),
      reply('m2', [{ type: 'tool_use', id: 'p', name: 'ExitPlanMode', input: { plan: '# Plan' } }]),
    ]);
    expect(items[0]).toMatchObject({ kind: 'ask', text: 'Which?\n  - A\n  - B', answer: 'Which?\n→ B' });
    expect(items[1]).toMatchObject({ kind: 'plan', text: '# Plan' });
    expect(items[1].answer).toBeUndefined();
    const approved = parseConversation([
      reply('m2', [{ type: 'tool_use', id: 'p', name: 'ExitPlanMode', input: { plan: '# Plan' } }]),
      result('p', 'User has approved your plan.'),
    ]);
    expect(approved[0].answer).toBe('Approved');
  });

  it('leaves out injected context, meta rows and subagent rows, and notes background updates', () => {
    const items = parseConversation([
      said('<system-reminder>context</system-reminder>Real question'),
      said('<command-name>/model</command-name>'),
      said('internal', { isMeta: true }),
      said('agent row', { isSidechain: true }),
      row({ type: 'user', timestamp: ts, origin: { kind: 'task-notification' }, message: { content: '<task-notification><summary>Agent "Map files" finished</summary></task-notification>' } }),
      row({ type: 'system', subtype: 'turn_duration' }),
      '{broken',
    ]);
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ['you', 'Real question'],
      ['note', 'Agent "Map files" finished'],
    ]);
  });

  it('names steps briefly', () => {
    expect(toolName('mcp__Claude_Browser__browser_batch')).toBe('browser_batch');
    expect(describeTool('WebFetch', { url: 'https://example.com/a/b' })).toBe('example.com');
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('TODO');
  });
});

describe('readConversation', () => {
  it('reads the end by default and continues from an earlier position without losing or splitting rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-office-convo-'));
    const file = path.join(dir, 's.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => said(`message ${i}`));
    fs.writeFileSync(file, lines.join('\n') + '\n');
    try {
      const all = readConversation(file);
      expect(all.cursor).toBeNull();
      expect(all.items.map((i) => i.text)).toEqual(['message 0', 'message 1', 'message 2', 'message 3', 'message 4']);

      const rowStart = lines[0].length + 1 + lines[1].length + 1; // exactly where row 2 begins
      expect(readConversation(file, rowStart).items.map((i) => i.text)).toEqual(['message 2', 'message 3', 'message 4']);
      const midRow = rowStart - 5; // inside row 1: starts at the next whole row
      const page = readConversation(file, midRow);
      expect(page.items[0].text).toBe('message 2');
      expect(page.cursor).toBe(rowStart);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
