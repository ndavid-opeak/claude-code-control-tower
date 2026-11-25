import path from 'node:path';
import { listSkills } from '../../setup.ts';
import type { Rule } from '../types.ts';
import { estimateTokens, SKILL_DESCRIPTION_TOKEN_LIMIT } from './limits.ts';

/** User skills plus enabled plugins' skills whose descriptions, sent every turn, add up to more than the limit. */
export const skillDescriptions: Rule = ({ claudeHome }) => {
  const skills = listSkills(claudeHome);
  const tokens = estimateTokens(skills.reduce((sum, s) => sum + s.description.length, 0));
  if (tokens <= SKILL_DESCRIPTION_TOKEN_LIMIT) return [];
  const biggest = skills.reduce((a, b) => (b.description.length > a.description.length ? b : a));
  return [
    {
      id: 'context/skill-descriptions',
      severity: 'medium',
      title: 'Skill descriptions are large',
      detail: `${skills.length} skills send ~${tokens} tokens of descriptions every turn (limit ~${SKILL_DESCRIPTION_TOKEN_LIMIT}). The largest is ${biggest.qualifiedName} (~${estimateTokens(biggest.description.length)}).`,
      file: biggest.file,
      fix: `Shorten the description in ${path.basename(path.dirname(biggest.file))}/SKILL.md, and delete skills or disable plugins you do not use.`,
      estimated: true,
    },
  ];
};
