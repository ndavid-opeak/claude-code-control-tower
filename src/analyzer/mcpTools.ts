import fs from 'node:fs';
import path from 'node:path';

// MCP tool names recorded in session transcripts (`mcp__<server>__<tool>`). Plugin servers appear as
// `mcp__plugin_<plugin>_<server>__<tool>`, local servers as `mcp__<name>__<tool>` and claude.ai
// connectors, which have no local config, as `mcp__<uuid>__<tool>`.

const RECENT_TRANSCRIPTS = 30;
const TOOL = /mcp__((?:(?!__)[\w.-])+)__([\w.-]+)/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tool names per MCP server name, from the most recently modified transcripts. */
export function recordedTools(claudeHome: string): Map<string, Set<string>> {
  const files: { file: string; mtime: number }[] = [];
  const root = path.join(claudeHome, 'projects');
  try {
    for (const dir of fs.readdirSync(root)) {
      try {
        for (const f of fs.readdirSync(path.join(root, dir))) {
          if (!f.endsWith('.jsonl')) continue;
          const file = path.join(root, dir, f);
          files.push({ file, mtime: fs.statSync(file).mtimeMs });
        }
      } catch {}
    }
  } catch {
    return new Map();
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = new Map<string, Set<string>>();
  for (const { file } of files.slice(0, RECENT_TRANSCRIPTS)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(TOOL)) {
      const set = out.get(m[1]) ?? new Set<string>();
      set.add(m[2]);
      out.set(m[1], set);
    }
  }
  return out;
}

/** The claude.ai connectors the transcripts show, by connector id, with the tools seen for each. */
export function claudeAiConnectors(recorded: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...recorded].filter(([server]) => UUID.test(server)));
}
