/**
 * Gemini attaches a `thoughtSignature` to function calls and requires it back on the
 * next turn. Claude Code only keeps the Anthropic tool_use id, so remember the
 * signature by that id.
 */
const MAX = 5000;
const byToolId = new Map<string, string>();

export function rememberSignature(toolUseId: string, signature: string): void {
  byToolId.set(toolUseId, signature);
  if (byToolId.size > MAX) byToolId.delete(byToolId.keys().next().value!);
}

export function signatureFor(toolUseId: string): string | undefined {
  return byToolId.get(toolUseId);
}

/**
 * Documented placeholder for function calls Gemini did not generate itself (for
 * example ones made by Claude before the user switched provider mid-session).
 */
export const SKIP_SIGNATURE = "context_engineering_is_the_way_to_go";
