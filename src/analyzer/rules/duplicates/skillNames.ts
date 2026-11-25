import { listSkills, listSyncedSkills } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

/** A user skill whose name is also used by a plugin skill (plugin-vs-plugin overlap is in pluginOverlap). */
export const duplicateSkillNames: Rule = ({ claudeHome }) => {
  const byName = new Map<string, ReturnType<typeof listSkills>>();
  for (const s of [...listSkills(claudeHome), ...listSyncedSkills(claudeHome)]) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  const findings: RuleFinding[] = [];
  for (const [name, skills] of byName) {
    const user = skills.find((s) => s.source === 'user');
    const plugins = skills.filter((s) => s.source !== 'user');
    if (!user || plugins.length === 0) continue;
    findings.push({
      id: `duplicates/skill-name:${name}`,
      severity: 'low',
      title: `Skill "${name}" exists in more than one place`,
      detail: `The skill "${name}" is defined by your user skill ${user.file} and by ${plugins.map((p) => `${p.source} (${p.file})`).join(', ')}.`,
      file: user.file,
      fix: `Keep the plugin's version and remove ${user.file}, unless you customized it, in which case keep it and disable ${plugins.map((p) => p.source).join(', ')}.`,
    });
  }
  return findings;
};
