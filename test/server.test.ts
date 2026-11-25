import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.CLAUDE_ROUTER_HOME = mkdtempSync(join(tmpdir(), "claude-router-"));
const ENV_FILE = join(mkdtempSync(join(tmpdir(), "claude-router-env-")), ".env");
process.env.CLAUDE_ROUTER_ENV_FILE = ENV_FILE;
delete process.env.GEMINI_API_KEY;

let app: typeof import("../src/server.js").app;
let resetCooldowns: () => void;
beforeAll(async () => {
  ({ app } = await import("../src/server.js"));
  ({ resetCooldowns } = await import("../src/router/executor.js"));
});

const json = { "content-type": "application/json" };
const put = (path: string, body: unknown) => app.request(path, { method: "PUT", headers: json, body: JSON.stringify(body) });
const msg = (model = "claude-opus-5-5") =>
  app.request("/v1/messages", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
  });

const realFetch = globalThis.fetch;
let calls: string[] = [];
/** Fake upstream: Gemini URLs answer with `gemini(model)`, Anthropic with 200. */
function upstream(gemini: (model: string) => Response) {
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    if (url.includes("anthropic.com")) return Response.json({ type: "message", from: "anthropic" });
    return gemini(url.match(/models\/([^:]+):/)![1]);
  }) as typeof fetch;
}
const geminiOk = () => Response.json({ candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] });
const geminiErr = (status: number) => Response.json({ error: { message: `fail ${status}` } }, { status });

