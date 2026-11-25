// Shapes of the router's dashboard API (src/server.ts, src/config.ts, src/log.ts).
// Relative, not @server: the root tsconfig also compiles this file (test/defaultProvider.test.ts) without that alias.
import type { Report, Window } from "../../../src/analyzer/types.ts";

export type Family = "opus" | "sonnet" | "haiku";
export const FAMILIES: Family[] = ["opus", "sonnet", "haiku"];
export type Mode = "anthropic" | "route";

export interface AnthropicProvider {
  id: string;
  type: "anthropic";
  name?: string;
  enabled?: boolean;
}
export interface GeminiProvider {
  id: string;
  type: "gemini";
  name?: string;
  enabled?: boolean;
  api: "aistudio" | "vertex";
  project?: string;
  location?: string;
  keyEnv: string[];
  models?: string[];
}
export type Provider = AnthropicProvider | GeminiProvider;

export interface Config {
  mode: Mode;
  providers: Provider[];
  routes: Record<Family, string[]>;
  fallback: { cooldownSec: number; timeoutMs: number };
  capture: boolean;
  sessions: { projectsRoot: string; pollMs: number; usageCheckMin: number; contextLimits: Record<string, number>; contextAlerts: Record<string, { warn: number; danger: number }> };
  port: number;
}
export interface KeyStatus {
  source: "file" | "env" | null;
}
export interface State {
  config: Config;
  keys: Record<string, KeyStatus>;
}
export interface Health {
  ok: boolean;
  detail: string;
}
export interface Attempt {
  provider: string;
  model: string;
  status: number;
  ms: number;
  error?: string;
}
export interface LogEntry {
  id: number;
  time: string;
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
  sessionId?: string;
  captured?: boolean;
  capture?: { request: string };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  state: () => call<State>("GET", "/api/config"),
  save: (patch: Partial<Config>) => call<State>("PUT", "/api/config", patch),
  setKey: (name: string, value: string) => call<State>("PUT", `/api/env/${name}`, { value }),
  removeKey: (name: string) => call<State>("DELETE", `/api/env/${name}`),
  health: () => call<Record<string, Health>>("GET", "/api/health"),
  test: (id: string) => call<Health>("POST", `/api/providers/${id}/test`, {}),
  probe: (id: string) => call<{ models: string[] }>("POST", `/api/providers/${id}/models/probe`, {}),
  logs: (session?: string) => call<LogEntry[]>("GET", session ? `/api/logs?session=${encodeURIComponent(session)}` : "/api/logs"),
  log: (id: number) => call<LogEntry>("GET", `/api/logs/${id}`),
  openTerminal: (session: string) => call<{ opened: string; resumed?: boolean }>("POST", "/api/sessions/terminal", { session }),
  analyzerReport: () => call<Report | null>("GET", "/api/analyzer/report"),
  runAnalyzer: (window?: Window) => call<Report>("POST", "/api/analyzer/run", { window }),
  estimateReview: () => call<{ tokens: number }>("POST", "/api/analyzer/review/estimate", {}),
  reviewAnalyzer: () => call<Report>("POST", "/api/analyzer/review", {}),
};

export function providerName(p: Provider): string {
  return p.name || p.id;
}
