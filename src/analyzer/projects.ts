import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Shared lookups for rules that work per project: which projects Claude Code has seen, and which
// instruction files (CLAUDE.md and their @imports) a session in each one loads.

export interface Project {
  /** The project's real folder, from the `cwd` its transcripts record. */
  path: string;
  /** False when the folder has been deleted or moved. */
  exists: boolean;
  /** Its folder under ~/.claude/projects. */
  transcriptsDir: string;
}

const CWD = /"cwd":"((?:[^"\\]|\\.)*)"/;
const HEAD_BYTES = 256 * 1024;

/** Every project under ~/.claude/projects whose folder can be found from its transcripts. */
export function listProjects(claudeHome: string): Project[] {
  const root = path.join(claudeHome, 'projects');
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  const projects: Project[] = [];
  for (const name of dirs.sort()) {
    const transcriptsDir = path.join(root, name);
    const cwd = cwdFrom(transcriptsDir);
    if (cwd) projects.push({ path: cwd, exists: fs.existsSync(cwd), transcriptsDir });
  }
  return projects;
}

function cwdFrom(dir: string): string | undefined {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return undefined;
  }
  for (const f of files) {
    const m = CWD.exec(readHead(path.join(dir, f)));
    if (m) return JSON.parse(`"${m[1]}"`);
  }
  return undefined;
}

function readHead(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

export interface InstructionFile {
  file: string;
  text: string;
  /** The file whose @import pulled this one in; absent for files Claude Code loads by location. */
  importedBy?: string;
}

const MAX_IMPORT_DEPTH = 5;
const IMPORT = /(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w.\-/]+)/g;

/**
 * The instruction files a session in `projectPath` loads, in load order: the global CLAUDE.md, then
 * CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md in every folder from the filesystem root down to the
 * project, each followed by the files it @imports. Each file appears once.
 */
export function instructionChain(claudeHome: string, projectPath: string): InstructionFile[] {
  const out: InstructionFile[] = [];
  const seen = new Set<string>();
  const add = (file: string, importedBy: string | undefined, depth: number) => {
    let real: string;
    let text: string;
    try {
      real = fs.realpathSync(file);
      if (seen.has(real)) return;
      text = fs.readFileSync(real, 'utf8');
    } catch {
      return;
    }
    seen.add(real);
    out.push(importedBy ? { file, text, importedBy } : { file, text });
    if (depth >= MAX_IMPORT_DEPTH) return;
    for (const target of importsOf(text)) {
      const resolved = target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : path.resolve(path.dirname(file), target);
      add(resolved, file, depth + 1);
    }
  };

  add(path.join(claudeHome, 'CLAUDE.md'), undefined, 0);
  const parts = path.resolve(projectPath).split(path.sep);
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join(path.sep) || path.sep;
    for (const name of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md']) {
      add(path.join(dir, name), undefined, 0);
    }
  }
  return out;
}

/** @import targets outside fenced code blocks and inline code. */
function importsOf(text: string): string[] {
  const targets: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const plain = line.replace(/`[^`]*`/g, '');
    for (const m of plain.matchAll(IMPORT)) targets.push(m[1]);
  }
  return targets;
}
