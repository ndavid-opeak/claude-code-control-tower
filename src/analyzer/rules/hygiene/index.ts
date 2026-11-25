import type { Rule } from '../types.ts';
import { missingHookScripts } from './missingHookScripts.ts';
import { settingsBackups } from './settingsBackups.ts';

export const hygieneRules: Rule[] = [
  settingsBackups,
  missingHookScripts,
];
