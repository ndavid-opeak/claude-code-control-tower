import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instructionChain, listProjects } from '../../src/analyzer/projects.ts';

let tmp: string;
let home: string; // fake ~/.claude
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-projects-')));
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
const transcript = (slug: string, cwd: string) =>
  write(
    path.join(home, 'projects', slug, 's1.jsonl'),
    [JSON.stringify({ type: 'summary' }), JSON.stringify({ type: 'user', cwd, message: { content: 'hi' } })].join('\n') + '\n',
  );

describe('listProjects', () => {
  it('finds each project folder from the cwd its transcripts record, and whether it still exists', () => {
    const live = path.join(tmp, 'work', 'my.app');
    fs.mkdirSync(live, { recursive: true });
    transcript('-work-my-app', live);
    transcript('-gone', path.join(tmp, 'gone'));
    fs.mkdirSync(path.join(home, 'projects', '-empty'));

    expect(listProjects(home)).toEqual([
      { path: path.join(tmp, 'gone'), exists: false, transcriptsDir: path.join(home, 'projects', '-gone') },
      { path: live, exists: true, transcriptsDir: path.join(home, 'projects', '-work-my-app') },
    ]);
  });

  it('returns nothing when there is no projects folder', () => {
    expect(listProjects(home)).toEqual([]);
  });
});

describe('instructionChain', () => {
  it('lists global, ancestor and project files in load order, each followed by its imports', () => {
    const ws = path.join(tmp, 'ws');
    const proj = path.join(ws, 'app');
    write(path.join(home, 'CLAUDE.md'), 'global');
    write(path.join(ws, 'CLAUDE.md'), 'See @AGENTS.md for rules.');
    write(path.join(ws, 'AGENTS.md'), 'agents, and @docs/more.md');
    write(path.join(ws, 'docs', 'more.md'), 'more');
    write(path.join(proj, '.claude', 'CLAUDE.md'), 'project');
    write(path.join(proj, 'CLAUDE.local.md'), 'local');

    const chain = instructionChain(home, proj);
    expect(chain.map((f) => [path.relative(tmp, f.file), f.importedBy && path.relative(tmp, f.importedBy)])).toEqual([
      ['.claude/CLAUDE.md', undefined],
      ['ws/CLAUDE.md', undefined],
      ['ws/AGENTS.md', 'ws/CLAUDE.md'],
      ['ws/docs/more.md', 'ws/AGENTS.md'],
      ['ws/app/.claude/CLAUDE.md', undefined],
      ['ws/app/CLAUDE.local.md', undefined],
    ]);
    expect(chain[0].text).toBe('global');
  });

  it('ignores @mentions in code, missing targets and repeat imports', () => {
    const proj = path.join(tmp, 'p');
    write(path.join(proj, 'CLAUDE.md'), 'Use `@types/node`.\n```\n@inside.md\n```\n@missing.md @a.md @a.md');
    write(path.join(proj, 'a.md'), 'back to @CLAUDE.md');
    write(path.join(proj, 'inside.md'), 'x');

    expect(instructionChain(home, proj).map((f) => path.basename(f.file))).toEqual(['CLAUDE.md', 'a.md']);
  });
});
