import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  ENV_NAME,
  envSource,
  FAMILIES,
  getConfig,
  getEnvVar,
  getProvider,
  setEnvVar,
  updateConfig,
  type Config,
  type GeminiProvider,
  type Provider,
} from "./config.js";
import { getLog, getLogs } from "./log.js";
import { anthropicHealth, forwardToAnthropic } from "./providers/anthropic.js";
import { estimateTokens, probeGeminiModels, testGemini } from "./providers/gemini/index.js";
import type { AnthropicRequest } from "./providers/gemini/types.js";
import { execute, resolveChain } from "./router/executor.js";
import { analyzerRoutes } from "./analyzer/routes.ts";
import { restartPoll, sessionRoutes, startSessions } from "./sessions/routes.ts";
import { applyConfigPatch } from "./sessions/settings.ts";

export const app = new Hono();

// ---- Claude Code traffic ----------------------------------------------------

app.post("/v1/messages/count_tokens", async (c) => {
  const body = await c.req.text();
  const req = JSON.parse(body) as AnthropicRequest;
  const first = resolveChain(getConfig(), req.model)[0];
  if (!first || first.provider.type === "anthropic") return forwardToAnthropic(c.req.raw, body);
  return c.json({ input_tokens: estimateTokens(req) });
});

app.post("/v1/messages", async (c) => {
  const body = await c.req.text();
  return execute(c.req.raw, body, JSON.parse(body) as AnthropicRequest);
});

// ---- Dashboard API ----------------------------------------------------------

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Only this machine's browser may use the dashboard API: a loopback Host blocks DNS
 * rebinding, a loopback Origin blocks other sites, and JSON bodies force a CORS preflight.
 */
