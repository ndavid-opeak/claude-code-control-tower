import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';

let tmp: string;
let home: string; // fake ~/.claude
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-hygiene-')));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const run = () => analyze({ claudeHome: home, claudeJsonPath: path.join(tmp, '.claude.json'), now: NOW, window: 30 });
const write = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};
const only = (prefix: string) => run().findings.filter((f) => f.id.startsWith(prefix));

/** A project whose transcripts record its folder as the cwd. */
const project = (name: string) => {
  const dir = path.join(tmp, 'work', name);
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(home, 'projects', `-${name}`, 's.jsonl'), JSON.stringify({ type: 'user', cwd: dir }) + '\n');
  return dir;
};

describe('plugins installed but turned off', () => {
  const install = (entries: Record<string, unknown[]>) =>
    write(path.join(home, 'plugins', 'installed_plugins.json'), { version: 2, plugins: entries });

  it('flags a user plugin that is not enabled, naming settings.json and the fix', () => {
    install({ 'slack@dir': [{ scope: 'user', installPath: path.join(tmp, 'p') }], 'ok@dir': [{ scope: 'user', installPath: path.join(tmp, 'q') }] });
    write(path.join(home, 'settings.json'), { enabledPlugins: { 'slack@dir': false, 'ok@dir': true } });
    const f = only('hygiene/plugin-disabled');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ category: 'hygiene', file: path.join(home, 'settings.json') });
    expect(f[0].title).toContain('slack@dir');
    expect(f[0].fix).toMatch(/enable|uninstall/i);
  });

  it('points a project-scope plugin at that project’s settings file', () => {
    const proj = project('app');
    install({ 'x@dir': [{ scope: 'project', projectPath: proj, installPath: path.join(tmp, 'p') }] });
    expect(only('hygiene/plugin-disabled').map((x) => x.file)).toEqual([path.join(proj, '.claude', 'settings.json')]);
  });

  it('reads user-scope enabled state from settings.local.json too, which wins over settings.json', () => {
    install({ 'a@dir': [{ scope: 'user', installPath: path.join(tmp, 'p') }], 'b@dir': [{ scope: 'user', installPath: path.join(tmp, 'q') }] });
    write(path.join(home, 'settings.json'), { enabledPlugins: { 'a@dir': false, 'b@dir': true } });
    write(path.join(home, 'settings.local.json'), { enabledPlugins: { 'a@dir': true, 'b@dir': false } });
    expect(only('hygiene/plugin-disabled').map((x) => x.title)).toEqual(['Plugin b@dir is installed but turned off']);
  });

  it('does not report a user plugin as turned off when a project enables it', () => {
    const proj = project('app');
    const other = project('other');
    install({ 'a@dir': [{ scope: 'user', installPath: path.join(tmp, 'p') }], 'b@dir': [{ scope: 'user', installPath: path.join(tmp, 'q') }] });
    write(path.join(home, 'settings.json'), { enabledPlugins: { 'a@dir': false, 'b@dir': false } });
    write(path.join(proj, '.claude', 'settings.json'), { enabledPlugins: { 'a@dir': true } });
    write(path.join(other, '.claude', 'settings.local.json'), { enabledPlugins: { 'b@dir': true } });
    expect(only('hygiene/plugin-disabled')).toEqual([]);
  });

  it('is quiet when every plugin is enabled or none are installed', () => {
    expect(only('hygiene/plugin-disabled')).toEqual([]);
    install({ 'ok@dir': [{ scope: 'user', installPath: path.join(tmp, 'q') }] });
    write(path.join(home, 'settings.json'), { enabledPlugins: { 'ok@dir': true } });
    expect(only('hygiene/plugin-disabled')).toEqual([]);
  });
});

describe('permission rules', () => {
  it('flags the same rule listed twice across global and project settings, naming both files', () => {
    const proj = project('app');
    const g = path.join(home, 'settings.json');
    const p = path.join(proj, '.claude', 'settings.json');
    write(g, { permissions: { allow: ['Bash(npm test:*)', 'Read'] } });
    write(p, { permissions: { allow: ['Bash(npm test:*)'] } });
    const f = only('hygiene/permission-duplicate');
    expect(f).toHaveLength(1);
    for (const s of [g, p, 'Bash(npm test:*)']) expect(f[0].detail).toContain(s);
    expect(f[0].fix).toBeTruthy();
  });

  it('flags a rule allowed in one file and denied in another, naming both rules and files', () => {
    const proj = project('app');
    const g = path.join(home, 'settings.json');
    const l = path.join(proj, '.claude', 'settings.local.json');
    write(g, { permissions: { allow: ['Bash(git push:*)'] } });
    write(l, { permissions: { deny: ['Bash(git push:*)'] } });
    const f = only('hygiene/permission-conflict');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('medium');
    for (const s of [g, l, 'allow', 'deny', 'Bash(git push:*)']) expect(f[0].detail).toContain(s);
  });

  it('does not compare rules between two unrelated projects, and is quiet when clean', () => {
    const a = project('a');
    const b = project('b');
    write(path.join(a, '.claude', 'settings.json'), { permissions: { allow: ['Read'] } });
    write(path.join(b, '.claude', 'settings.json'), { permissions: { deny: ['Read'] } });
    write(path.join(home, 'settings.json'), { permissions: { allow: ['Bash(ls:*)'] } });
    expect(run().findings).toEqual([]);
  });
});

describe('MCP servers waiting for sign-in', () => {
  it('flags each server listed in mcp-needs-auth-cache.json, and is quiet without the file', () => {
    expect(only('hygiene/mcp-needs-auth')).toEqual([]);
    const file = path.join(home, 'mcp-needs-auth-cache.json');
    write(file, { 'plugin:figma:figma': { timestamp: 1 }, linear: { timestamp: 2 } });
    const f = only('hygiene/mcp-needs-auth');
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.title).join(' ')).toContain('plugin:figma:figma');
    expect(f[0]).toMatchObject({ category: 'hygiene', file });
    expect(f[0].fix).toMatch(/\/mcp/);
  });
});
