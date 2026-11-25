import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-router-flags-'));
process.env.CLAUDE_ROUTER_HOME = home;
const FILE = path.join(home, 'flags.json');

let flags: typeof import('../../src/sessions/flags.ts');
let app: typeof import('../../src/server.ts').app;
beforeAll(async () => {
  flags = await import('../../src/sessions/flags.ts');
  ({ app } = await import('../../src/server.ts'));
});
beforeEach(() => {
  fs.rmSync(FILE, { force: true });
  flags.resetFlags();
});

const HOUR = 3_600_000;
const ID = '0b6c1f9e-1111-4c2d-9e3f-123456789abc';

describe('flag store', () => {
  it('flags, edits the note, and unflags a session, saving to flags.json', () => {
    flags.setFlag(ID, undefined, 1000);
    expect(flags.getFlags()[ID]).toEqual({ at: 1000, seen: 1000 });
    flags.setFlag(ID, '  waiting on PR review ', 2000);
    expect(flags.getFlags()[ID]).toEqual({ at: 1000, seen: 2000, note: 'waiting on PR review' });
    expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))[ID].note).toBe('waiting on PR review');
    flags.clearFlag(ID);
    expect(flags.getFlags()[ID]).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))).toEqual({});
  });

  it('reads flags saved by an earlier run', () => {
    fs.writeFileSync(FILE, JSON.stringify({ [ID]: { at: 1, seen: 1, note: 'x' } }));
    flags.resetFlags();
    expect(flags.getFlags()[ID]?.note).toBe('x');
  });

  it('keeps a flag while its session is visible, and drops it a day after the session was last seen', () => {
    flags.setFlag(ID, undefined, 0);
    flags.syncFlags(new Set([ID]), 30 * HOUR);
    expect(flags.getFlags()[ID]?.seen).toBe(30 * HOUR);
    // Not visible (for example before the first scan): kept for a while.
    flags.syncFlags(new Set(), 40 * HOUR);
    expect(flags.getFlags()[ID]).toBeDefined();
    flags.syncFlags(new Set(), 56 * HOUR);
    expect(flags.getFlags()[ID]).toBeUndefined();
  });
});

describe('flag routes', () => {
  const json = { 'content-type': 'application/json' };
  const put = (id: string, body: unknown) => app.request(`/api/sessions/flags/${id}`, { method: 'PUT', headers: json, body: JSON.stringify(body) });

  it('flags with a note, lists, and unflags', async () => {
    expect((await put(ID, { note: 'important' })).status).toBe(200);
    const list = await (await app.request('/api/sessions/flags')).json();
    expect(list[ID].note).toBe('important');
    expect((await app.request(`/api/sessions/flags/${ID}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await app.request('/api/sessions/flags')).json()).toEqual({});
  });

  it('rejects bad ids, long or non-string notes, and non-JSON bodies', async () => {
    expect((await put('..%2Fetc', {})).status).toBe(400);
    expect((await put(ID, { note: 'x'.repeat(81) })).status).toBe(400);
    expect((await put(ID, { note: 5 })).status).toBe(400);
    const plain = await app.request(`/api/sessions/flags/${ID}`, { method: 'PUT', body: '{}' });
    expect(plain.status).toBe(415);
  });

  it('refuses other origins', async () => {
    const res = await app.request(`/api/sessions/flags/${ID}`, { method: 'DELETE', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});
