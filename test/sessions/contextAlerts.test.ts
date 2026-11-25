import { describe, expect, it } from 'vitest';
import { applyConfigPatch, DEFAULT_CONTEXT_ALERTS, defaultSessionsConfig } from '../../src/sessions/settings.ts';
import { contextLevelFor } from '../../src/sessions/state.ts';

const alerts = { opus: { warn: 250_000, danger: 500_000 }, other: { warn: 150_000, danger: 300_000 } };

describe('contextLevelFor', () => {
  it('is nothing below the warning size, warn from it, danger from the danger size', () => {
    expect(contextLevelFor('claude-opus-5-5', 249_999, alerts)).toBeUndefined();
    expect(contextLevelFor('claude-opus-5-5', 250_000, alerts)).toBe('warn');
    expect(contextLevelFor('claude-opus-5-5', 500_000, alerts)).toBe('danger');
  });

  it('falls back to the "other" sizes for families without their own, and to nothing without tokens', () => {
    expect(contextLevelFor('some-model', 160_000, alerts)).toBe('warn');
    expect(contextLevelFor('claude-opus-5-5', undefined, alerts)).toBeUndefined();
    expect(contextLevelFor('claude-sonnet-5-5', 400_000, {})).toBeUndefined();
  });
});

describe('context alert settings', () => {
  it('has a warning below the danger size for every family by default', () => {
    expect(defaultSessionsConfig().contextAlerts).toEqual(DEFAULT_CONTEXT_ALERTS);
    for (const a of Object.values(DEFAULT_CONTEXT_ALERTS)) expect(a.warn).toBeLessThan(a.danger);
  });

  it('saves new sizes per family, keeping the families it was not given', () => {
    const next = applyConfigPatch(defaultSessionsConfig(), { contextAlerts: { opus: { warn: 300_000, danger: 600_000 } } });
    expect(typeof next).toBe('object');
    if (typeof next === 'string') return;
    expect(next.contextAlerts.opus).toEqual({ warn: 300_000, danger: 600_000 });
    expect(next.contextAlerts.haiku).toEqual(DEFAULT_CONTEXT_ALERTS.haiku);
  });

  it('rejects a warning size at or above the danger size, or sizes that are not positive numbers', () => {
    expect(applyConfigPatch(defaultSessionsConfig(), { contextAlerts: { opus: { warn: 500_000, danger: 400_000 } } })).toMatch(/warning/i);
    expect(applyConfigPatch(defaultSessionsConfig(), { contextAlerts: { opus: { warn: 0, danger: 400_000 } } })).toMatch(/number/i);
    expect(applyConfigPatch(defaultSessionsConfig(), { contextAlerts: { robot: { warn: 1, danger: 2 } } })).toMatch(/model/i);
  });
});
