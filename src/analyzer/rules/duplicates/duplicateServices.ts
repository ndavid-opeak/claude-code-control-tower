import fs from 'node:fs';
import path from 'node:path';
import { listPlugins, mcpServersOf, pluginMcpServers, readJson } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

// Finds one service connected more than once: as a plugin's MCP server, an `mcpServers` entry, or a
// claude.ai connector. Connectors have no local config, so they are found from the tool names
// (`mcp__<uuid>__<tool>`) that session transcripts record. Plugin servers appear there as
// `mcp__plugin_<plugin>_<server>__<tool>` and local servers as `mcp__<name>__<tool>`.

const RECENT_TRANSCRIPTS = 30;
const TOOL = /mcp__((?:(?!__)[\w.-])+)__([\w.-]+)/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Source {
  kind: 'plugin' | 'mcpServers' | 'connector';
  /** Where the user would remove it. */
  label: string;
  /** Lower-cased server name; empty for connectors. */
  name: string;
  target: string;
  tools: Set<string>;
}

/** Tool names per MCP server name, from the most recently modified transcripts. */
function recordedTools(claudeHome: string): Map<string, Set<string>> {
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

function sourcesOf(claudeHome: string, claudeJsonPath: string): Source[] {
  const recorded = recordedTools(claudeHome);
  const sources: Source[] = [];
  const toolsFor = (server: string) => recorded.get(server) ?? new Set<string>();

  for (const p of listPlugins(claudeHome)) {
    if (!p.enabled) continue;
    // Transcripts name servers after the manifest's name, which can differ from the install id's.
    const manifestName = readJson(path.join(p.installPath, '.claude-plugin', 'plugin.json'))?.name;
    for (const s of pluginMcpServers(p)) {
      const tools = new Set(toolsFor(`plugin_${p.name}_${s.name}`));
      if (typeof manifestName === 'string') for (const t of toolsFor(`plugin_${manifestName}_${s.name}`)) tools.add(t);
      sources.push({
        kind: 'plugin',
        label: `plugin ${p.id} (server "${s.name}")`,
        name: s.name.toLowerCase(),
        target: s.target,
        tools,
      });
    }
  }

  const config = readJson(claudeJsonPath);
  const local = [{ where: '~/.claude.json', servers: mcpServersOf(config?.mcpServers) }];
  for (const [proj, v] of Object.entries<any>(config?.projects ?? {})) {
    local.push({ where: `~/.claude.json, project ${proj}`, servers: mcpServersOf(v?.mcpServers) });
  }
  for (const { where, servers } of local) {
    for (const s of servers) {
      sources.push({ kind: 'mcpServers', label: `mcpServers entry "${s.name}" in ${where}`, name: s.name.toLowerCase(), target: s.target, tools: toolsFor(s.name) });
    }
  }

  for (const [server, tools] of recorded) {
    if (UUID.test(server)) sources.push({ kind: 'connector', label: `claude.ai connector ${server}`, name: '', target: '', tools });
  }
  return sources;
}

const sameService = (a: Source, b: Source) =>
  (a.name !== '' && a.name === b.name && !(a.kind === 'mcpServers' && b.kind === 'mcpServers')) ||
  (a.target !== '' && a.target === b.target) ||
  [...a.tools].some((t) => b.tools.has(t));

/** The same service connected through two or more of plugins, mcpServers and claude.ai connectors. */
export const duplicateServices: Rule = ({ claudeHome, claudeJsonPath }) => {
  const sources = sourcesOf(claudeHome, claudeJsonPath);
  const parent = sources.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) if (sameService(sources[i], sources[j])) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Source[]>();
  sources.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));

  const priority = { plugin: 0, mcpServers: 1, connector: 2 };
  const findings: RuleFinding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => priority[a.kind] - priority[b.kind] || a.label.localeCompare(b.label));
    const [keep, ...drop] = group;
    const service = group.find((s) => s.name)?.name ?? [...group[0].tools][0]?.split('_')[0] ?? 'unknown';
    findings.push({
      id: `duplicates/service:${group.map((s) => s.label).sort().join('|')}`,
      severity: 'medium',
      title: `${service} is connected ${group.length} times`,
      detail: `The same service is connected through: ${group.map((s) => s.label).join('; ')}. Each copy adds its tool definitions to every session.`,
      fix: `Keep ${keep.label}. Remove ${drop.map((s) => s.label).join('; ')}${drop.some((s) => s.kind === 'connector') ? ' (claude.ai connectors are removed in claude.ai settings under Connectors)' : ''}.`,
    });
  }
  return findings;
};
