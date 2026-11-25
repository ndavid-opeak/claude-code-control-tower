import type { Rule } from '../types.ts';
import { disabledPlugins } from './disabledPlugins.ts';
import { mcpNeedsAuth } from './mcpNeedsAuth.ts';
import { missingHookScripts } from './missingHookScripts.ts';
import { permissionRules } from './permissionRules.ts';
import { settingsBackups } from './settingsBackups.ts';

export const hygieneRules: Rule[] = [
  settingsBackups,
  missingHookScripts,
  disabledPlugins,
  permissionRules,
  mcpNeedsAuth,
];
