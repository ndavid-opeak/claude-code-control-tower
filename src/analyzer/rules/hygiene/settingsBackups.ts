import fs from 'node:fs';
import path from 'node:path';
import type { Rule } from '../types.ts';

/** Leftover settings.json.bak* files in the Claude home folder. */
export const settingsBackups: Rule = ({ claudeHome }) => {
  let names: string[] = [];
  try {
    names = fs.readdirSync(claudeHome).filter((n) => n.startsWith('settings.json.bak'));
  } catch {}
  return names.sort().map((name) => {
    const file = path.join(claudeHome, name);
    return {
      id: `hygiene/settings-backup:${file}`,
      severity: 'low',
      title: `Leftover settings backup ${name}`,
      detail: 'An old copy of settings.json. Claude Code does not read it.',
      file,
      fix: `Delete ${name} once you are sure settings.json is right.`,
    };
  });
};
