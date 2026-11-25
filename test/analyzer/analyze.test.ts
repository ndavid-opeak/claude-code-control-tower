import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzer/analyze.ts';

let tmp: string;
let home: string; // fake ~/.claude
let claudeJsonPath: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-'));
  home = path.join(tmp, '.claude');
  fs.mkdirSync(home);
  claudeJsonPath = path.join(tmp, '.claude.json');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const run = (window: 7 | 30 = 30) => analyze({ claudeHome: home, claudeJsonPath, now: NOW, window });

describe('analyze', () => {
  it('scores a clean setup 100 in every category, with the window and run time', () => {
    const r = run(7);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.categories).toEqual({ usage: 100, context: 100, duplicates: 100, hygiene: 100 });
    expect(r.window).toBe(7);
    expect(r.ranAt).toBe(NOW);
  });
});

describe('settings backup files', () => {
  it('flags each leftover settings.json.bak file in the Claude home folder', () => {
    fs.writeFileSync(path.join(home, 'settings.json'), '{}');
    fs.writeFileSync(path.join(home, 'settings.json.bak-20261101'), '{}');
    const [f, ...rest] = run().findings;
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ category: 'hygiene', severity: 'low', points: 3, file: path.join(home, 'settings.json.bak-20261101') });
    expect(f.fix).toMatch(/delete/i);
    expect(run().categories.hygiene).toBe(97);
  });

  it('never takes a category below 0, and weights the headline 40/30/20/10', () => {
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(home, `settings.json.bak-${i}`), '{}');
    const r = run();
    expect(r.categories).toEqual({ usage: 100, context: 100, duplicates: 100, hygiene: 0 });
    expect(r.score).toBe(90);
  });
});

describe('hooks pointing to missing scripts', () => {
  const settingsWith = (commands: string[]) =>
    JSON.stringify(
      { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: commands.map((command) => ({ type: 'command', command })) }] } },
      null,
      2,
    );

  it('flags a hook whose script does not exist, with file and line', () => {
    const ok = path.join(tmp, 'hooks', 'ok.sh');
    fs.mkdirSync(path.dirname(ok));
    fs.writeFileSync(ok, '#!/bin/sh\n');
    const gone = path.join(tmp, 'hooks', 'gone.js');
    const settings = path.join(home, 'settings.json');
    fs.writeFileSync(settings, settingsWith([ok, 'echo hi', `node "${gone}" --quiet`]));

    const { findings } = run();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'hygiene', severity: 'medium', file: settings, line: 17 });
    expect(findings[0].detail).toContain(gone);
    expect(findings[0].fix).toBeTruthy();
  });

  it('checks settings.local.json too, and is quiet when every script exists', () => {
    const local = path.join(home, 'settings.local.json');
    fs.writeFileSync(local, settingsWith([path.join(tmp, 'nope.sh')]));
    expect(run().findings.map((f) => f.file)).toEqual([local]);

    fs.writeFileSync(path.join(tmp, 'nope.sh'), '');
    expect(run().findings).toEqual([]);
  });

  it('reads a quoted path with spaces as one script', () => {
    const dir = path.join(tmp, 'my hooks');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'ok.sh'), '#!/bin/sh\n');
    const gone = path.join(dir, 'gone.sh');
    fs.writeFileSync(path.join(home, 'settings.json'), settingsWith([`bash "${path.join(dir, 'ok.sh')}"`, `bash "${gone}" --quiet`, `node '${gone}'`]));
    const { findings } = run();
    expect(findings).toHaveLength(2);
    for (const f of findings) expect(f.detail).toContain(`runs ${gone},`);
  });

  it('lists findings worst first', () => {
    fs.writeFileSync(path.join(home, 'settings.json.bak-1'), '{}');
    fs.writeFileSync(path.join(home, 'settings.json'), settingsWith([path.join(tmp, 'nope.sh')]));
    expect(run().findings.map((f) => f.points)).toEqual([8, 3]);
  });
});
