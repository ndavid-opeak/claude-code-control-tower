import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';
import { INSTRUCTION_TOKEN_LIMIT, MCP_SERVER_LIMIT, SKILL_DESCRIPTION_TOKEN_LIMIT } from '../../src/analyzer/rules/context/limits.ts';

let tmp: string;
let home: string;
let claudeJsonPath: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-context-')));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
  claudeJsonPath = path.join(tmp, '.claude.json');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const context = () => analyze({ claudeHome: home, claudeJsonPath, now: NOW, window: 30 }).findings.filter((f) => f.category === 'context');
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const project = (name: string) => {
  const cwd = path.join(tmp, 'work', name);
  fs.mkdirSync(cwd, { recursive: true });
  write(path.join(home, 'projects', `-${name}`, 's.jsonl'), JSON.stringify({ type: 'user', cwd }) + '\n');
  return cwd;
};
const skill = (dir: string, name: string, description: string) =>
  write(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody`);
const enablePlugin = (installPath: string) => {
  write(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ scope: 'user', installPath }] } }));
  write(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }));
};

describe('instruction chain size', () => {
  it('flags a project above the limit, naming the project and the biggest file, with ~ numbers', () => {
    const p = project('big');
    write(path.join(p, 'CLAUDE.md'), 'x'.repeat(INSTRUCTION_TOKEN_LIMIT * 4 + 4));
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ severity: 'medium', project: p, file: path.join(p, 'CLAUDE.md'), estimated: true });
    expect(f.detail).toContain(`~${INSTRUCTION_TOKEN_LIMIT + 1}`);
    expect(f.fix).toMatch(/trim|split|move/i);
  });

  it('does not flag at the limit, nor a project whose folder is gone', () => {
    const p = project('ok');
    write(path.join(p, 'CLAUDE.md'), 'x'.repeat(INSTRUCTION_TOKEN_LIMIT * 4));
    const gone = project('gone');
    write(path.join(gone, 'CLAUDE.md'), 'x'.repeat(INSTRUCTION_TOKEN_LIMIT * 8));
    fs.rmSync(gone, { recursive: true });
    expect(context()).toEqual([]);
  });
});

describe('skill descriptions', () => {
  it('flags user and enabled plugin skills together above the limit, not at it', () => {
    skill(path.join(home, 'skills'), 'a', 'x'.repeat(SKILL_DESCRIPTION_TOKEN_LIMIT * 4));
    expect(context()).toEqual([]);
    const plugin = path.join(tmp, 'plug');
    skill(path.join(plugin, 'skills'), 'b', 'y'.repeat(8));
    enablePlugin(plugin);
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ estimated: true, file: path.join(home, 'skills', 'a', 'SKILL.md') });
    expect(f.detail).toMatch(/~\d+/);
  });
});

describe('MCP servers', () => {
  const servers = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { command: 'x' }]));
  it('flags more servers than the limit across user config and plugins, not at it', () => {
    write(claudeJsonPath, JSON.stringify({ mcpServers: servers(MCP_SERVER_LIMIT) }));
    expect(context()).toEqual([]);
    const plugin = path.join(tmp, 'plug');
    write(path.join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { extra: { url: 'http://x' } } }));
    enablePlugin(plugin);
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f.title).toMatch(/MCP/);
    expect(f.detail).toContain(String(MCP_SERVER_LIMIT + 1));
  });

  it('counts project servers per project and skips projects with a missing folder', () => {
    const p = project('mcp');
    write(path.join(p, '.mcp.json'), JSON.stringify({ mcpServers: servers(MCP_SERVER_LIMIT + 1) }));
    const gone = project('gone2');
    write(path.join(gone, '.mcp.json'), JSON.stringify({ mcpServers: servers(MCP_SERVER_LIMIT + 1) }));
    fs.rmSync(gone, { recursive: true });
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f.project).toBe(p);
  });
});

describe('never-used plugins and skills', () => {
  const setup = () => {
    const plugin = path.join(tmp, 'plug');
    skill(path.join(plugin, 'skills'), 'sk', 'd');
    enablePlugin(plugin);
    skill(path.join(home, 'skills'), 'mine', 'd');
  };
  it('gives no finding when the use counts are missing', () => {
    setup();
    expect(context()).toEqual([]);
    write(claudeJsonPath, JSON.stringify({}));
    expect(context()).toEqual([]);
  });
  it('flags enabled plugins and skills with no recorded use, not used ones', () => {
    setup();
    write(claudeJsonPath, JSON.stringify({ skillUsage: { mine: { usageCount: 3 } }, pluginUsage: { 'other@m': { usageCount: 1 } } }));
    const f = context();
    const plugins = f.filter((x) => x.id.startsWith('context/unused-plugin'));
    const skills = f.filter((x) => x.id.startsWith('context/unused-skill'));
    expect(f).toHaveLength(2);
    expect(plugins[0].detail).toContain('p@m');
    expect(skills[0].detail).toContain('p:sk');
    expect(skills[0].severity).toBe('low');
  });
});
