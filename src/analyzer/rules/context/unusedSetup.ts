import { listPlugins, listSkills, readJson, type Skill } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';
import { estimateTokens, UNUSED_MEDIUM_TOKEN_LIMIT } from './limits.ts';

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object';
const used = (usage: Record<string, any>, key: string) => (usage[key]?.usageCount ?? 0) > 0;
const tokensOf = (skills: Skill[]) => estimateTokens(skills.reduce((sum, s) => sum + s.description.length, 0));
/** The more description text unused skills carry, the more context they waste every turn. */
const severityFor = (tokens: number) => (tokens >= UNUSED_MEDIUM_TOKEN_LIMIT ? ('medium' as const) : ('low' as const));
const names = (skills: Skill[]) => {
  const list = skills.slice(0, 8).map((s) => s.name).join(', ');
  return skills.length > 8 ? `${list} and ${skills.length - 8} more` : list;
};

/**
 * Enabled plugins and skills that ~/.claude.json records no use of, one finding per plugin and one for user
 * skills. When it has no skillUsage / pluginUsage (the counts are unknown) nothing is flagged.
 */
export const unusedSetup: Rule = ({ claudeHome, claudeJsonPath }) => {
  const claudeJson = readJson(claudeJsonPath);
  const pluginUsage = claudeJson?.pluginUsage;
  const skillUsage = claudeJson?.skillUsage;
  const findings: RuleFinding[] = [];
  const plugins = listPlugins(claudeHome);
  const skills = listSkills(claudeHome, plugins);
  const skillUsed = (s: Skill) => isObject(skillUsage) && (used(skillUsage, s.qualifiedName) || used(skillUsage, s.name));

  if (isObject(skillUsage)) {
    const unused = skills.filter((s) => s.source === 'user' && !skillUsed(s));
    if (unused.length > 0) {
      const tokens = tokensOf(unused);
      findings.push({
        id: 'context/unused-user-skills',
        severity: severityFor(tokens),
        title: `${unused.length} of your skills were never used`,
        detail: `~/.claude.json records no use of: ${names(unused)}. Their descriptions cost ~${tokens} tokens every turn.`,
        file: unused[0].file,
        fix: 'Delete the skill folders in ~/.claude/skills that you do not need.',
        estimated: true,
      });
    }
  }

  for (const p of plugins) {
    if (!p.enabled) continue;
    const own = skills.filter((s) => s.source === p.id);
    const pluginUsed = isObject(pluginUsage) && used(pluginUsage, p.id);
    const anySkillUsed = own.some(skillUsed);
    if (isObject(pluginUsage) && !pluginUsed && !anySkillUsed) {
      const tokens = tokensOf(own);
      findings.push({
        id: `context/unused-plugin:${p.id}:${p.installPath}`,
        severity: severityFor(tokens),
        title: `Plugin ${p.id} was never used`,
        detail: `${p.id} is enabled but ~/.claude.json records no use of it or its ${own.length} skills (~${tokens} tokens of descriptions every turn).`,
        file: p.installPath,
        fix: `Disable or uninstall it: claude plugin uninstall ${p.id}.`,
        estimated: true,
      });
    } else if (isObject(skillUsage)) {
      const unused = own.filter((s) => !skillUsed(s));
      if (unused.length === 0) continue;
      const tokens = tokensOf(unused);
      findings.push({
        id: `context/unused-plugin-skills:${p.id}:${p.installPath}`,
        severity: severityFor(tokens),
        title: `${unused.length} skills of plugin ${p.id} were never used`,
        detail: `~/.claude.json records no use of: ${names(unused)}. Their descriptions cost ~${tokens} tokens every turn.`,
        file: p.installPath,
        fix: `If you only need a few of them, uninstall ${p.id} and copy those into ~/.claude/skills; otherwise disable the plugin.`,
        estimated: true,
      });
    }
  }
  return findings;
};
