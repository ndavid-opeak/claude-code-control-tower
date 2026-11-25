import fs from 'node:fs';
import path from 'node:path';

// Shared lookups for rules that inspect plugins, skills and plugin MCP servers. Read-only.

export function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export interface Plugin {
  /** e.g. "slack@anthropic-plugin-directory" */
  id: string;
  /** e.g. "slack": the prefix its skills get */
  name: string;
  marketplace: string;
  scope: 'user' | 'project' | 'local';
  /** The folder a project- or local-scope install belongs to. */
  projectPath?: string;
  installPath: string;
  /** Turned on in the settings file matching its scope. */
  enabled: boolean;
}

/** Every plugin install recorded in ~/.claude/plugins/installed_plugins.json. */
export function listPlugins(claudeHome: string): Plugin[] {
  const installed = readJson(path.join(claudeHome, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  // settings.local.json overrides settings.json.
  const userEnabled = {
    ...readJson(path.join(claudeHome, 'settings.json'))?.enabledPlugins,
    ...readJson(path.join(claudeHome, 'settings.local.json'))?.enabledPlugins,
  };
  const out: Plugin[] = [];
  for (const [id, entries] of Object.entries<any[]>(installed)) {
    const [name, marketplace = ''] = id.split('@');
    for (const e of Array.isArray(entries) ? entries : []) {
      const scope = e.scope === 'project' || e.scope === 'local' ? e.scope : 'user';
      const enabledMap =
        scope === 'user'
          ? userEnabled
          : (readJson(path.join(e.projectPath ?? '', '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json'))
              ?.enabledPlugins ?? {});
      out.push({
        id,
        name,
        marketplace,
        scope,
        ...(scope !== 'user' && e.projectPath ? { projectPath: e.projectPath } : {}),
        installPath: e.installPath,
        enabled: enabledMap[id] === true,
      });
    }
  }
  return out;
}

export interface Skill {
  /** The name in its SKILL.md. */
  name: string;
  /** How Claude Code lists it: "name" for user skills, "plugin:name" for plugin skills. */
  qualifiedName: string;
  description: string;
  /** Its SKILL.md. */
  file: string;
  /** "user", or the id of the plugin that ships it. */
  source: string;
}

/** User skills in ~/.claude/skills plus the skills of every enabled plugin. */
export function listSkills(claudeHome: string, plugins: Plugin[] = listPlugins(claudeHome)): Skill[] {
  const out: Skill[] = [];
  for (const s of skillsIn(path.join(claudeHome, 'skills'))) out.push({ ...s, qualifiedName: s.name, source: 'user' });
  for (const p of plugins) {
    if (!p.enabled) continue;
    for (const s of skillsIn(path.join(p.installPath, 'skills'))) out.push({ ...s, qualifiedName: `${p.name}:${s.name}`, source: p.id });
  }
  return out;
}

function skillsIn(dir: string): { name: string; description: string; file: string }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: { name: string; description: string; file: string }[] = [];
  for (const n of names) {
    const file = path.join(dir, n, 'SKILL.md');
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    out.push({ name: fm.name || n, description: fm.description ?? '', file });
  }
  return out;
}

/** Prefix of skills synced from claude.ai, as Claude Code lists them ("anthropic-skills:pdf"). */
export const SYNCED_SKILLS_ID = 'anthropic-skills';

/**
 * Skills synced from claude.ai into ~/.claude/skills/synced/<bucket>/<skill>. Each bucket (one per
 * account/organization) can hold the same skills, so a name appears once.
 */
export function listSyncedSkills(claudeHome: string): Skill[] {
  const root = path.join(claudeHome, 'skills', 'synced');
  let buckets: string[] = [];
  try {
    buckets = fs.readdirSync(root).filter((b) => !b.startsWith('.')).sort();
  } catch {
    return [];
  }
  const out = new Map<string, Skill>();
  for (const b of buckets) {
    for (const s of skillsIn(path.join(root, b))) {
      if (!out.has(s.name)) out.set(s.name, { ...s, qualifiedName: `${SYNCED_SKILLS_ID}:${s.name}`, source: SYNCED_SKILLS_ID });
    }
  }
  return [...out.values()];
}

/** Top-level `key: value` pairs of a Markdown file's YAML frontmatter, enough for name and description. */
export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  let key = '';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = unquote(kv[2].trim().replace(/^[|>][-+]?$/, ''));
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = (out[key] ? out[key] + ' ' : '') + line.trim();
    }
  }
  return out;
}

const unquote = (v: string) => (/^(['"]).*\1$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);

export interface McpServer {
  name: string;
  /** The URL for http/sse servers, the command line for stdio ones. */
  target: string;
}

/** The MCP servers a plugin ships in its .mcp.json. */
export function pluginMcpServers(plugin: Plugin): McpServer[] {
  return mcpServersOf(readJson(path.join(plugin.installPath, '.mcp.json'))?.mcpServers);
}

/** Normalizes an `mcpServers` object (from .mcp.json or ~/.claude.json) into a list. */
export function mcpServersOf(servers: unknown): McpServer[] {
  if (!servers || typeof servers !== 'object') return [];
  return Object.entries<any>(servers).map(([name, s]) => ({
    name,
    target: s?.url ?? [s?.command, ...(Array.isArray(s?.args) ? s.args : [])].filter(Boolean).join(' '),
  }));
}
