import { describe, expect, it } from "vitest";
import { toGeminiRequest } from "../src/providers/gemini/request.js";
import { cleanSchema } from "../src/providers/gemini/schema.js";
import { rememberSignature, SKIP_SIGNATURE } from "../src/providers/gemini/signatures.js";
import { geminiName, originalNames } from "../src/providers/gemini/tools.js";

describe("toGeminiRequest", () => {
  it("maps system, roles, text and generation config", () => {
    const out = toGeminiRequest({
      model: "claude-sonnet-5-5",
      system: [{ type: "text", text: "Be brief." }, { type: "text", text: "Use tools." }],
      max_tokens: 100,
      temperature: 0.2,
      stop_sequences: ["END"],
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "hello" }] },
      ],
    });
    expect(out.systemInstruction).toEqual({ parts: [{ text: "Be brief.\n\nUse tools." }] });
    expect(out.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] },
    ]);
    expect(out.generationConfig).toMatchObject({ maxOutputTokens: 100, temperature: 0.2, stopSequences: ["END"] });
  });

  it("caps maxOutputTokens at Gemini's limit", () => {
    const out = toGeminiRequest({ model: "claude-opus-5-5", max_tokens: 128000, messages: [{ role: "user", content: "hi" }] });
    expect(out.generationConfig?.maxOutputTokens).toBe(65536);
  });

  it("maps images", () => {
    const out = toGeminiRequest({
      model: "m",
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] }],
    });
    expect(out.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "AAA" } });
  });

  it("maps tool_use / tool_result with name lookup and signatures", () => {
    rememberSignature("toolu_known", "SIG_A");
    const out = toGeminiRequest({
      model: "m",
      messages: [
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_known", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "toolu_second", name: "Read", input: { path: "a" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_known", content: "a\nb" },
            { type: "tool_result", tool_use_id: "toolu_second", content: [{ type: "text", text: "nope" }], is_error: true },
          ],
        },
      ],
    });
    expect(out.contents[1].parts).toEqual([
      { functionCall: { name: "Bash", args: { command: "ls" } }, thoughtSignature: "SIG_A" },
      { functionCall: { name: "Read", args: { path: "a" } } },
    ]);
    expect(out.contents[2].parts).toEqual([
      { functionResponse: { name: "Bash", response: { content: "a\nb" } } },
      { functionResponse: { name: "Read", response: { error: "nope" } } },
    ]);
  });

  it("uses the skip signature for calls Gemini did not make (provider switched mid-session)", () => {
    const out = toGeminiRequest({
      model: "m",
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "toolu_from_claude", name: "Bash", input: {} }] }],
    });
    expect(out.contents[0].parts[0].thoughtSignature).toBe(SKIP_SIGNATURE);
  });

  it("maps tools and tool_choice, skipping server tools", () => {
    const out = toGeminiRequest({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [
        { name: "Bash", description: "run", input_schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" } },
        { name: "web_search", type: "web_search_20250305" },
      ],
      tool_choice: { type: "tool", name: "Bash" },
    });
    expect(out.tools).toEqual([{ functionDeclarations: [{ name: "Bash", description: "run", parametersJsonSchema: { type: "object" } }] }]);
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["Bash"] } });
  });

  it("turns ToolSearch tool_reference results into text and keeps functionResponse last in the turn", () => {
    // Shape captured from Claude Code with the Slack MCP (tool search on).
    const out = toGeminiRequest({
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_s", name: "ToolSearch", input: { query: "slack" } }] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_s", content: [{ type: "tool_reference", tool_name: "mcp__slack__list" }] },
            { type: "text", text: "Tool loaded." },
          ],
        },
      ],
    });
    expect(out.contents[1].parts).toEqual([
      { text: "Tool loaded." },
      { functionResponse: { name: "ToolSearch", response: { content: "Loaded tool: mcp__slack__list. It is now available to call." } } },
    ]);
  });

  it("rewrites tool names Gemini rejects, consistently in tools, calls and results", () => {
    const long = "mcp__plugin_chrome-devtools-mcp_chrome-devtools__performance_analyze_insight";
    const out = toGeminiRequest({
      model: "m",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_l", name: long, input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_l", content: "ok" }] },
      ],
      tools: [{ name: long, input_schema: { type: "object" } }],
    });
    const name = geminiName(long);
    expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/);
    expect(out.tools![0].functionDeclarations[0].name).toBe(name);
    expect(out.contents[0].parts[0].functionCall!.name).toBe(name);
    expect(out.contents[1].parts[0].functionResponse!.name).toBe(name);
    expect(originalNames([{ name: long }, { name: "Bash" }])).toEqual(new Map([[name, long]]));
  });
});

describe("cleanSchema", () => {
  it("drops meta keys recursively and keeps the rest", () => {
    expect(
      cleanSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { $comment: "c", type: "string" } } }),
    ).toEqual({ type: "object", additionalProperties: false, properties: { a: { type: "string" } } });
  });
});
