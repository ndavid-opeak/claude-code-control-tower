import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';
import { INSTRUCTION_TOKEN_LIMIT, MCP_SERVER_LIMIT, SKILL_DESCRIPTION_TOKEN_LIMIT, UNUSED_MEDIUM_TOKEN_LIMIT } from '../../src/analyzer/rules/context/limits.ts';

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

describe('skills synced from claude.ai', () => {
  const synced = (name: string, description: string, bucket = 'b1') => skill(path.join(home, 'skills', 'synced', bucket), name, description);
  it('counts their descriptions once per name, even when several accounts hold them', () => {
    synced('pdf', 'x'.repeat(SKILL_DESCRIPTION_TOKEN_LIMIT * 4));
    synced('pdf', 'x'.repeat(SKILL_DESCRIPTION_TOKEN_LIMIT * 4), 'b2');
    expect(context()).toEqual([]);
    synced('docx', 'y'.repeat(8));
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f.detail).toContain('anthropic-skills:pdf');
    expect(f.detail).toContain('2 skills');
  });
  it('flags the ones never used, told apart by their anthropic-skills: name', () => {
    synced('pdf', 'd');
    synced('docx', 'd');
    write(claudeJsonPath, JSON.stringify({ skillUsage: { 'anthropic-skills:pdf': { usageCount: 2 } } }));
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
    expect(f.detail).toContain('docx');
    expect(f.detail).not.toContain('pdf');
    expect(f.fix).toMatch(/claude\.ai/);
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

  it('counts claude.ai connectors seen in transcripts, once each however many tools they expose', () => {
    write(claudeJsonPath, JSON.stringify({ mcpServers: servers(MCP_SERVER_LIMIT) }));
    const uuid = '5d7c5b19-e1d6-4c5d-891d-4d03d9908452';
    write(
      path.join(home, 'projects', '-p', 's.jsonl'),
      JSON.stringify({ type: 'attachment', attachment: { addedNames: [`mcp__${uuid}__a`, `mcp__${uuid}__b`, 'mcp__plugin_x_y__z'] } }) + '\n',
    );
    const [f, ...rest] = context();
    expect(rest).toEqual([]);
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
    expect(f).toHaveLength(1);
    expect(f[0].id).toContain('unused-plugin:p@m');
    expect(f[0].title).toContain('never used');
    expect(f[0].severity).toBe('low');
  });
  it('lists the unused skills of a used plugin in one finding, and user skills in another', () => {
    setup();
    skill(path.join(home, 'skills'), 'mine2', 'd');
    write(claudeJsonPath, JSON.stringify({ skillUsage: { mine: { usageCount: 3 } }, pluginUsage: { 'p@m': { usageCount: 1 } } }));
    const f = context();
    expect(f).toHaveLength(2);
    expect(f.find((x) => x.id.startsWith('context/unused-plugin-skills'))?.detail).toContain('sk');
    expect(f.find((x) => x.id === 'context/unused-user-skills')?.detail).toContain('mine2');
  });
  it('does not flag an enabled plugin that ships no skills and no MCP servers (LSP, hook-only plugins)', () => {
    const lsp = path.join(tmp, 'lsp');
    write(path.join(lsp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'pyright-lsp' }));
    enablePlugin(lsp);
    write(claudeJsonPath, JSON.stringify({ pluginUsage: { 'other@m': { usageCount: 1 } } }));
    expect(context()).toEqual([]);
    write(path.join(lsp, '.mcp.json'), JSON.stringify({ mcpServers: { x: { url: 'http://x' } } }));
    expect(context().map((f) => f.id)).toEqual([`context/unused-plugin:p@m:${lsp}`]);
  });
  it('raises severity with the description text the unused skills carry', () => {
    skill(path.join(home, 'skills'), 'wordy', 'x'.repeat(UNUSED_MEDIUM_TOKEN_LIMIT * 4));
    write(claudeJsonPath, JSON.stringify({ skillUsage: { other: { usageCount: 1 } } }));
    expect(context()[0].severity).toBe('medium');
  });
});
