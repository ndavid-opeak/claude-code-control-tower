import { familyOf, getConfig, getEnvVar, type Config, type Provider } from "../config.js";
import { addLog, CAPTURE_LIMIT, sessionIdOf, type Attempt, type LogEntry } from "../log.js";
import { forwardToAnthropic } from "../providers/anthropic.js";
import { callGemini } from "../providers/gemini/index.js";
import { anthropicError, type Usage } from "../providers/gemini/response.js";
import type { AnthropicRequest } from "../providers/gemini/types.js";

export interface Target {
  provider: Provider;
  /** Model sent upstream; for Anthropic, the model Claude Code asked for. */
  model: string;
}

/** The ordered targets for this request: one per route entry whose provider exists and is enabled. */
export function resolveChain(config: Config, model: string): Target[] {
  if (config.mode === "anthropic") return [{ provider: { id: "anthropic", type: "anthropic" }, model }];
  const chain: Target[] = [];
  for (const entry of config.routes[familyOf(model)] ?? []) {
    const slash = entry.indexOf("/");
    const id = slash === -1 ? entry : entry.slice(0, slash);
    const provider = config.providers.find((p) => p.id === id);
    if (!provider || provider.enabled === false) continue;
    if (provider.type === "anthropic") chain.push({ provider, model });
    else if (slash !== -1) chain.push({ provider, model: entry.slice(slash + 1) });
  }
  return chain;
}

// ---- Cooldown: skip a key for a while after auth, quota or server errors ----------

const coolUntil = new Map<string, number>();
const COOL_STATUSES = new Set([401, 403, 429]);

export function shouldCool(status: number): boolean {
  return COOL_STATUSES.has(status) || status >= 500 || status === 0;
}
function cooling(slot: string): boolean {
  return (coolUntil.get(slot) ?? 0) > Date.now();
}
export function resetCooldowns(): void {
  coolUntil.clear();
}

// ---- Executor ---------------------------------------------------------------------

/**
 * Serve a Claude Code /v1/messages request along its route chain. A target that fails before
 * replying (any HTTP error, network error, timeout) hands over to the next one; once a reply
 * starts streaming there is no retry. The last target's answer is returned whatever it is.
 */
export async function execute(raw: Request, body: string, req: AnthropicRequest): Promise<Response> {
  const config = getConfig();
  const chain = resolveChain(config, req.model);
  const started = Date.now();
  const attempts: Attempt[] = [];
  const entry: Omit<LogEntry, "provider" | "modelOut" | "status" | "ms"> = {
    time: new Date().toISOString(),
    path: new URL(raw.url).pathname,
    modelIn: req.model,
    stream: !!req.stream,
    attempts,
    sessionId: sessionIdOf(req as { metadata?: { user_id?: unknown } }),
    ...(config.capture ? { capture: { request: body.slice(0, CAPTURE_LIMIT) } } : {}),
  };
  const finish = (t: Target, status: number, usage?: Usage, error?: string) =>
    addLog({
      ...entry,
      provider: t.provider.id,
      modelOut: t.model,
      status,
      ms: Date.now() - started,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      error,
    });

  if (!chain.length) {
    const msg = `no enabled provider in the ${familyOf(req.model)} route`;
    addLog({ ...entry, provider: "-", modelOut: "-", status: 503, ms: 0, error: msg });
    return Response.json(anthropicError(503, `claude-code-control-tower: ${msg}`), { status: 503 });
  }

  let last: Response | undefined;
  for (const [i, t] of chain.entries()) {
    const isLast = i === chain.length - 1;
    const t0 = Date.now();
    const note = (status: number, error?: string) =>
      attempts.push({ provider: t.provider.id, model: t.model, status, ms: Date.now() - t0, error });

    if (t.provider.type === "anthropic") {
      let res: Response;
      try {
        res = await forwardToAnthropic(raw, body);
      } catch (err) {
        note(0, (err as Error).message);
        if (isLast) return finishError(t, 502, (err as Error).message);
        continue;
      }
      if (res.ok || isLast) {
        note(res.status);
        finish(t, res.status, undefined, attempts.length > 1 ? "served after fallback" : undefined);
        return res;
      }
      const text = await res.text();
      note(res.status, text.slice(0, 300));
      last = new Response(text, { status: res.status, headers: res.headers });
      continue;
    }

    // Gemini: try each key that is set and not cooling down.
    const slots = t.provider.keyEnv
      .map((name) => ({ slot: `${t.provider.id}:${name}`, key: getEnvVar(name) }))
      .filter((s) => s.key && !cooling(s.slot));
    if (!slots.length) {
      note(0, t.provider.keyEnv.some((n) => getEnvVar(n)) ? "all keys cooling down" : "no key set");
      continue;
    }
    for (const { slot, key } of slots) {
      // onDone fires before callGemini returns for errors and non-streaming replies,
      // and at stream end (after we have returned the response) for streaming ones.
      let served = false;
      let early: { status: number; usage?: Usage; error?: string } | undefined;
      const done = (status: number, usage?: Usage, error?: string) =>
        finish(t, status, usage, error ?? (attempts.length > 1 ? "served after fallback" : undefined));
      const onDone = (status: number, usage?: Usage, error?: string) => {
        if (served) done(status, usage, error);
        else early = { status, usage, error };
      };
      let res: Response | undefined;
      try {
        res = await callGemini(req, { provider: t.provider, key: key!, model: t.model }, onDone, AbortSignal.timeout(config.fallback.timeoutMs));
      } catch (err) {
        early = { status: 0, error: (err as Error).message };
      }
      if (res?.ok) {
        note(200);
        served = true;
        if (early) done(early.status, early.usage, early.error);
        return res;
      }
      const failed = early;
      const status = failed?.status ?? res?.status ?? 0;
      note(status, failed?.error);
      if (res) last = res;
      if (!shouldCool(status)) break; // request-specific (e.g. 400/404): another key won't help
      coolUntil.set(slot, Date.now() + config.fallback.cooldownSec * 1000);
    }
  }

  const tail = attempts.at(-1)!;
  const target = chain.find((t) => t.provider.id === tail.provider) ?? chain[0];
  if (last) {
    finish(target, last.status, undefined, tail.error);
    return last;
  }
  return finishError(target, 502, tail.error ?? "all targets failed");

  function finishError(t: Target, status: number, error: string) {
    finish(t, status, undefined, error);
    return Response.json(anthropicError(status, `claude-code-control-tower: ${error}`), { status });
  }
}
