import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Rule, RuleFinding } from '../types.ts';

/** Commands that run the script named after them, e.g. `node ~/.claude/hooks/x.js`. */
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'node', 'python', 'python3', 'bun', 'deno', 'tsx', 'ruby', 'perl']);

/** Splits a command into words, keeping a quoted stretch ("/my dir/x.sh") together and dropping its quotes. */
function words(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/(?:"([^"]*)"|'([^']*)'|\S)+/g)) {
    out.push(m[0].replace(/"([^"]*)"|'([^']*)'/g, (_, d, q) => d ?? q));
  }
  return out;
}

/** The script a hook command runs, when it names one by absolute or home-relative path. */
function scriptOf(command: string): string | undefined {
  const parts = words(command);
  let i = 0;
  if (INTERPRETERS.has(path.basename(parts[0] ?? ''))) {
    i = 1;
    while (parts[i]?.startsWith('-')) i++;
  }
  const word = parts[i]?.replace(/^(~|\$HOME|\$\{HOME\})(?=\/)/, os.homedir());
  return word?.startsWith('/') ? word : undefined;
}

function commandsOf(settings: any): string[] {
  const out: string[] = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) for (const h of g?.hooks ?? []) if (typeof h?.command === 'string') out.push(h.command);
  }
  return out;
}

/** Hooks in the global settings files that run a script which does not exist. */
export const missingHookScripts: Rule = ({ claudeHome }) => {
  const findings: RuleFinding[] = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(claudeHome, name);
    let text: string;
    let settings: unknown;
    try {
      text = fs.readFileSync(file, 'utf8');
      settings = JSON.parse(text);
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (const command of commandsOf(settings)) {
      const script = scriptOf(command);
      if (!script || fs.existsSync(script)) continue;
      const at = lines.findIndex((l) => l.includes(JSON.stringify(command)));
      findings.push({
        id: `hygiene/missing-hook-script:${file}:${command}`,
        severity: 'medium',
        title: 'Hook runs a script that does not exist',
        detail: `The hook command "${command}" runs ${script}, which is missing, so the hook fails every time it fires.`,
        file,
        line: at === -1 ? undefined : at + 1,
        fix: `Restore ${script}, or remove this hook from ${name}.`,
      });
    }
  }
  return findings;
};
