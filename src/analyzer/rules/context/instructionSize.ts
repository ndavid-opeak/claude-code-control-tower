import { instructionChain, listProjects } from '../../projects.ts';
import type { Rule, RuleFinding } from '../types.ts';
import { estimateTokens, INSTRUCTION_TOKEN_LIMIT } from './limits.ts';

/** Projects whose CLAUDE.md/AGENTS.md chain (global, parent folders, project, @imports) is bigger than the limit. */
export const instructionSize: Rule = ({ claudeHome }) => {
  const findings: RuleFinding[] = [];
  for (const project of listProjects(claudeHome)) {
    if (!project.exists) continue;
    const chain = instructionChain(claudeHome, project.path);
    if (chain.length === 0) continue;
    const tokens = estimateTokens(chain.reduce((sum, f) => sum + f.text.length, 0));
    if (tokens <= INSTRUCTION_TOKEN_LIMIT) continue;
    const biggest = chain.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    findings.push({
      id: `context/instruction-size:${project.path}`,
      severity: 'medium',
      title: 'Instruction files are large',
      detail: `A session in ${project.path} loads ~${tokens} tokens of CLAUDE.md/AGENTS.md (limit ~${INSTRUCTION_TOKEN_LIMIT}) before you type anything. The biggest file is ${biggest.file} (~${estimateTokens(biggest.text.length)}).`,
      project: project.path,
      file: biggest.file,
      fix: `Trim ${biggest.file}, or move rarely needed sections into docs that it links to rather than @imports.`,
      estimated: true,
    });
  }
  return findings;
};
