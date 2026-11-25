import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { frontmatter, listPlugins, listSkills, pluginMcpServers } from '../../src/analyzer/setup.ts';

let tmp: string;
let home: string; // fake ~/.claude
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-setup-'));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skill = (dir: string, name: string, description: string) =>
  write(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody`);

function setup() {
  const slack = path.join(tmp, 'cache', 'slack');
  const old = path.join(tmp, 'cache', 'old');
  const proj = path.join(tmp, 'proj');
  const karpathy = path.join(tmp, 'cache', 'karpathy');
  write(
    path.join(home, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'slack@dir': [{ scope: 'user', installPath: slack }],
        'old@dir': [{ scope: 'user', installPath: old }],
        'karpathy@k': [{ scope: 'local', projectPath: proj, installPath: karpathy }],
      },
    }),
  );
  write(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'slack@dir': true, 'old@dir': false } }));
  write(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'karpathy@k': true } }));
  skill(path.join(slack, 'skills'), 'block-kit', "'Build Block Kit, it''s quoted'");
  skill(path.join(old, 'skills'), 'unused', 'never listed');
  skill(path.join(home, 'skills'), 'changelog-writer', 'Write a changelog');
  write(path.join(slack, '.mcp.json'), JSON.stringify({ mcpServers: { slack: { type: 'http', url: 'https://mcp.slack.com/mcp' } } }));
  return { slack, old, proj, karpathy };
}

describe('listPlugins', () => {
  it('lists every install with its scope and whether its settings file turns it on', () => {
    const { slack, old, proj, karpathy } = setup();
    expect(listPlugins(home)).toEqual([
      { id: 'slack@dir', name: 'slack', marketplace: 'dir', scope: 'user', installPath: slack, enabled: true },
      { id: 'old@dir', name: 'old', marketplace: 'dir', scope: 'user', installPath: old, enabled: false },
      { id: 'karpathy@k', name: 'karpathy', marketplace: 'k', scope: 'local', projectPath: proj, installPath: karpathy, enabled: true },
    ]);
  });

  it('returns nothing without installed_plugins.json', () => {
    expect(listPlugins(home)).toEqual([]);
  });
});

describe('listSkills', () => {
  it('lists user skills and enabled plugins’ skills, with the name Claude Code shows', () => {
    const { slack } = setup();
    expect(listSkills(home)).toEqual([
      { name: 'changelog-writer', qualifiedName: 'changelog-writer', description: 'Write a changelog', file: path.join(home, 'skills', 'changelog-writer', 'SKILL.md'), source: 'user' },
      { name: 'block-kit', qualifiedName: 'slack:block-kit', description: "Build Block Kit, it's quoted", file: path.join(slack, 'skills', 'block-kit', 'SKILL.md'), source: 'slack@dir' },
    ]);
  });
});

describe('pluginMcpServers', () => {
  it('reads the servers a plugin ships', () => {
    setup();
    const slack = listPlugins(home)[0];
    expect(pluginMcpServers(slack)).toEqual([{ name: 'slack', target: 'https://mcp.slack.com/mcp' }]);
  });
});

describe('frontmatter', () => {
  it('joins folded multi-line values', () => {
    expect(frontmatter('---\nname: x\ndescription: >\n  first line\n  second line\n---\n')).toEqual({ name: 'x', description: 'first line second line' });
  });
});
