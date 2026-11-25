import type { GeminiProvider } from "../../config.js";
import { anthropicError, readSse, StreamTranslator, toAnthropicMessage, type Usage } from "./response.js";
import { toGeminiRequest } from "./request.js";
import { originalNames } from "./tools.js";
import type { AnthropicRequest } from "./types.js";

const AISTUDIO = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Vertex needs an explicit project and location: the location-less express path lands in
 * europe-west1, which lacks the newest models. Defaults to the `global` location.
 */
function root(p: GeminiProvider): string {
  if (p.api === "aistudio") return AISTUDIO;
  if (!p.project) throw new Error(`provider "${p.id}" has no Vertex project set`);
  const loc = p.location || "global";
  const host = loc === "global" ? "aiplatform.googleapis.com" : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(p.project)}/locations/${encodeURIComponent(loc)}/publishers/google`;
}

export function modelUrl(p: GeminiProvider, model: string, action: string): string {
  return `${root(p)}/models/${encodeURIComponent(model)}:${action}`;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error?.message ?? text;
  } catch {
    return text;
  }
}

export interface GeminiTarget {
  provider: GeminiProvider;
  key: string;
  model: string;
}

/**
 * Serve an Anthropic Messages request with Gemini. `onDone` runs once: right away when the
 * upstream call fails, or after the reply has been fully sent (stream end for streaming).
 */
export async function callGemini(
  req: AnthropicRequest,
  target: GeminiTarget,
  onDone: (status: number, usage?: Usage, error?: string) => void,
  signal?: AbortSignal,
): Promise<Response> {
  const action = req.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const upstream = await fetch(modelUrl(target.provider, target.model, action), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": target.key },
    body: JSON.stringify(toGeminiRequest(req)),
    signal,
  });

  if (!upstream.ok) {
    const message = await errorMessage(upstream);
    onDone(upstream.status, undefined, message);
    return json(upstream.status, anthropicError(upstream.status, `Gemini: ${message}`));
  }

  const names = originalNames(req.tools);
  if (!req.stream) {
    const msg = toAnthropicMessage(await upstream.json(), req.model, names);
    onDone(200, msg.usage);
    return json(200, msg);
  }

  const translator = new StreamTranslator(req.model, names);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(translator.start()));
        for await (const chunk of readSse(upstream.body!)) {
          const out = translator.push(chunk);
          if (out) controller.enqueue(encoder.encode(out));
        }
        controller.enqueue(encoder.encode(translator.end()));
        onDone(200, translator.usage);
      } catch (err) {
        const message = (err as Error).message;
        const event = anthropicError(500, `Gemini stream failed: ${message}`);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(event)}\n\n`));
        onDone(500, translator.usage, message);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

/** Rough token estimate for /v1/messages/count_tokens (about 4 characters per token). */
export function estimateTokens(req: AnthropicRequest): number {
  const text = JSON.stringify({ s: req.system, m: req.messages, t: req.tools });
  return Math.ceil(text.length / 4);
}

/** 1-token request: proves the key, project and model work together. */
async function ping(p: GeminiProvider, key: string, model: string): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const res = await fetch(modelUrl(p, model, "generateContent"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return { ok: true, status: 200, detail: `${model} answered` };
    return { ok: false, status: res.status, detail: (await errorMessage(res)).slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, detail: `unreachable: ${(err as Error).message}` };
  }
}

async function listAiStudio(key: string): Promise<string[]> {
  const res = await fetch(`${AISTUDIO}/models?pageSize=1000`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`models.list failed (HTTP ${res.status}): ${(await errorMessage(res)).slice(0, 200)}`);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

/**
 * Google text models to try on Vertex, which has no model-list call for express keys.
 * From https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
 */
export const VERTEX_CANDIDATES = [
  "gemini-4-hydrogen", "gemini-4-carbon", "gemini-4-argon",
  "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
];

/** Models this key can call: AI Studio lists them, Vertex is probed with 1-token requests. */
export async function probeGeminiModels(p: GeminiProvider, key: string): Promise<string[]> {
  if (p.api === "aistudio") return listAiStudio(key);
  const results = await Promise.all(VERTEX_CANDIDATES.map(async (m) => ((await ping(p, key, m)).ok ? m : null)));
  return results.filter((m): m is string => !!m);
}

/** Live check of one key: AI Studio lists models; Vertex pings `model`. */
export async function testGemini(p: GeminiProvider, key: string, model: string): Promise<{ ok: boolean; detail: string }> {
  if (p.api === "aistudio") {
    try {
      const models = await listAiStudio(key);
      return { ok: true, detail: `key OK, ${models.length} models` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
  const r = await ping(p, key, model);
  return { ok: r.ok, detail: r.ok ? `Vertex key OK (${r.detail})` : `HTTP ${r.status}: ${r.detail}` };
}
