import path from 'node:path';
import { listPlugins } from '../../setup.ts';
import type { Rule } from '../types.ts';

/** Plugins that are installed but not turned on in the settings file of their scope. */
export const disabledPlugins: Rule = ({ claudeHome }) =>
  listPlugins(claudeHome)
    .filter((p) => !p.enabled)
    .map((p) => {
      const settingsName = p.scope === 'local' ? 'settings.local.json' : 'settings.json';
      const file = p.scope === 'user' || !p.projectPath ? path.join(claudeHome, settingsName) : path.join(p.projectPath, '.claude', settingsName);
      return {
        id: `hygiene/plugin-disabled:${p.scope}:${p.projectPath ?? ''}:${p.id}`,
        severity: 'low' as const,
        title: `Plugin ${p.id} is installed but turned off`,
        detail: `${p.id} (${p.scope} scope) is installed but not enabled in ${file}, so its skills, hooks and MCP servers are not loaded.`,
        file,
        fix: 'Enable it with `/plugin`, or uninstall it if you no longer use it.',
      };
    });
