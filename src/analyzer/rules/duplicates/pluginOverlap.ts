import fs from 'node:fs';
import path from 'node:path';
import { listPlugins, listSkills, listSyncedSkills, SYNCED_SKILLS_ID } from '../../setup.ts';
import type { Rule, RuleFinding } from '../types.ts';

function commandsIn(installPath: string): string[] {
  try {
    return fs.readdirSync(path.join(installPath, 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

/** Pairs of enabled plugins that ship a skill or a command with the same name. */
export const pluginOverlap: Rule = ({ claudeHome }) => {
  const plugins = listPlugins(claudeHome).filter((p) => p.enabled);
  const skills = [...listSkills(claudeHome, plugins), ...listSyncedSkills(claudeHome)];
  const items = new Map<string, { skills: Set<string>; commands: Set<string> }>();
  for (const p of plugins) {
    const e = items.get(p.id) ?? { skills: new Set<string>(), commands: new Set<string>() };
    for (const s of skills) if (s.source === p.id) e.skills.add(s.name);
    for (const c of commandsIn(p.installPath)) e.commands.add(c);
    items.set(p.id, e);
  }
  // Skills synced from claude.ai behave like one more plugin, "anthropic-skills".
  for (const s of skills) {
    if (s.source !== SYNCED_SKILLS_ID) continue;
    const e = items.get(s.source) ?? { skills: new Set<string>(), commands: new Set<string>() };
    e.skills.add(s.name);
    items.set(s.source, e);
  }
  const ids = [...items.keys()].sort();
  const size = (id: string) => items.get(id)!.skills.size + items.get(id)!.commands.size;
  const findings: RuleFinding[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [items.get(ids[i])!, items.get(ids[j])!];
      const sharedSkills = [...a.skills].filter((s) => b.skills.has(s));
      const sharedCommands = [...a.commands].filter((c) => b.commands.has(c));
      if (!sharedSkills.length && !sharedCommands.length) continue;
      const [keep, drop] = size(ids[j]) > size(ids[i]) ? [ids[j], ids[i]] : [ids[i], ids[j]];
      const shared = [...sharedSkills.map((s) => `skill ${s}`), ...sharedCommands.map((c) => `command /${c}`)];
      findings.push({
        id: `duplicates/plugin-overlap:${ids[i]}:${ids[j]}`,
        severity: 'medium',
        title: `Plugins ${ids[i]} and ${ids[j]} overlap`,
        detail: `${ids[i]} and ${ids[j]} both ship: ${shared.join(', ')}.`,
        fix: `Keep ${keep}, which ships more, and remove or disable ${drop}.`,
      });
    }
  }
  return findings;
};
