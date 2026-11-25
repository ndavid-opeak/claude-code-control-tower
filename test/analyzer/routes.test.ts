import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-router-'));
const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
process.env.CLAUDE_ROUTER_HOME = stateDir;
process.env.CLAUDE_CONFIG_DIR = claudeHome;

let app: typeof import('../../src/server.js').app;
beforeAll(async () => {
  ({ app } = await import('../../src/server.js'));
});

const json = { 'content-type': 'application/json' };
const runAnalysis = (body: unknown = {}) => app.request('/api/analyzer/run', { method: 'POST', headers: json, body: JSON.stringify(body) });
const latest = async () => (await app.request('/api/analyzer/report')).json();

describe('analyzer routes', () => {
  it('returns no report before the first run, then saves and returns the latest one', async () => {
    expect(await latest()).toBeNull();

    fs.writeFileSync(path.join(claudeHome, 'settings.json.bak-1'), '{}');
    const res = await runAnalysis({ window: 7 });
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report).toMatchObject({ window: 7, categories: { hygiene: 97 } });
    expect(report.findings).toHaveLength(1);
    expect(await latest()).toEqual(report);
    expect(fs.readdirSync(stateDir)).toContain('analyzer-report.json');

    fs.rmSync(path.join(claudeHome, 'settings.json.bak-1'));
    const second = await (await runAnalysis()).json();
    expect(second).toMatchObject({ window: 30, findings: [] });
    expect(await latest()).toEqual(second);
  });

  it('rejects a window other than 7 or 30', async () => {
    expect((await runAnalysis({ window: 14 })).status).toBe(400);
  });

  it('only accepts JSON writes from this machine', async () => {
    expect((await app.request('/api/analyzer/run', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await app.request('/api/analyzer/run', { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body: '{}' })).status).toBe(403);
    expect((await app.request('http://evil.example/api/analyzer/run', { method: 'POST', headers: json, body: '{}' })).status).toBe(403);
  });
});
