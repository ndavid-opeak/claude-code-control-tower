import { instructionChain } from '../../projects.ts';
import { listProjects } from '../../projects.ts';
import type { Rule, RuleFinding } from '../types.ts';

const MIN_LENGTH = 25;
const SHOWN = 3;

/** Identical substantial lines in two instruction files that load into the same project. */
export const repeatedInstructionLines: Rule = ({ claudeHome }) => {
  const found = new Map<string, RuleFinding>();
  for (const project of listProjects(claudeHome)) {
    if (!project.exists) continue;
    const chain = instructionChain(claudeHome, project.path);
    const seen = new Map<string, { file: string; line: number }>();
    const pairs = new Map<string, { a: string; b: string; bLine: number; lines: string[] }>();
    for (const { file, text } of chain) {
      let fenced = false;
      const inFile = new Set<string>();
      text.split('\n').forEach((raw, idx) => {
        const line = raw.trim();
        if (line.startsWith('```')) fenced = !fenced;
        if (fenced || line.length < MIN_LENGTH || !/[a-z]/i.test(line) || inFile.has(line)) return;
        inFile.add(line);
        const first = seen.get(line);
        if (!first) {
          seen.set(line, { file, line: idx + 1 });
          return;
        }
        const key = `${first.file}\0${file}`;
        const p = pairs.get(key) ?? { a: first.file, b: file, bLine: idx + 1, lines: [] };
        p.lines.push(line);
        pairs.set(key, p);
      });
    }
    for (const p of pairs.values()) {
      const id = `duplicates/repeated-lines:${p.a}:${p.b}`;
      if (found.has(id)) continue;
      const shown = p.lines.slice(0, SHOWN).map((l) => `"${l}"`).join('; ');
      found.set(id, {
        id,
        severity: 'low',
        title: `${p.lines.length} line${p.lines.length === 1 ? '' : 's'} repeated across instruction files`,
        detail: `${p.a} and ${p.b} both contain: ${shown}${p.lines.length > SHOWN ? `; and ${p.lines.length - SHOWN} more` : ''}. Both load into every session in ${project.path}.`,
        project: project.path,
        file: p.b,
        line: p.bLine,
        fix: `Keep the lines in ${p.a}, which is more general, and remove them from ${p.b}.`,
      });
    }
  }
  return [...found.values()];
};
