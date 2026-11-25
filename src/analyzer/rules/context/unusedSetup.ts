import { listPlugins, listSkills, readJson } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object';
const used = (usage: Record<string, any>, key: string) => (usage[key]?.usageCount ?? 0) > 0;

/**
 * Enabled plugins and skills that ~/.claude.json records no use of. When it has no skillUsage / pluginUsage
 * (the counts are unknown) nothing is flagged.
 */
export const unusedSetup: Rule = ({ claudeHome, claudeJsonPath }) => {
  const claudeJson = readJson(claudeJsonPath);
  const pluginUsage = claudeJson?.pluginUsage;
  const skillUsage = claudeJson?.skillUsage;
  const findings: RuleFinding[] = [];
  const plugins = listPlugins(claudeHome);

  if (isObject(pluginUsage)) {
    for (const p of plugins) {
      if (!p.enabled || used(pluginUsage, p.id)) continue;
      findings.push({
        id: `context/unused-plugin:${p.id}:${p.installPath}`,
        severity: 'low',
        title: 'Enabled plugin was never used',
        detail: `${p.id} is enabled but ~/.claude.json records no use of it.`,
        file: p.installPath,
        fix: `Disable or uninstall it: claude plugin uninstall ${p.id}.`,
      });
    }
  }
  if (isObject(skillUsage)) {
    for (const s of listSkills(claudeHome, plugins)) {
      if (used(skillUsage, s.qualifiedName) || used(skillUsage, s.name)) continue;
      findings.push({
        id: `context/unused-skill:${s.file}`,
        severity: 'low',
        title: 'Skill was never used',
        detail: `The skill ${s.qualifiedName} is loaded every turn but ~/.claude.json records no use of it.`,
        file: s.file,
        fix: s.source === 'user' ? `Delete the folder of ${s.file} if you do not need it.` : `Disable the plugin ${s.source} if you do not need its skills.`,
      });
    }
  }
  return findings;
};
