import path from 'node:path';
import { listProjects } from '../../projects.ts';
import { listPlugins, readJson } from '../../setup.ts';
import type { Rule } from '../types.ts';

/** Plugins that are installed but not turned on in the settings file of their scope. */
export const disabledPlugins: Rule = ({ claudeHome }) => {
  const projects = listProjects(claudeHome).filter((p) => p.exists);
  // A user-scope plugin kept off globally but turned on in a project's settings is in use there.
  const enabledByProject = (id: string) =>
    projects.some((p) =>
      ['settings.json', 'settings.local.json'].some((f) => readJson(path.join(p.path, '.claude', f))?.enabledPlugins?.[id] === true),
    );
  return listPlugins(claudeHome)
    .filter((p) => !p.enabled && !(p.scope === 'user' && enabledByProject(p.id)))
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
};
