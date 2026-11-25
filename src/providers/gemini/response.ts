import { randomBytes } from "node:crypto";
import { rememberSignature } from "./signatures.js";
import type { GeminiResponse } from "./types.js";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

const newId = (prefix: string) => prefix + randomBytes(12).toString("base64url");

function usageOf(res: GeminiResponse): Usage | undefined {
  const u = res.usageMetadata;
  if (!u) return undefined;
  return {
    input_tokens: u.promptTokenCount ?? 0,
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

function stopReason(finish: string | undefined, sawToolCall: boolean): string {
  if (sawToolCall) return "tool_use";
  if (finish === "MAX_TOKENS") return "max_tokens";
  if (finish && finish !== "STOP") console.warn(`[gemini] finishReason ${finish} mapped to end_turn`);
  return "end_turn";
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Turns Gemini stream chunks into Anthropic SSE events. */
export class StreamTranslator {
  usage: Usage = { input_tokens: 0, output_tokens: 0 };
  private index = -1;
  private textOpen = false;
  private sawToolCall = false;
  private finish: string | undefined;

  constructor(
    private model: string,
    private names: Map<string, string> = new Map(),
  ) {}

  start(): string {
    return sse("message_start", {
      type: "message_start",
      message: {
        id: newId("msg_"),
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  push(chunk: GeminiResponse): string {
    let out = "";
    const cand = chunk.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (part.thought) continue;
      if (part.functionCall) {
        out += this.closeText();
        const id = newId("toolu_");
        if (part.thoughtSignature) rememberSignature(id, part.thoughtSignature);
        this.sawToolCall = true;
        this.index++;
        out += sse("content_block_start", {
          type: "content_block_start",
          index: this.index,
          content_block: { type: "tool_use", id, name: this.names.get(part.functionCall.name) ?? part.functionCall.name, input: {} },
        });
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index: this.index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(part.functionCall.args ?? {}) },
        });
        out += sse("content_block_stop", { type: "content_block_stop", index: this.index });
      } else if (part.text) {
        if (!this.textOpen) {
          this.index++;
          this.textOpen = true;
          out += sse("content_block_start", {
            type: "content_block_start",
            index: this.index,
            content_block: { type: "text", text: "" },
          });
        }
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index: this.index,
          delta: { type: "text_delta", text: part.text },
        });
      }
    }
    if (cand?.finishReason) this.finish = cand.finishReason;
    this.usage = usageOf(chunk) ?? this.usage;
    return out;
  }

  end(): string {
    return (
      this.closeText() +
      sse("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason(this.finish, this.sawToolCall), stop_sequence: null },
        usage: this.usage,
      }) +
      sse("message_stop", { type: "message_stop" })
    );
  }

  private closeText(): string {
    if (!this.textOpen) return "";
    this.textOpen = false;
    return sse("content_block_stop", { type: "content_block_stop", index: this.index });
  }
}

/** Parses a `text/event-stream` body into JSON chunks. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiResponse> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data);
    }
  }
}

/** Non-streaming Gemini response → Anthropic message. */
/** `names` maps rewritten Gemini function names back to Claude Code's (see tools.ts). */
export function toAnthropicMessage(res: GeminiResponse, model: string, names: Map<string, string> = new Map()) {
  const content: unknown[] = [];
  let sawToolCall = false;
  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.thought) continue;
    if (part.functionCall) {
      const id = newId("toolu_");
      if (part.thoughtSignature) rememberSignature(id, part.thoughtSignature);
      sawToolCall = true;
      const name = names.get(part.functionCall.name) ?? part.functionCall.name;
      content.push({ type: "tool_use", id, name, input: part.functionCall.args ?? {} });
    } else if (part.text) {
      const last = content.at(-1) as { type: string; text: string } | undefined;
      if (last?.type === "text") last.text += part.text;
      else content.push({ type: "text", text: part.text });
    }
  }
  return {
    id: newId("msg_"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason(res.candidates?.[0]?.finishReason, sawToolCall),
    stop_sequence: null,
    usage: usageOf(res) ?? { input_tokens: 0, output_tokens: 0 },
  };
}

export function anthropicError(status: number, message: string) {
  const type =
    status === 400 ? "invalid_request_error"
    : status === 401 ? "authentication_error"
    : status === 403 ? "permission_error"
    : status === 404 ? "not_found_error"
    : status === 429 ? "rate_limit_error"
    : status === 529 || status === 503 ? "overloaded_error"
    : "api_error";
  return { type: "error", error: { type, message } };
}
