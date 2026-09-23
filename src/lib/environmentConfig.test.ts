import { describe, it, expect, beforeEach } from 'vitest';
import {
  primeEnvironmentConfig,
  getCachedP4WEnvIds,
  getCachedEnvironmentLabel,
  getCachedEnvironmentBadgeColor,
  defaultBadgeColorForLabel,
  labelFromEnvIds,
} from './environmentConfig';
import {
  ENV_IDS,
  P4W_GUIDS_BY_ENV,
  SETTING_ENVIRONMENT_LABEL,
  SETTING_P4W_ENV_GUIDS,
  SETTING_ENVIRONMENT_BADGE_COLOR,
} from './constants';

type Row = { pmo_key: string | null; pmo_value: string | null };
const rows = (...pairs: [string, string][]): Row[] => pairs.map(([k, v]) => ({ pmo_key: k, pmo_value: v }));

describe('environmentConfig — net-neutral fallback', () => {
  beforeEach(() => {
    // reset the module cache to a known state before each test
    primeEnvironmentConfig([], null);
  });

  it('labelFromEnvIds matches the compiled env table', () => {
    expect(labelFromEnvIds(ENV_IDS.dev)).toBe('DEV');
    expect(labelFromEnvIds(ENV_IDS.uat)).toBe('UAT');
    expect(labelFromEnvIds(ENV_IDS.prod)).toBe('PROD');
    expect(labelFromEnvIds('unknown-env')).toBeNull();
    expect(labelFromEnvIds(null)).toBeNull();
  });

  it('UNSET settings => legacy behavior (label from ENV_IDS, GUIDs from P4W table)', () => {
    const res = primeEnvironmentConfig([], ENV_IDS.dev);
    expect(res.environmentLabel).toBe('DEV');
    expect(res.p4wEnvGuids).toEqual(P4W_GUIDS_BY_ENV[ENV_IDS.dev]);
    // module cache mirrors the return
    expect(getCachedEnvironmentLabel()).toBe('DEV');
    expect(getCachedP4WEnvIds()).toEqual(P4W_GUIDS_BY_ENV[ENV_IDS.dev]);
  });

  it('unknown env with no override => null label, undefined GUIDs (unchanged legacy)', () => {
    const res = primeEnvironmentConfig([], 'brand-new-env-guid');
    expect(res.environmentLabel).toBeNull();
    expect(res.p4wEnvGuids).toBeUndefined();
  });

  it('environment_label override wins over ENV_IDS match', () => {
    const res = primeEnvironmentConfig(rows([SETTING_ENVIRONMENT_LABEL, 'SANDBOX']), ENV_IDS.prod);
    expect(res.environmentLabel).toBe('SANDBOX');
  });

  it('p4w_env_guids_json override wins and is used even for an unknown env', () => {
    const guids = { calendarId: 'c-1', workHoursTemplateId: 'w-1', orgUnitId: 'o-1' };
    const res = primeEnvironmentConfig(
      rows([SETTING_P4W_ENV_GUIDS, JSON.stringify(guids)]),
      'brand-new-env-guid',
    );
    expect(res.p4wEnvGuids).toEqual(guids);
    expect(getCachedP4WEnvIds()).toEqual(guids);
  });

  it('malformed p4w JSON => falls back to the compiled table (never throws)', () => {
    const res = primeEnvironmentConfig(rows([SETTING_P4W_ENV_GUIDS, '{not valid json']), ENV_IDS.dev);
    expect(res.p4wEnvGuids).toEqual(P4W_GUIDS_BY_ENV[ENV_IDS.dev]);
  });

  it('incomplete p4w JSON (missing keys) => falls back to the compiled table', () => {
    const res = primeEnvironmentConfig(rows([SETTING_P4W_ENV_GUIDS, JSON.stringify({ calendarId: 'x' })]), ENV_IDS.dev);
    expect(res.p4wEnvGuids).toEqual(P4W_GUIDS_BY_ENV[ENV_IDS.dev]);
  });

  it('empty-string setting value is treated as unset', () => {
    const res = primeEnvironmentConfig(rows([SETTING_ENVIRONMENT_LABEL, '']), ENV_IDS.uat);
    expect(res.environmentLabel).toBe('UAT');
  });

  // ─── badge color ───────────────────────────────────────────────────────────

  it('defaultBadgeColorForLabel matches legacy Sidebar colors', () => {
    expect(defaultBadgeColorForLabel('DEV')).toBe('amber');
    expect(defaultBadgeColorForLabel('UAT')).toBe('sky');
    expect(defaultBadgeColorForLabel('PROD')).toBe('emerald');
    expect(defaultBadgeColorForLabel('SANDBOX')).toBe('emerald');
    expect(defaultBadgeColorForLabel(null)).toBe('emerald');
  });

  it('UNSET color => label-derived default (legacy appearance preserved)', () => {
    expect(primeEnvironmentConfig([], ENV_IDS.dev).environmentBadgeColor).toBe('amber');
    expect(primeEnvironmentConfig([], ENV_IDS.uat).environmentBadgeColor).toBe('sky');
    expect(primeEnvironmentConfig([], ENV_IDS.prod).environmentBadgeColor).toBe('emerald');
    expect(getCachedEnvironmentBadgeColor()).toBe('emerald');
  });

  it('valid color override wins over the label default', () => {
    const res = primeEnvironmentConfig(rows([SETTING_ENVIRONMENT_BADGE_COLOR, 'violet']), ENV_IDS.dev);
    expect(res.environmentBadgeColor).toBe('violet');
    expect(getCachedEnvironmentBadgeColor()).toBe('violet');
  });

  it('unknown color value => falls back to the label default', () => {
    const res = primeEnvironmentConfig(rows([SETTING_ENVIRONMENT_BADGE_COLOR, 'chartreuse']), ENV_IDS.uat);
    expect(res.environmentBadgeColor).toBe('sky');
  });

  it('color override applies with a custom label too', () => {
    const res = primeEnvironmentConfig(
      rows([SETTING_ENVIRONMENT_LABEL, 'SANDBOX'], [SETTING_ENVIRONMENT_BADGE_COLOR, 'rose']),
      'brand-new-env',
    );
    expect(res.environmentLabel).toBe('SANDBOX');
    expect(res.environmentBadgeColor).toBe('rose');
  });
});
