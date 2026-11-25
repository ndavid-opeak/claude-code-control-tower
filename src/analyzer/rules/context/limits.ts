/** Estimated tokens (characters ÷ 4) of the CLAUDE.md/AGENTS.md chain one project loads. */
export const INSTRUCTION_TOKEN_LIMIT = 5000;
/** Estimated tokens of all skill descriptions sent every turn. */
export const SKILL_DESCRIPTION_TOKEN_LIMIT = 2000;
/** Enabled MCP servers (user config, enabled plugins, and one project's own). */
export const MCP_SERVER_LIMIT = 8;

export const estimateTokens = (chars: number) => Math.ceil(chars / 4);
