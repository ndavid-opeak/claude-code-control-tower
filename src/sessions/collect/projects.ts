import fs from 'node:fs';
import path from 'node:path';

export interface TableDir {
  id: string;
  name: string;
  path: string;
}

export const ELSEWHERE: TableDir = { id: 'elsewhere', name: 'Elsewhere', path: '' };

/** One table per folder directly under the projects root, in a stable alphabetical order. */
export function listTables(root: string): TableDir[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ id: e.name, name: e.name, path: path.join(root, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** The table whose folder contains cwd; sessions outside the root share the Elsewhere table. */
export function tableFor(cwd: string, tables: TableDir[]): TableDir {
  return tables.find((t) => cwd === t.path || cwd.startsWith(t.path + path.sep)) ?? ELSEWHERE;
}
