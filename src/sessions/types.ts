export type MainState = 'waiting' | 'working' | 'done' | 'idle';
export type SubState = 'working' | 'finished' | 'stalled';

export interface SubAgent {
  id: string;
  parentAgentId?: string;
  type: string;
  description: string;
  model?: string;
  state: SubState;
  startedAt: number;
  endedAt?: number;
  lastActivityAt: number;
  contextTokens?: number;
  contextLimit?: number;
  /** Tokens this subagent has used: input, output and cache writes. */
  tokensUsed?: number;
}

export interface PullRequest {
  number: number;
  url: string;
  repo: string;
}

export interface MainAgent {
  sessionId: string;
  pid: number;
  name: string;
  cwd: string;
  entrypoint?: string;
  /** Where you reply to this session. */
  app: 'desktop' | 'vscode' | 'terminal' | 'other';
  /** A link that opens this session in that app, when the app has one. */
  openUrl?: string;
  branch?: string;
  model?: string;
  state: MainState;
  /** Why the agent is waiting for you, when state is waiting. */
  reason?: string;
  /** When the current state began (waiting and done only). */
  since?: number;
  /** One line on what the last turn achieved, when the desktop app wrote one. */
  summary?: string;
  /** The tool a working agent is in the middle of using. */
  activity?: string;
  /** The agent's latest message in the current turn. */
  output?: string;
  /** The open question or plan it is waiting on, when there is one. */
  ask?: string;
  startedAt: number;
  turnStartedAt?: number;
  lastActivityAt?: number;
  contextTokens?: number;
  contextLimit?: number;
  /** Pull requests the session opened or linked. */
  prs?: PullRequest[];
  /** Tokens the session itself has used (subagents not included): input, output and cache writes. */
  tokensUsed?: number;
  /** Roughly where Claude Code compacts this session's context automatically. */
  compactAt?: number;
  /** Set once the context passes the warning or danger size for the session's model. */
  contextLevel?: ContextLevel;
  subagents: SubAgent[];
  /** The newest request this session sent through claude-code-control-tower, if any. */
  router?: RouterSummary;
  /** Set when you flagged this session to keep an eye on it. */
  flag?: SessionFlag;
}

/** claude-code-control-tower: a session you flagged, with an optional note. */
export interface SessionFlag {
  note?: string;
}

/** claude-code-control-tower: who served a session's latest request. */
export interface RouterSummary {
  provider: string;
  model: string;
  status: number;
  /** Failed tries before the answer (0 when the first target served it). */
  fallbacks: number;
  at: string;
  /** Requests from this session in the router's log. */
  requests: number;
}

export interface Table {
  id: string;
  name: string;
  path: string;
  agents: MainAgent[];
}

export interface UsageWindow {
  percent: number;
  resetsAt?: number;
}

export interface Usage {
  session?: UsageWindow;
  week?: UsageWindow;
  /** When the figures were read. */
  fetchedAt?: number;
  /** "live": just asked Claude. "saved": Claude's own older saved copy. */
  source?: 'live' | 'saved';
  checking: boolean;
  /** Why the last live check failed, if it did. */
  problem?: string;
  /** What used tokens since the current 5-hour window started. */
  window?: UsageBreakdown;
}

export interface UsageBreakdown {
  since: number;
  total: number;
  byModel: Record<string, number>;
  /** Biggest first; sessions that have ended are named "Closed: <title>". */
  sessions: { sessionId: string; name: string; live: boolean; tokens: number }[];
}

export interface Config {
  projectsRoot: string;
  /** Context limit overrides, keyed by model id or family (fable, opus, sonnet, haiku). */
  contextLimits: Record<string, number>;
  pollMs: number;
  /** Minutes between live usage checks while the page is open; 0 turns them off. */
  usageCheckMin: number;
  /** Context sizes, by family (fable, opus, sonnet, haiku, other), where a session gets a warning and then a danger mark. */
  contextAlerts: Record<string, ContextAlert>;
}

/** Context sizes in tokens: past `warn` answers start to slip, past `danger` the session should be compacted or restarted. */
export interface ContextAlert {
  warn: number;
  danger: number;
}

export type ContextLevel = 'warn' | 'danger';

/** A session that has ended recently. */
export interface PastSession {
  sessionId: string;
  name: string;
  project: string;
  /** False when it ran outside the projects folder (then `project` is its own folder name). */
  inProject?: boolean;
  cwd: string;
  branch?: string;
  model?: string;
  endedAt: number;
  lastText?: string;
  prs: PullRequest[];
  app: MainAgent['app'];
  openUrl?: string;
  router?: RouterSummary;
  flag?: SessionFlag;
}

export interface Snapshot {
  generatedAt: number;
  tables: Table[];
  /** Sessions that ended in the last day, most recent first. */
  history: PastSession[];
  usage: Usage;
  config: Config;
  /** Whether the server can bring a running session's terminal window forward (macOS only). */
  canFocusTerminal: boolean;
}

/** One entry in a session's conversation, as a person reads it. */
export interface ConversationItem {
  /** you: your prompt. claude: its reply. tool: a step it took. ask: a question to you. plan: a plan for approval. note: a background update. */
  kind: 'you' | 'claude' | 'tool' | 'ask' | 'plan' | 'note';
  text: string;
  at?: number;
  /** The tool's name, for steps. */
  name?: string;
  /** What the step returned. */
  result?: { text: string; error: boolean };
  /** Your answer to a question or decision on a plan, once given. */
  answer?: string;
  /** Used while reading only. */
  messageId?: string;
}

export interface ConversationPage {
  items: ConversationItem[];
  /** Byte position where this page starts, or null when it starts at the beginning of the conversation. */
  cursor: number | null;
  /** The transcript's size when read, so the page can tell when there is something new. */
  size: number;
}
