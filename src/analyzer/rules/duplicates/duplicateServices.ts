import path from 'node:path';
import { claudeAiConnectors, recordedTools } from '../../mcpTools.ts';
import { listPlugins, mcpServersOf, pluginMcpServers, readJson } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

// Finds one service connected more than once: as a plugin's MCP server, an `mcpServers` entry, or a
// claude.ai connector. Connectors have no local config, so they are found from the tool names
// (`mcp__<uuid>__<tool>`) that session transcripts record. Plugin servers appear there as
// `mcp__plugin_<plugin>_<server>__<tool>` and local servers as `mcp__<name>__<tool>`.

interface Source {
  kind: 'plugin' | 'mcpServers' | 'connector';
  /** Where the user would remove it. */
  label: string;
  /** Lower-cased server name; empty for connectors. */
  name: string;
  target: string;
  tools: Set<string>;
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

  for (const [server, tools] of claudeAiConnectors(recorded)) {
    sources.push({ kind: 'connector', label: `claude.ai connector ${server}`, name: '', target: '', tools });
  }
  return sources;
}

/** Generic tool names (search, fetch, read) are shared by unrelated services, so one shared name proves nothing. */
function substantialOverlap(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared >= 2 && shared >= Math.min(a.size, b.size) / 2;
}

const sameService = (a: Source, b: Source) =>
  (a.name !== '' && a.name === b.name && !(a.kind === 'mcpServers' && b.kind === 'mcpServers')) ||
  (a.target !== '' && a.target === b.target) ||
  substantialOverlap(a.tools, b.tools);

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
