/** One upstream try within a request; status 0 means no HTTP reply (network error, no key). */
export interface Attempt {
  provider: string;
  model: string;
  status: number;
  ms: number;
  error?: string;
}

export interface LogEntry {
  id?: number;
  time: string;
  /** Provider and model that produced the final answer (or the last failure). */
  provider: string;
  path: string;
  modelIn: string;
  modelOut: string;
  stream: boolean;
  status: number;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  attempts?: Attempt[];
  /** The Claude Code session that sent the request (from metadata.user_id). */
  sessionId?: string;
  /** Only when capture is on: the raw Claude Code request body (capped). */
  capture?: { request: string };
}

const MAX = 200;
/** Request bodies are large; keep them on the newest entries only. */
const MAX_CAPTURES = 20;
export const CAPTURE_LIMIT = 2 * 1024 * 1024;

const entries: LogEntry[] = [];
let nextId = 1;

export function addLog(entry: LogEntry): void {
  entries.unshift({ id: nextId++, ...entry });
  if (entries.length > MAX) entries.pop();
  let kept = 0;
  for (const e of entries) if (e.capture && ++kept > MAX_CAPTURES) delete e.capture;
}

/** The list view leaves out captured bodies; fetch one entry for those. */
export function getLogs(): (LogEntry & { captured?: boolean })[] {
  return entries.map(({ capture, ...rest }) => ({ ...rest, ...(capture ? { captured: true } : {}) }));
}

/** Claude Code puts a JSON string in metadata.user_id that includes the session id. */
export function sessionIdOf(body: { metadata?: { user_id?: unknown } }): string | undefined {
  const raw = body.metadata?.user_id;
  if (typeof raw !== "string") return undefined;
  try {
    const id = (JSON.parse(raw) as { session_id?: unknown }).session_id;
    return typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function getLog(id: number): LogEntry | undefined {
  return entries.find((e) => e.id === id);
}
