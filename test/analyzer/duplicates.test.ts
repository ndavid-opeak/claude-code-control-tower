import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';

let tmp: string;
let home: string;
let claudeJsonPath: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dupes-'));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
  claudeJsonPath = path.join(tmp, '.claude.json');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const dupes = () => analyze({ claudeHome: home, claudeJsonPath, now: NOW, window: 30 }).findings.filter((f) => f.category === 'duplicates');

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Installs plugins at user scope, enabled, each with the given skills, commands and .mcp.json. */
function installPlugins(defs: Record<string, { skills?: string[]; commands?: string[]; mcp?: Record<string, unknown> }>) {
  const plugins: Record<string, unknown[]> = {};
  const enabled: Record<string, boolean> = {};
  for (const [id, def] of Object.entries(defs)) {
    const installPath = path.join(home, 'plugins', 'cache', id.replace('@', '-'), '1.0.0');
    for (const s of def.skills ?? []) write(path.join(installPath, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: d\n---\n`);
    for (const c of def.commands ?? []) write(path.join(installPath, 'commands', `${c}.md`), 'x');
    if (def.mcp) write(path.join(installPath, '.mcp.json'), JSON.stringify({ mcpServers: def.mcp }));
    plugins[id] = [{ scope: 'user', installPath }];
    enabled[id] = true;
  }
  write(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  write(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: enabled }));
}

/** A transcript whose deferred-tool list holds these tool names (the shape Claude Code records). */
function transcript(tools: string[], name = 's1') {
  write(
    path.join(home, 'projects', '-p', `${name}.jsonl`),
    JSON.stringify({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: tools }, cwd: '/nowhere' }) + '\n',
  );
}

const UUID = '5d7c5b19-e1d6-4c5d-891d-4d03d9908452';
const OTHER = '11111111-2222-3333-4444-555555555555';

describe('no duplicates', () => {
  it('reports nothing for a clean setup', () => {
    installPlugins({ 'a@m': { skills: ['one'], commands: ['c1'] }, 'b@m': { skills: ['two'], commands: ['c2'] } });
    write(path.join(home, 'skills', 'three', 'SKILL.md'), '---\nname: three\ndescription: d\n---\n');
    transcript([`mcp__${UUID}__slack_send_message`]);
    expect(dupes()).toEqual([]);
  });
});

describe('skill name from two sources', () => {
  it('flags a user skill that a plugin also ships, naming both and which to remove', () => {
    installPlugins({ 'anthropic-skills@m': { skills: ['changelog-writer'] } });
    const userFile = path.join(home, 'skills', 'changelog-writer', 'SKILL.md');
    write(userFile, '---\nname: changelog-writer\ndescription: d\n---\n');
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.title).toMatch(/changelog-writer/);
    expect(f.detail).toContain(userFile);
    expect(f.detail).toContain('anthropic-skills@m');
    expect(f.fix).toMatch(/keep/i);
    expect(f.fix).toMatch(/remove/i);
  });
});

describe('plugins with overlapping skills or commands', () => {
  it('flags two plugins that share a skill name, as one finding per pair', () => {
    installPlugins({ 'skill-creator@m': { skills: ['skill-creator'] }, 'anthropic-skills@m': { skills: ['skill-creator', 'pdf'] } });
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.detail).toContain('skill-creator@m');
    expect(f.detail).toContain('anthropic-skills@m');
    expect(f.detail).toContain('skill-creator');
    expect(f.fix).toMatch(/keep anthropic-skills@m/i);
  });

  it('flags two plugins that share a command name', () => {
    installPlugins({ 'a@m': { commands: ['commit'] }, 'b@m': { commands: ['commit', 'push'] } });
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.detail).toContain('/commit');
  });
});

describe('same service connected twice', () => {
  it('flags a claude.ai connector that duplicates a plugin server, found by tool-name overlap', () => {
    installPlugins({ 'slack@m': { mcp: { slack: { type: 'http', url: 'https://mcp.slack.com/mcp' } } } });
    transcript([`mcp__${UUID}__slack_send_message`, `mcp__${UUID}__slack_read_channel`, 'mcp__plugin_slack_slack__slack_send_message']);
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.title).toMatch(/slack/i);
    expect(f.detail).toContain('slack@m');
    expect(f.detail).toContain(`claude.ai connector ${UUID}`);
    expect(f.fix).toMatch(/keep/i);
    expect(f.fix).toMatch(/remove/i);
  });

  it('flags a plugin server and an mcpServers entry that share a URL, without any transcript', () => {
    installPlugins({ 'atl@m': { mcp: { atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' } } } });
    write(claudeJsonPath, JSON.stringify({ mcpServers: { jira: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' } } }));
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.detail).toContain('atl@m');
    expect(f.detail).toContain('~/.claude.json');
  });

  it('flags two connectors that expose the same tools', () => {
    transcript([`mcp__${UUID}__slack_send_message`, `mcp__${OTHER}__slack_send_message`]);
    expect(dupes()).toHaveLength(1);
  });

  it('does not flag connectors for different services', () => {
    transcript([`mcp__${UUID}__slack_send_message`, `mcp__${OTHER}__createJiraIssue`]);
    expect(dupes()).toEqual([]);
  });
});

describe('identical lines across instruction layers', () => {
  const projectWith = () => {
    const project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    write(path.join(home, 'projects', '-proj', 's.jsonl'), JSON.stringify({ type: 'user', cwd: project }) + '\n');
    return project;
  };

  it('names both files for a line repeated in the global and project CLAUDE.md', () => {
    const project = projectWith();
    const line = 'Always run the full test suite before committing any change.';
    write(path.join(home, 'CLAUDE.md'), `# Global\n${line}\nOnly in global, nothing to see here.\n`);
    write(path.join(project, 'CLAUDE.md'), `# Project\n${line}\n`);
    const [f, ...rest] = dupes();
    expect(rest).toEqual([]);
    expect(f.detail).toContain(path.join(home, 'CLAUDE.md'));
    expect(f.detail).toContain(path.join(project, 'CLAUDE.md'));
    expect(f.detail).toContain(line);
    expect(f.file).toBe(path.join(project, 'CLAUDE.md'));
    expect(f.line).toBe(2);
    expect(f.fix).toMatch(/remove/i);
  });

  it('ignores short lines like headings and separators', () => {
    const project = projectWith();
    write(path.join(home, 'CLAUDE.md'), '# Rules\n---\n');
    write(path.join(project, 'CLAUDE.md'), '# Rules\n---\n');
    expect(dupes()).toEqual([]);
  });
});
