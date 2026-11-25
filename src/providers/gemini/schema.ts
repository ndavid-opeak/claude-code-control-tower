/**
 * Gemini's `parametersJsonSchema` accepts standard JSON Schema, but rejects a few
 * meta keys that Claude Code's tool schemas carry. Strip them recursively.
 */
const DROP = new Set(["$schema", "$id", "$comment"]);

export function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (!DROP.has(key)) out[key] = cleanSchema(child);
    }
    return out;
  }
  return value;
}
