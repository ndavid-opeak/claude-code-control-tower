import path from 'node:path';
import { readJson } from '../../setup.ts';
import type { Rule } from '../types.ts';

/**
 * MCP servers Claude Code could not use because they need sign-in. It records them in
 * ~/.claude/mcp-needs-auth-cache.json, keyed by server name; no file means none are waiting.
 */
export const mcpNeedsAuth: Rule = ({ claudeHome }) => {
  const file = path.join(claudeHome, 'mcp-needs-auth-cache.json');
  const cache = readJson(file);
  if (!cache || typeof cache !== 'object') return [];
  return Object.keys(cache)
    .sort()
    .map((name) => ({
      id: `hygiene/mcp-needs-auth:${name}`,
      severity: 'low' as const,
      title: `MCP server ${name} is waiting for sign-in`,
      detail: `Claude Code recorded that ${name} needs authentication, so its tools are unavailable until you sign in.`,
      file,
      fix: `Run /mcp in Claude Code and authenticate ${name}, or remove the server if you no longer use it.`,
    }));
};