beforeEach(async () => {
  calls = [];
  resetCooldowns();
  writeFileSync(ENV_FILE, "GEMINI_API_KEY=key-1111\n");
  await put("/api/config", {
    mode: "route",
    providers: [
      { id: "anthropic", type: "anthropic" },
      { id: "vertex", type: "gemini", api: "vertex", project: "proj-1", keyEnv: ["GEMINI_API_KEY"] },
    ],
    routes: {
      opus: ["vertex/gemini-4-argon", "vertex/gemini-3.1-pro-preview", "anthropic"],
      sonnet: ["vertex/gemini-3.8-flash", "anthropic"],
      haiku: ["vertex/gemini-3.5-flash-lite"],
    },
    fallback: { cooldownSec: 60, timeoutMs: 10_000 },
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("routing and fallback", () => {
  it("serves from the first target and calls the Vertex global endpoint", async () => {
    upstream(geminiOk);
    const res = await msg();
    expect((await res.json()).content[0].text).toBe("hi");
    expect(calls).toEqual([
      "https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google/models/gemini-4-argon:generateContent",
    ]);
    const [log] = await (await app.request("/api/logs")).json();
    expect(log).toMatchObject({ provider: "vertex", modelOut: "gemini-4-argon", status: 200, attempts: [{ status: 200 }] });
  });

  it("falls back along the chain without switching the mode", async () => {
    upstream((m) => (m === "gemini-4-argon" ? geminiErr(404) : geminiOk()));
    const res = await msg();
    expect(res.status).toBe(200);
    const [log] = await (await app.request("/api/logs")).json();
    expect(log.modelOut).toBe("gemini-3.1-pro-preview");
    expect(log.attempts.map((a: { status: number }) => a.status)).toEqual([404, 200]);
    expect((await (await app.request("/api/config")).json()).config.mode).toBe("route");
  });

  it("cools a key down after 429 and skips it on the next request", async () => {
    upstream(() => geminiErr(429));
    const first = await msg();
    expect(await first.json()).toMatchObject({ from: "anthropic" });
    calls = [];
    await msg();
    expect(calls).toEqual(["https://api.anthropic.com/v1/messages"]);
    const [log] = await (await app.request("/api/logs")).json();
    expect(log.attempts[0]).toMatchObject({ provider: "vertex", status: 0, error: "all keys cooling down" });
  });

  it("does not cool down on a request-specific 400", async () => {
    upstream(() => geminiErr(400));
    await msg("claude-sonnet-5-5");
    calls = [];
    upstream(geminiOk);
    await msg("claude-sonnet-5-5");
    expect(calls[0]).toContain("gemini-3.8-flash");
  });

  it("returns the last target's error when every target fails", async () => {
    upstream(() => geminiErr(503));
    const res = await msg("claude-haiku-5-5");
    expect(res.status).toBe(503);
  });

  it("passes everything to Anthropic in anthropic mode", async () => {
    await put("/api/config", { mode: "anthropic" });
    upstream(geminiOk);
    await msg();
    expect(calls).toEqual(["https://api.anthropic.com/v1/messages"]);
  });
});

describe("dashboard API", () => {
  it("rejects bad config", async () => {
    expect((await put("/api/config", { mode: "gemini" })).status).toBe(400);
    expect((await put("/api/config", { providers: [{ id: "x", type: "gemini", api: "vertex", keyEnv: ["K"] }] })).status).toBe(400);
    expect((await put("/api/config", { providers: [{ id: "x", type: "gemini", api: "aistudio", keyEnv: ["bad name"] }] })).status).toBe(400);
  });

  it("stores keys in .env without ever returning them, editing only that line", async () => {
    writeFileSync(ENV_FILE, '# mine\nFOO=bar\nGEMINI_API_KEY="old"\nBAZ=1\n');
    const res = await put("/api/env/GEMINI_API_KEY", { value: " secret-key-1234 " });
    expect(JSON.stringify(await res.json())).not.toContain("secret-key");
    expect(readFileSync(ENV_FILE, "utf8")).toBe("# mine\nFOO=bar\nGEMINI_API_KEY=secret-key-1234\nBAZ=1\n");
    const state = await (await app.request("/api/config")).json();
    expect(state.keys.GEMINI_API_KEY).toEqual({ source: "file" });
    expect(JSON.stringify(state)).not.toContain("1234");
    await app.request("/api/env/GEMINI_API_KEY", { method: "DELETE" });
    expect(readFileSync(ENV_FILE, "utf8")).toBe("# mine\nFOO=bar\nBAZ=1\n");
  });

  it("only edits variables that a provider uses", async () => {
    expect((await put("/api/env/PATH", { value: "x" })).status).toBe(400);
    expect((await put("/api/env/GEMINI_API_KEY", { value: "a\nB=1" })).status).toBe(400);
  });

  it("blocks non-loopback hosts and origins, and non-JSON writes", async () => {
    expect((await app.request("http://evil.example/api/config")).status).toBe(403);
    expect((await app.request("/api/config", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await app.request("/api/config", { headers: { origin: "http://localhost:5173" } })).status).toBe(200);
    const form = await app.request("/api/config", { method: "PUT", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(form.status).toBe(415);
  });

  it("probes Vertex models and stores the ones that answer", async () => {
    upstream((m) => (m === "gemini-4-argon" || m === "gemini-3.8-flash" ? geminiOk() : geminiErr(404)));
    const res = await app.request("/api/providers/vertex/models/probe", { method: "POST", headers: json, body: "{}" });
    expect((await res.json()).models).toEqual(["gemini-4-argon", "gemini-3.8-flash"]);
    const state = await (await app.request("/api/config")).json();
    expect(state.config.providers[1].models).toEqual(["gemini-4-argon", "gemini-3.8-flash"]);
  });
});

describe("sessions link", () => {
  const withSession = (sid: unknown) =>
    app.request("/v1/messages", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 5,
        metadata: { user_id: typeof sid === "string" ? JSON.stringify({ device_id: "d", session_id: sid }) : sid },
        messages: [{ role: "user", content: "hi" }],
      }),
    });

  it("tags requests with the Claude Code session and filters logs by it", async () => {
    upstream(geminiOk);
    await withSession("aaaa-1111");
    await withSession("bbbb-2222");
    await withSession(42); // malformed: ignored
    const logs = await (await app.request("/api/logs?session=aaaa-1111")).json();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ sessionId: "aaaa-1111", modelOut: "gemini-3.8-flash" });
    const [newest] = await (await app.request("/api/logs")).json();
    expect(newest.sessionId).toBeUndefined();
  });

  it("only serves conversations of sessions on the board", async () => {
    const res = await app.request("/api/sessions/conversation?session=../../etc/passwd");
    expect(res.status).toBe(404);
  });

  it("validates sessions settings", async () => {
    expect((await put("/api/config", { sessions: { projectsRoot: "/definitely/not/here" } })).status).toBe(400);
    const ok = await (await put("/api/config", { sessions: { pollMs: 50 } })).json();
    expect(ok.config.sessions.pollMs).toBe(1000);
  });
});
