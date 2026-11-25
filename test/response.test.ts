import { describe, expect, it } from "vitest";
import { readSse, StreamTranslator, toAnthropicMessage } from "../src/providers/gemini/response.js";
import { signatureFor } from "../src/providers/gemini/signatures.js";

function events(sse: string) {
  return sse
    .trim()
    .split("\n\n")
    .map((e) => JSON.parse(e.split("\n")[1].slice(6)));
}

describe("StreamTranslator", () => {
  it("streams text then ends with end_turn and usage", () => {
    const t = new StreamTranslator("claude-sonnet-5-5");
    const out =
      t.start() +
      t.push({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] }) +
      t.push({
        candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3 },
      }) +
      t.end();
    const ev = events(out);
    expect(ev.map((e) => e.type)).toEqual([
      "message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop",
    ]);
    expect(ev[0].message.model).toBe("claude-sonnet-5-5");
    expect(ev[2].delta).toEqual({ type: "text_delta", text: "Hel" });
    expect(ev[5].delta.stop_reason).toBe("end_turn");
    expect(ev[5].usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("emits tool_use blocks, remembers signatures, skips thoughts", () => {
    const t = new StreamTranslator("m");
    t.start();
    const out =
      t.push({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Let me look." }] } }] }) +
      t.push({
        candidates: [{
          content: { parts: [{ functionCall: { name: "Bash", args: { command: "ls" } }, thoughtSignature: "SIG" }] },
          finishReason: "STOP",
        }],
      }) +
      t.end();
    const ev = events(out);
    expect(ev.map((e) => e.type)).toEqual([
      "content_block_start", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop",
      "message_delta", "message_stop",
    ]);
    expect(ev[1].delta.text).toBe("Let me look.");
    const tool = ev[3].content_block;
    expect(ev[3].index).toBe(1);
    expect(tool).toMatchObject({ type: "tool_use", name: "Bash", input: {} });
    expect(JSON.parse(ev[4].delta.partial_json)).toEqual({ command: "ls" });
    expect(signatureFor(tool.id)).toBe("SIG");
    expect(ev[6].delta.stop_reason).toBe("tool_use");
  });

  it("maps MAX_TOKENS", () => {
    const t = new StreamTranslator("m");
    t.push({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "MAX_TOKENS" }] });
    expect(events(t.end()).find((e) => e.type === "message_delta").delta.stop_reason).toBe("max_tokens");
  });
});

describe("readSse", () => {
  it("parses events split across chunks", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"a":'));
        c.enqueue(enc.encode('1}\r\n\r\ndata: {"a":2}\n\n'));
        c.close();
      },
    });
    const got = [];
    for await (const x of readSse(body)) got.push(x);
    expect(got).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("toAnthropicMessage", () => {
  it("merges text and maps function calls", () => {
    const msg = toAnthropicMessage(
      {
        candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }, { functionCall: { name: "Read", args: { p: 1 } } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
      },
      "claude-haiku-5-5",
    );
    expect(msg.content[0]).toEqual({ type: "text", text: "ab" });
    expect(msg.content[1]).toMatchObject({ type: "tool_use", name: "Read", input: { p: 1 } });
    expect(msg.stop_reason).toBe("tool_use");
    expect(msg.usage).toEqual({ input_tokens: 4, output_tokens: 6 });
  });

  it("maps rewritten function names back to Claude Code's tool names", () => {
    const names = new Map([["short_abc123", "mcp__very_long_original"]]);
    const res = { candidates: [{ content: { parts: [{ functionCall: { name: "short_abc123", args: {} } }] }, finishReason: "STOP" }] };
    expect(toAnthropicMessage(res, "m", names).content[0]).toMatchObject({ name: "mcp__very_long_original" });
    const stream = new StreamTranslator("m", names);
    expect(stream.push(res)).toContain('"name":"mcp__very_long_original"');
  });
});
