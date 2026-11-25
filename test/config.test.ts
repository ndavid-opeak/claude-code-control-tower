import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENV_FILE = join(mkdtempSync(join(tmpdir(), "claude-router-env-")), ".env");
process.env.CLAUDE_ROUTER_ENV_FILE = ENV_FILE;
const { migrate } = await import("../src/config.js");

describe("config migration", () => {
  it("turns the old single-Gemini config into providers and routes", () => {
    writeFileSync(ENV_FILE, "GEMINI_API_KEY=k\nVERTEX_PROJECT=123456\n");
    const cfg = migrate({
      active: "gemini",
      models: { opus: "gemini-3.1-pro-preview", sonnet: "gemini-3.8-flash", haiku: "gemini-3.5-flash-lite" },
      geminiApi: "vertex",
      port: 3456,
    });
    expect(cfg.mode).toBe("route");
    expect(cfg.providers[1]).toMatchObject({ id: "vertex", api: "vertex", project: "123456", location: "global", keyEnv: ["GEMINI_API_KEY"] });
    expect(cfg.routes).toEqual({
      opus: ["vertex/gemini-3.1-pro-preview", "anthropic"],
      sonnet: ["vertex/gemini-3.8-flash", "anthropic"],
      haiku: ["vertex/gemini-3.5-flash-lite", "anthropic"],
    });
  });

  it("keeps pass-through mode when Anthropic was active", () => {
    expect(migrate({ active: "anthropic", geminiApi: "aistudio" }).mode).toBe("anthropic");
  });

  it("leaves a v2 config as is, filling missing fallback settings", () => {
    const cfg = migrate({ mode: "route", providers: [{ id: "anthropic", type: "anthropic" }], routes: { opus: ["anthropic"], sonnet: ["anthropic"], haiku: ["anthropic"] } });
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.fallback).toEqual({ cooldownSec: 60, timeoutMs: 600_000 });
  });
});
