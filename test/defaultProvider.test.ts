import { describe, expect, it } from "vitest";
import type { Config } from "../web/src/lib/api.ts";
import { defaultProviderOf, familiesMissing, makeDefault } from "../web/src/lib/defaultProvider.ts";

const base = (): Config =>
  ({
    mode: "route",
    providers: [
      { id: "anthropic", type: "anthropic" },
      { id: "vertex", type: "gemini", api: "vertex", keyEnv: ["K"] },
      { id: "studio", type: "gemini", api: "aistudio", keyEnv: ["K"] },
    ],
    routes: {
      opus: ["vertex/pro", "anthropic"],
      sonnet: ["vertex/flash", "studio/flash", "anthropic"],
      haiku: ["vertex/lite", "anthropic"],
    },
  }) as Config;

describe("default provider", () => {
  it("is the provider every family starts with", () => {
    expect(defaultProviderOf(base())).toBe("vertex");
    expect(defaultProviderOf({ ...base(), mode: "anthropic" })).toBe("anthropic");
  });

  it("skips disabled providers and is null when families differ", () => {
    const cfg = base();
    cfg.providers[1].enabled = false;
    expect(defaultProviderOf(cfg)).toBeNull(); // sonnet → studio, others → anthropic
  });

  it("moves the provider's targets to the top and keeps the rest as fallbacks", () => {
    const cfg = base();
    cfg.routes.opus = ["vertex/pro", "studio/pro", "anthropic"];
    cfg.routes.haiku = ["studio/lite", "anthropic"];
    expect(familiesMissing(cfg, "studio")).toEqual([]);
    const patch = makeDefault(cfg, "studio");
    expect(patch.mode).toBe("route");
    expect(patch.routes).toEqual({
      opus: ["studio/pro", "vertex/pro", "anthropic"],
      sonnet: ["studio/flash", "vertex/flash", "anthropic"],
      haiku: ["studio/lite", "anthropic"],
    });
    expect(defaultProviderOf({ ...cfg, ...patch })).toBe("studio");
  });

  it("asks for a model where a family has no target, and enables the provider", () => {
    const cfg = base();
    cfg.providers[2].enabled = false;
    expect(familiesMissing(cfg, "studio")).toEqual(["opus", "haiku"]);
    expect(() => makeDefault(cfg, "studio")).toThrow(/opus/);
    const patch = makeDefault(cfg, "studio", { opus: "pro", haiku: " lite " });
    expect(patch.routes!.opus).toEqual(["studio/pro", "vertex/pro", "anthropic"]);
    expect(patch.routes!.haiku).toEqual(["studio/lite", "vertex/lite", "anthropic"]);
    expect(patch.providers!.find((p) => p.id === "studio")!.enabled).toBe(true);
  });

  it("makes Anthropic the default by switching to pass-through", () => {
    expect(makeDefault(base(), "anthropic")).toEqual({ mode: "anthropic" });
  });
});