app.use("/api/*", async (c, next) => {
  // The node server builds the request URL from the Host header.
  if (!LOOPBACK.test(new URL(c.req.url).host)) return c.json({ error: "forbidden host" }, 403);
  const origin = c.req.header("origin");
  if (origin && !LOOPBACK.test(origin.replace(/^https?:\/\//, ""))) return c.json({ error: "forbidden origin" }, 403);
  if ((c.req.method === "POST" || c.req.method === "PUT") && !c.req.header("content-type")?.includes("application/json")) {
    return c.json({ error: "json required" }, 415);
  }
  await next();
});

function keyStatus(config: Config) {
  const names = new Set(config.providers.flatMap((p) => (p.type === "gemini" ? p.keyEnv : [])));
  return Object.fromEntries([...names].map((name) => [name, { source: envSource(name) }]));
}

const state = () => {
  const config = getConfig();
  return { config, keys: keyStatus(config) };
};

app.get("/api/config", (c) => c.json(state()));

/** Returns an error message, or null when the patch is acceptable. */
function invalid(patch: Partial<Config>): string | null {
  if (patch.mode !== undefined && patch.mode !== "anthropic" && patch.mode !== "route") return "mode must be anthropic or route";
  if (patch.providers !== undefined) {
    if (!Array.isArray(patch.providers)) return "providers must be a list";
    const ids = new Set<string>();
    for (const p of patch.providers as Provider[]) {
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(p.id ?? "")) return `bad provider id "${p.id}"`;
      if (ids.has(p.id)) return `duplicate provider id "${p.id}"`;
      ids.add(p.id);
      if (p.type === "anthropic") continue;
      if (p.type !== "gemini") return `unknown provider type for "${(p as Provider).id}"`;
      if (p.api !== "aistudio" && p.api !== "vertex") return `"${p.id}": api must be aistudio or vertex`;
      if (!Array.isArray(p.keyEnv) || !p.keyEnv.length || !p.keyEnv.every((n) => ENV_NAME.test(n))) {
        return `"${p.id}": keyEnv must list .env variable names like GEMINI_API_KEY`;
      }
      if (p.api === "vertex" && !p.project?.trim()) return `"${p.id}": Vertex needs a project`;
    }
  }
  if (patch.routes !== undefined) {
    for (const f of FAMILIES) {
      const r = patch.routes[f];
      if (!Array.isArray(r) || !r.every((e) => typeof e === "string" && e.trim())) return `routes.${f} must be a list of targets`;
    }
  }
  if (patch.fallback !== undefined) {
    const { cooldownSec, timeoutMs } = patch.fallback;
    if (!(cooldownSec >= 0 && cooldownSec <= 3600)) return "cooldownSec must be 0-3600";
    if (!(timeoutMs >= 1000 && timeoutMs <= 3_600_000)) return "timeoutMs must be 1000-3600000";
  }
  return null;
}

app.put("/api/config", async (c) => {
  const body = await c.req.json<Partial<Config>>();
  const patch: Partial<Config> = {};
  for (const k of ["mode", "providers", "routes", "fallback", "capture"] as const) {
    if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
  }
  const error = invalid(patch);
  if (error) return c.json({ error }, 400);
  if (patch.capture !== undefined) patch.capture = !!patch.capture;
  if (body.sessions !== undefined) {
    const sessions = applyConfigPatch(getConfig().sessions, body.sessions ?? {});
    if (typeof sessions === "string") return c.json({ error: sessions }, 400);
    patch.sessions = sessions;
  }
  updateConfig(patch);
  if (patch.sessions) restartPoll(); // new interval or projects folder: re-read right away
  return c.json(state());
});

/** Keys are written to .env and never returned; only names a provider uses can be set. */
function keyName(name: string): boolean {
  return ENV_NAME.test(name) && getConfig().providers.some((p) => p.type === "gemini" && p.keyEnv.includes(name));
}

app.put("/api/env/:name", async (c) => {
  const name = c.req.param("name");
  if (!keyName(name)) return c.json({ error: "not a provider key variable" }, 400);
  const { value } = await c.req.json<{ value?: string }>();
  if (!value?.trim() || /[\r\n]/.test(value)) return c.json({ error: "value required (single line)" }, 400);
  setEnvVar(name, value.trim());
  return c.json(state());
});

app.delete("/api/env/:name", (c) => {
  const name = c.req.param("name");
  if (!keyName(name)) return c.json({ error: "not a provider key variable" }, 400);
  setEnvVar(name, undefined);
  return c.json(state());
});

function firstKey(p: GeminiProvider): string | undefined {
  for (const name of p.keyEnv) {
    const key = getEnvVar(name);
    if (key) return key;
  }
}

/** A model to test a Gemini provider with: its cheapest routed model (haiku first; pro models are slow to ping), else a cheap default. */
function testModel(p: GeminiProvider): string {
  for (const f of [...FAMILIES].reverse()) {
    const hit = getConfig().routes[f].find((e) => e.startsWith(`${p.id}/`));
    if (hit) return hit.slice(p.id.length + 1);
  }
  return p.models?.[0] ?? "gemini-3.5-flash-lite";
}

app.get("/api/health", async (c) => {
  const providers = getConfig().providers;
  const results = await Promise.all(
    providers.map(async (p) => {
      if (p.type === "anthropic") return [p.id, await anthropicHealth()] as const;
      const key = firstKey(p);
      return [p.id, key ? { ok: true, detail: "key set (use Test to verify)" } : { ok: false, detail: "no key set" }] as const;
    }),
  );
  return c.json(Object.fromEntries(results));
});

app.post("/api/providers/:id/test", async (c) => {
  const p = getProvider(c.req.param("id"));
  if (!p) return c.json({ error: "unknown provider" }, 404);
  if (p.type === "anthropic") return c.json(await anthropicHealth());
  const key = firstKey(p);
  if (!key) return c.json({ ok: false, detail: "no key set" });
  if (p.api === "vertex" && !p.project) return c.json({ ok: false, detail: "no Vertex project set" });
  return c.json(await testGemini(p, key, testModel(p)));
});

app.post("/api/providers/:id/models/probe", async (c) => {
  const p = getProvider(c.req.param("id"));
  if (!p || p.type !== "gemini") return c.json({ error: "unknown Gemini provider" }, 404);
  const key = firstKey(p);
  if (!key) return c.json({ error: "no key set" }, 400);
  try {
    const models = await probeGeminiModels(p, key);
    updateConfig({ providers: getConfig().providers.map((x) => (x.id === p.id ? { ...x, models } : x)) });
    return c.json({ models });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.get("/api/logs", (c) => {
  const session = c.req.query("session");
  return c.json(session ? getLogs().filter((l) => l.sessionId === session) : getLogs());
});

app.get("/api/logs/:id", (c) => {
  const entry = getLog(Number(c.req.param("id")));
  return entry ? c.json(entry) : c.json({ error: "not found" }, 404);
});

sessionRoutes(app);
analyzerRoutes(app);

// An API path no route handles is an error, not the dashboard page (which the page would try to parse as JSON).
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// ---- Dashboard (built by `npm run build` into dist/web) ----------------------

const WEB_ROOT = fileURLToPath(new URL("../dist/web", import.meta.url));
if (existsSync(WEB_ROOT)) {
  app.use("/*", serveStatic({ root: WEB_ROOT }));
  app.get("/*", serveStatic({ root: WEB_ROOT, path: "index.html" }));
} else {
  app.get("/", (c) => c.text("Dashboard not built yet: run `npm run build` (or `npm run dev` and open the Vite URL).", 503));
}

if (process.env.NODE_ENV !== "test") {
  startSessions();
  const port = Number(process.env.PORT ?? getConfig().port);
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`claude-code-control-tower on http://127.0.0.1:${port}  (mode: ${getConfig().mode})`);
    const url = `http://127.0.0.1:${port}`;
    const command = process.platform === "win32" ? `$env:ANTHROPIC_BASE_URL="${url}"; claude` : `ANTHROPIC_BASE_URL=${url} claude`;
    console.log(`Connect Claude Code with:  ${command}`);
  });
}
