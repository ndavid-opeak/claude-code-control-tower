import { createHash } from "node:crypto";
import type { AnthropicTool } from "./types.js";

/** Gemini function names: start with a letter or `_`, then [A-Za-z0-9_.:-], 64 chars at most. */
const VALID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;

/**
 * The name Gemini sees for a tool. Valid names pass through unchanged; others (long MCP
 * names, odd characters) get a deterministic `<prefix>_<hash>` so no state is needed to map back.
 */
export function geminiName(name: string): string {
  if (VALID.test(name)) return name;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 6);
  let base = name.replace(/[^A-Za-z0-9_.:-]/g, "_");
  if (!/^[A-Za-z_]/.test(base)) base = `_${base}`;
  return `${base.slice(0, 64 - hash.length - 1)}_${hash}`;
}

/** Gemini name → original name, for the tools whose names were rewritten. */
export function originalNames(tools: AnthropicTool[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tools ?? []) {
    const g = geminiName(t.name);
    if (g !== t.name) map.set(g, t.name);
  }
  return map;
}
