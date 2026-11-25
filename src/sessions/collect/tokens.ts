import fs from 'node:fs';

interface Tally {
  offset: number;
  seen: Set<string>;
  tokens: number;
}

const tallies = new Map<string, Tally>();

/**
 * Tokens a transcript has used so far: input, output and cache writes (cache reads are left out, as in the
 * usage breakdown). Each reply is counted once however many rows repeat it, and only new bytes are read
 * on later calls.
 */
export function tokensUsed(file: string): number | undefined {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return tallies.get(file)?.tokens;
  }
  let tally = tallies.get(file);
  if (!tally || size < tally.offset) {
    tally = { offset: 0, seen: new Set(), tokens: 0 };
    tallies.set(file, tally);
  }
  if (size === tally.offset) return tally.tokens;

  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - tally.offset);
    fs.readSync(fd, buf, 0, buf.length, tally.offset);
    const lastNewline = buf.lastIndexOf(10);
    if (lastNewline === -1) return tally.tokens; // only part of a row so far
    for (const line of buf.subarray(0, lastNewline).toString('utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      let row: any;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = row.message;
      if (row.type !== 'assistant' || !msg?.usage || !msg.id || msg.model === '<synthetic>') continue;
      if (tally.seen.has(msg.id)) continue;
      tally.seen.add(msg.id);
      const u = msg.usage;
      tally.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
    tally.offset += lastNewline + 1;
  } finally {
    fs.closeSync(fd);
  }
  return tally.tokens;
}
