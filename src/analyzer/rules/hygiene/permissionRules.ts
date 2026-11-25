import path from 'node:path';
import { listProjects } from '../../projects.ts';
import { readJson } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

type List = 'allow' | 'ask' | 'deny';
const LISTS: List[] = ['allow', 'ask', 'deny'];
const FILES = ['settings.json', 'settings.local.json'];
interface Entry {
  rule: string;
  list: List;
  file: string;
}

function entriesOf(file: string): Entry[] {
  const permissions = readJson(file)?.permissions;
  const out: Entry[] = [];
  for (const list of LISTS) {
    const rules = permissions?.[list];
    if (Array.isArray(rules)) for (const rule of rules) if (typeof rule === 'string') out.push({ rule, list, file });
  }
  return out;
}

/** Pairs of entries for the same rule that repeat or contradict each other. */
function problems(entries: Entry[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.rule !== b.rule) continue;
      if (a.list === b.list) {
        findings.push({
          id: `hygiene/permission-duplicate:${a.list}:${a.rule}:${a.file}:${b.file}`,
          severity: 'low',
          title: `Permission rule ${a.rule} is listed twice`,
          detail: `"${a.rule}" is in ${a.list} in ${a.file}${a.file === b.file ? ' more than once' : ` and again in ${b.file}`}.`,
          file: b.file,
          fix: `Remove the copy in ${b.file}.`,
        });
      } else {
        findings.push({
          id: `hygiene/permission-conflict:${a.list}:${b.list}:${a.rule}:${a.file}:${b.file}`,
          severity: 'medium',
          title: `Permission rule ${a.rule} is both ${a.list} and ${b.list}`,
          detail: `"${a.rule}" is in ${a.list} in ${a.file} and in ${b.list} in ${b.file}. Claude Code applies deny first, then ask, then allow, so the ${a.list} rule is not what you meant.`,
          file: b.file,
          fix: `Keep only the rule you mean, in ${a.file} or ${b.file}.`,
        });
      }
    }
  }
  return findings;
}

/** Duplicate and contradicting permission rules across the global and project settings that apply together. */
export const permissionRules: Rule = ({ claudeHome }) => {
  const global = FILES.flatMap((n) => entriesOf(path.join(claudeHome, n)));
  const scopes: Entry[][] = [global];
  const seen = new Set<string>();
  for (const p of listProjects(claudeHome)) {
    if (!p.exists || seen.has(p.path)) continue;
    seen.add(p.path);
    scopes.push([...global, ...FILES.flatMap((n) => entriesOf(path.join(p.path, '.claude', n)))]);
  }
  const byId = new Map<string, RuleFinding>();
  for (const scope of scopes) for (const f of problems(scope)) byId.set(f.id, f);
  return [...byId.values()];
};
