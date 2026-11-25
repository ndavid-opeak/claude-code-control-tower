import path from 'node:path';
import { claudeAiConnectors, recordedTools } from '../../mcpTools.ts';
import { listProjects } from '../../projects.ts';
import { listPlugins, mcpServersOf, pluginMcpServers, readJson } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';
import { MCP_SERVER_LIMIT } from './limits.ts';

/** Too many MCP servers enabled: in the user config plus enabled plugins and claude.ai connectors, and per project with its own. */
export const mcpServers: Rule = ({ claudeHome, claudeJsonPath }) => {
  const findings: RuleFinding[] = [];
  const claudeJson = readJson(claudeJsonPath);
  const global = new Set(mcpServersOf(claudeJson?.mcpServers).map((s) => s.name));
  for (const p of listPlugins(claudeHome)) if (p.enabled) for (const s of pluginMcpServers(p)) global.add(s.name);
  // claude.ai connectors have no local config; they are counted from the tool names transcripts record.
  for (const id of claudeAiConnectors(recordedTools(claudeHome)).keys()) global.add(`claude.ai connector ${id}`);

  if (global.size > MCP_SERVER_LIMIT) {
    findings.push({
      id: 'context/mcp-servers',
      severity: 'medium',
      title: 'Many MCP servers enabled',
      detail: `${global.size} MCP servers are enabled for every session (limit ${MCP_SERVER_LIMIT}); each adds its tool definitions to every turn.`,
      file: claudeJsonPath,
      fix: 'Remove servers you rarely use (claude mcp remove <name>), disable the plugins that ship them, or remove claude.ai connectors in claude.ai settings under Connectors.',
    });
  }

  for (const project of listProjects(claudeHome)) {
    if (!project.exists) continue;
    const mcpFile = path.join(project.path, '.mcp.json');
    const own = new Set([
      ...mcpServersOf(readJson(mcpFile)?.mcpServers).map((s) => s.name),
      ...mcpServersOf(claudeJson?.projects?.[project.path]?.mcpServers).map((s) => s.name),
    ]);
    const total = new Set([...global, ...own]).size;
    if (own.size === 0 || total <= MCP_SERVER_LIMIT || global.size > MCP_SERVER_LIMIT) continue;
    findings.push({
      id: `context/mcp-servers:${project.path}`,
      severity: 'medium',
      title: 'Many MCP servers enabled in a project',
      detail: `Sessions in ${project.path} have ${total} MCP servers enabled (limit ${MCP_SERVER_LIMIT}), ${own.size} of them set up for this project.`,
      project: project.path,
      file: mcpFile,
      fix: `Remove servers this project does not need from ${mcpFile} or its entry in ~/.claude.json.`,
    });
  }
  return findings;
};
