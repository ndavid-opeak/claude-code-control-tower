import type { MainAgent, MainState, SubAgent, SubState } from '@server/sessions/types.ts';

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export const contextFraction = (a: { contextTokens?: number; contextLimit?: number }) =>
  a.contextTokens && a.contextLimit ? Math.min(1, a.contextTokens / a.contextLimit) : 0;

export const subClock = (s: SubAgent, now: number) => duration((s.endedAt ?? now) - s.startedAt);

export const MAIN_STATE_LABEL: Record<MainState, string> = {
  waiting: 'Waiting for you',
  working: 'Working',
  done: 'Done',
  idle: 'No activity yet',
};

export const SUB_STATE_LABEL: Record<SubState, string> = {
  working: 'Working',
  finished: 'Finished',
  stalled: 'Quiet for over 10 minutes',
};

export function modelName(model?: string): string {
  if (!model) return 'Unknown model';
  const m = /claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

/** Markdown links read better as their text alone. */
export const withoutLinks = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

const plain = (line: string) =>
  withoutLinks(line)
    .replace(/^[#>\-*\s]+/, '')
    .replace(/[*_`]/g, '')
    .trim();

/** The first or last line of a message that has words in it, without markdown marks. */
export function lineOf(text: string | undefined, which: 'first' | 'last'): string {
  const lines = (text ?? '').split('\n').map(plain).filter(Boolean);
  return (which === 'first' ? lines[0] : lines.at(-1)) ?? '';
}

const ACTIVITY: Record<string, string> = {
  Bash: 'Running a command',
  Read: 'Reading files',
  Grep: 'Searching the code',
  Glob: 'Searching the code',
  Edit: 'Editing files',
  Write: 'Editing files',
  NotebookEdit: 'Editing files',
  Agent: 'Waiting on subagents',
  Task: 'Waiting on subagents',
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a web page',
};

/** What a working agent is doing right now, from the tool it is in the middle of. */
export function activityText(tool?: string): string {
  if (!tool) return 'Thinking';
  const short = tool.split('__').at(-1) ?? tool;
  if (/^(browser_|computer|navigate|read_page|find|form_input|get_page_text|javascript)/.test(short)) return 'Using the browser';
  return ACTIVITY[tool] ?? `Using ${short.replace(/_/g, ' ')}`;
}

export const APP_NAME: Record<string, string> = {
  desktop: 'the Claude app',
  vscode: 'VS Code',
  terminal: 'its terminal',
  other: 'the app it runs in',
};

/** At 80% of the way to auto-compact, a session is worth wrapping up. */
export const nearCompact = (a: MainAgent) => !!a.contextTokens && !!a.compactAt && a.contextTokens >= 0.8 * a.compactAt;

/** A working session that has written nothing for this long may be stuck (or running a long command). */
export const QUIET_MS = 10 * 60_000;

export const MODEL_NAME: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', other: 'Other' };
