import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSessionsConfig } from "./sessions/settings.ts";
import type { Config as SessionsConfig } from "./sessions/types.ts";

export type Family = "opus" | "sonnet" | "haiku";
export const FAMILIES: Family[] = ["opus", "sonnet", "haiku"];
/** "anthropic": pass everything through unchanged. "route": follow `routes`. */
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
  /** AI Studio key, or Vertex AI express-mode key. */
  api: "aistudio" | "vertex";
  /** Vertex only: project ID or number, and location (default "global"). */
  project?: string;
  location?: string;
  /** Names of .env variables holding this provider's keys, tried in order. */
  keyEnv: string[];
  /** Models found by the last probe, offered as suggestions in the dashboard. */
  models?: string[];
}

export type Provider = AnthropicProvider | GeminiProvider;

export interface Config {
  mode: Mode;
  providers: Provider[];
  /** Per Claude model family: ordered targets, "providerId/model" or "anthropic" (keeps Claude Code's model). */
  routes: Record<Family, string[]>;
  fallback: { cooldownSec: number; timeoutMs: number };
  /** Keep recent request bodies in memory for the log detail view (debugging). */
  capture: boolean;
  /** Sessions viewer settings (from Claude Office). */
  sessions: SessionsConfig;
  port: number;
}

export const STATE_DIR = process.env.CLAUDE_ROUTER_HOME ?? join(homedir(), ".claude-router");
/** The folder the Analyzer runs its own Claude sessions in; usage checks leave transcripts from it out. */
export const ANALYZER_REVIEW_DIR = join(STATE_DIR, "analyzer-review");
const FILE = join(STATE_DIR, "config.json");

export const DEFAULT_CONFIG: Config = {
  mode: "anthropic",
  providers: [
    { id: "anthropic", type: "anthropic", name: "Anthropic" },
    { id: "gemini", type: "gemini", name: "Google Gemini", api: "aistudio", keyEnv: ["GEMINI_API_KEY"] },
  ],
  routes: {
    opus: ["gemini/gemini-4-argon", "anthropic"],
    sonnet: ["gemini/gemini-3.8-flash", "anthropic"],
    haiku: ["gemini/gemini-3.5-flash-lite", "anthropic"],
  },
  fallback: { cooldownSec: 60, timeoutMs: 600_000 },
  capture: false,
  sessions: defaultSessionsConfig(),
  port: 3456,
};

/** Config files written before providers/routes existed: { active, models, geminiApi }. */
interface ConfigV1 {
  active?: "anthropic" | "gemini";
  models?: Partial<Record<Family, string>>;
  geminiApi?: "aistudio" | "vertex";
  capture?: boolean;
  port?: number;
}

export function migrate(saved: ConfigV1 & Partial<Config>): Config {
  if (saved.providers) {
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...saved,
      fallback: { ...DEFAULT_CONFIG.fallback, ...saved.fallback },
      sessions: { ...DEFAULT_CONFIG.sessions, ...saved.sessions },
    } as Config;
  }
  const vertex = saved.geminiApi === "vertex";
  const gemini: GeminiProvider = {
    id: vertex ? "vertex" : "gemini",
    type: "gemini",
    name: vertex ? "Gemini (Vertex AI)" : "Google Gemini",
    api: vertex ? "vertex" : "aistudio",
    keyEnv: ["GEMINI_API_KEY"],
    ...(vertex ? { project: getEnvVar("VERTEX_PROJECT"), location: "global" } : {}),
  };
  const routes = {} as Record<Family, string[]>;
  for (const f of FAMILIES) {
    const model = saved.models?.[f] ?? DEFAULT_CONFIG.routes[f][0].split("/")[1];
    routes[f] = [`${gemini.id}/${model}`, "anthropic"];
  }
  return {
    ...structuredClone(DEFAULT_CONFIG),
    mode: saved.active === "gemini" ? "route" : "anthropic",
    providers: [DEFAULT_CONFIG.providers[0], gemini],
    routes,
    capture: saved.capture ?? false,
    port: saved.port ?? DEFAULT_CONFIG.port,
  };
}

let current: Config | undefined;

export function getConfig(): Config {
  if (!current) {
    try {
      current = migrate(JSON.parse(readFileSync(FILE, "utf8")));
    } catch {
      current = structuredClone(DEFAULT_CONFIG);
    }
  }
  return current!;
}

export function updateConfig(patch: Partial<Config>): Config {
  current = { ...getConfig(), ...patch };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(current, null, 2) + "\n");
  return current;
}

export function getProvider(id: string): Provider | undefined {
  return getConfig().providers.find((p) => p.id === id);
}

export function familyOf(model: string): Family {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  return "sonnet";
}

// ---- Keys, stored in the repo's .env file -----------------------------------------

const ENV_FILE = process.env.CLAUDE_ROUTER_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url));
export const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

/** The .env file is re-read on every call, so edits apply without a restart. It wins over the process environment. */
export function getEnvVar(name: string): string | undefined {
  return readEnvFile()[name] || process.env[name] || undefined;
}

export function envSource(name: string): "file" | "env" | null {
  if (readEnvFile()[name]) return "file";
  return process.env[name] ? "env" : null;
}

/** Upsert (or, with undefined, remove) one variable in .env, leaving every other line untouched. */
export function setEnvVar(name: string, value: string | undefined): void {
  let lines: string[] = [];
  try {
    lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  } catch {}
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const isVar = (l: string) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l);
  const kept = lines.filter((l) => !isVar(l));
  if (value) {
    const at = lines.findIndex(isVar);
    const entry = `${name}=${value}`;
    if (at === -1) kept.push(entry);
    else kept.splice(lines.slice(0, at).filter((l) => !isVar(l)).length, 0, entry);
  }
  writeFileSync(ENV_FILE, kept.length ? kept.join("\n") + "\n" : "", { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}
