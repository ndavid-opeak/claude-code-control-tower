import { cleanSchema } from "./schema.js";
import { SKIP_SIGNATURE, signatureFor } from "./signatures.js";
import { geminiName } from "./tools.js";
import type { AnthropicBlock, AnthropicRequest, GeminiContent, GeminiPart } from "./types.js";

/** Gemini rejects maxOutputTokens above 65536; Claude Code asks for up to 128000. */
const MAX_OUTPUT_TOKENS = 65536;

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: { functionDeclarations: { name: string; description?: string; parametersJsonSchema?: unknown }[] }[];
  toolConfig?: { functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE"; allowedFunctionNames?: string[] } };
  generationConfig: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
}

function blocks(content: string | AnthropicBlock[]): AnthropicBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function imagePart(block: Extract<AnthropicBlock, { type: "image" }>): GeminiPart {
  const src = block.source;
  return src.type === "base64"
    ? { inlineData: { mimeType: src.media_type, data: src.data } }
    : { fileData: { fileUri: src.url } };
}

/** Text Gemini sees for a tool result. tool_reference blocks come from Claude Code's ToolSearch. */
function resultText(inner: AnthropicBlock[]): string {
  return inner
    .map((x) => {
      if (x.type === "text") return (x as { text: string }).text;
      if (x.type === "tool_reference") return `Loaded tool: ${geminiName(String(x.tool_name))}. It is now available to call.`;
      if (x.type === "image") return ""; // sent as its own part
      return JSON.stringify(x).slice(0, 2000);
    })
    .filter(Boolean)
    .join("\n");
}

export function toGeminiRequest(req: AnthropicRequest): GeminiRequest {
  // tool_result blocks only carry the id; Gemini needs the function name.
  const toolNames = new Map<string, string>();
  for (const msg of req.messages) {
    for (const b of blocks(msg.content)) {
      if (b.type === "tool_use") toolNames.set((b as { id: string }).id, (b as { name: string }).name);
    }
  }

  const contents: GeminiContent[] = [];
  for (const msg of req.messages) {
    const parts: GeminiPart[] = [];
    let firstCall = true;
    for (const b of blocks(msg.content)) {
      switch (b.type) {
        case "text": {
          const text = (b as { text: string }).text;
          if (text) parts.push({ text });
          break;
        }
        case "image":
          parts.push(imagePart(b as Extract<AnthropicBlock, { type: "image" }>));
          break;
        case "tool_use": {
          const tu = b as { id: string; name: string; input: unknown };
          const part: GeminiPart = { functionCall: { name: geminiName(tu.name), args: (tu.input ?? {}) as Record<string, unknown> } };
          const sig = signatureFor(tu.id) ?? (firstCall ? SKIP_SIGNATURE : undefined);
          if (sig) part.thoughtSignature = sig;
          firstCall = false;
          parts.push(part);
          break;
        }
        case "tool_result": {
          const tr = b as { tool_use_id: string; content?: string | AnthropicBlock[]; is_error?: boolean };
          const inner = tr.content === undefined ? [] : blocks(tr.content);
          const text = resultText(inner);
          parts.push({
            functionResponse: {
              name: geminiName(toolNames.get(tr.tool_use_id) ?? "unknown_tool"),
              response: tr.is_error ? { error: text } : { content: text },
            },
          });
          for (const x of inner) if (x.type === "image") parts.push(imagePart(x as Extract<AnthropicBlock, { type: "image" }>));
          break;
        }
        // thinking / redacted_thinking and unknown blocks are Anthropic-specific: drop.
      }
    }
    if (!parts.length) continue;
    if (msg.role === "assistant") contents.push({ role: "model", parts });
    // Gemini rejects a user turn where other parts follow a functionResponse ("Requests ending
    // with a model turn are not supported"), e.g. Claude Code's "Tool loaded." after ToolSearch.
    else contents.push({ role: "user", parts: [...parts.filter((p) => !p.functionResponse), ...parts.filter((p) => p.functionResponse)] });
  }

  const out: GeminiRequest = {
    contents,
    generationConfig: {
      maxOutputTokens: req.max_tokens && Math.min(req.max_tokens, MAX_OUTPUT_TOKENS),
      temperature: req.temperature,
      topP: req.top_p,
      topK: req.top_k,
      stopSequences: req.stop_sequences,
    },
  };

  const system = typeof req.system === "string" ? req.system : req.system?.map((s) => s.text).join("\n\n");
  if (system) out.systemInstruction = { parts: [{ text: system }] };

  // Server tools (web_search etc.) have a `type` and no input_schema; Gemini cannot run them.
  const tools = (req.tools ?? []).filter((t) => t.input_schema);
  if (tools.length) {
    out.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: geminiName(t.name),
          description: t.description,
          parametersJsonSchema: cleanSchema(t.input_schema),
        })),
      },
    ];
    const choice = req.tool_choice;
    if (choice) {
      out.toolConfig = {
        functionCallingConfig:
          choice.type === "tool"
            ? { mode: "ANY", allowedFunctionNames: [geminiName(choice.name)] }
            : { mode: choice.type === "any" ? "ANY" : choice.type === "none" ? "NONE" : "AUTO" },
      };
    }
  }
  return out;
}
