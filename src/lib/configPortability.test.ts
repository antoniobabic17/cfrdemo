import { describe, it, expect } from 'vitest';
import {
  classifyKey,
  isDefaultDeselected,
  buildBundle,
  serializeBundle,
  parseBundle,
  diffImport,
  BundleParseError,
  CONFIG_BUNDLE_KIND,
  CONFIG_BUNDLE_SCHEMA_VERSION,
  type ConfigBundleRow,
} from './configPortability';
import {
  SETTING_TENANT_ID,
  SETTING_ADMIN_PRINCIPALS,
  SETTING_TENOR_API_KEY,
  SETTING_P4W_ENV_GUIDS,
  SETTING_ENVIRONMENT_LABEL,
  SETTING_FEATURE_TOGGLES,
} from './constants';

const row = (k: string, v: string | null): ConfigBundleRow => ({ pmo_key: k, pmo_value: v });
const ENV = { envLabel: 'DEV', envId: 'env-1', appVersion: '2.13.0' };

describe('configPortability — classification', () => {
  it('identity keys classify as identity', () => {
    expect(classifyKey(SETTING_TENANT_ID)).toBe('identity');
    expect(classifyKey(SETTING_P4W_ENV_GUIDS)).toBe('identity');
    expect(classifyKey(SETTING_ENVIRONMENT_LABEL)).toBe('identity');
    expect(classifyKey(SETTING_ADMIN_PRINCIPALS)).toBe('identity');
  });
  it('secret keys classify as secret', () => {
    expect(classifyKey(SETTING_TENOR_API_KEY)).toBe('secret');
  });
  it('everything else is portable', () => {
    expect(classifyKey(SETTING_FEATURE_TOGGLES)).toBe('portable');
    expect(classifyKey('pmo.team_tabs.abc')).toBe('portable');
    expect(classifyKey('pmo.some_future_key')).toBe('portable');
  });
  it('identity + secret are default-deselected; portable is not', () => {
    expect(isDefaultDeselected(SETTING_TENANT_ID)).toBe(true);
    expect(isDefaultDeselected(SETTING_TENOR_API_KEY)).toBe(true);
    expect(isDefaultDeselected(SETTING_FEATURE_TOGGLES)).toBe(false);
  });
});

describe('configPortability — build / serialize / parse', () => {
  it('buildBundle sorts rows, counts, and lists required (non-portable) keys', () => {
    const b = buildBundle(
      [row(SETTING_FEATURE_TOGGLES, '{}'), row(SETTING_TENANT_ID, 't1'), row(SETTING_TENOR_API_KEY, 'k')],
      ENV,
    );
    expect(b.manifest.kind).toBe(CONFIG_BUNDLE_KIND);
    expect(b.manifest.schemaVersion).toBe(CONFIG_BUNDLE_SCHEMA_VERSION);
    expect(b.manifest.rowCount).toBe(3);
    expect(b.manifest.exportedFromEnvLabel).toBe('DEV');
    // config sorted by key
    expect(b.config.map((r) => r.pmo_key)).toEqual([...b.config.map((r) => r.pmo_key)].sort());
    // requiredKeys = the identity + secret ones only
    const reqKeys = b.manifest.requiredKeys.map((r) => r.key).sort();
    expect(reqKeys).toEqual([SETTING_TENANT_ID, SETTING_TENOR_API_KEY].sort());
  });

  it('serialize -> parse round-trips', () => {
    const b = buildBundle([row(SETTING_FEATURE_TOGGLES, '{"a":true}'), row(SETTING_TENANT_ID, 't1')], ENV);
    const parsed = parseBundle(serializeBundle(b));
    expect(parsed.config).toEqual(b.config);
    expect(parsed.manifest.rowCount).toBe(2);
  });

  it('keyCatalog covers every known key incl. unset ones, with current values', () => {
    const b = buildBundle([row(SETTING_TENANT_ID, 't1')], ENV);
    const cat = b.manifest.keyCatalog;
    // catalog is independent of how many rows are set — it lists the full surface
    expect(cat.length).toBeGreaterThan(b.config.length);
    const tenant = cat.find((c) => c.key === SETTING_TENANT_ID);
    expect(tenant?.currentValue).toBe('t1');
    expect(tenant?.klass).toBe('identity');
    // a key that was NOT exported shows currentValue null but is still catalogued
    const cap = cat.find((c) => c.key === 'pmo.standard_capacity_hours');
    expect(cap).toBeTruthy();
    expect(cap?.currentValue).toBeNull();
    expect(cap?.default).toContain('160');
    // the first-admin key is flagged required
    expect(cat.find((c) => c.key === 'pmo.admin_principals_json')?.required).toBe(true);
  });

  it('parse rejects non-JSON', () => {
    expect(() => parseBundle('{not json')).toThrow(BundleParseError);
  });
  it('parse rejects a non-bundle JSON object', () => {
    expect(() => parseBundle(JSON.stringify({ hello: 'world' }))).toThrow(/not a CFR PMO config bundle/);
  });
  it('parse rejects an unsupported schema version', () => {
    const bad = JSON.stringify({ manifest: { kind: CONFIG_BUNDLE_KIND, schemaVersion: 999 }, config: [] });
    expect(() => parseBundle(bad)).toThrow(/Unsupported bundle version/);
  });
  it('parse drops rows without a string key and coerces values', () => {
    const raw = JSON.stringify({
      manifest: { kind: CONFIG_BUNDLE_KIND, schemaVersion: CONFIG_BUNDLE_SCHEMA_VERSION },
      config: [{ pmo_key: 'pmo.a', pmo_value: 'x' }, { pmo_value: 'orphan' }, { pmo_key: 'pmo.b', pmo_value: null }],
    });
    const parsed = parseBundle(raw);
    expect(parsed.config).toEqual([{ pmo_key: 'pmo.a', pmo_value: 'x' }, { pmo_key: 'pmo.b', pmo_value: null }]);
  });
});

describe('configPortability — diffImport (merge preview)', () => {
  const current = [row(SETTING_FEATURE_TOGGLES, '{"a":true}'), row('pmo.team_tabs.t1', '["nav.projects"]'), row(SETTING_TENANT_ID, 'live-tenant')];

  it('classifies add / change / unchanged', () => {
    const incoming = [
      row(SETTING_FEATURE_TOGGLES, '{"a":false}'), // change
      row('pmo.team_tabs.t1', '["nav.projects"]'), // unchanged
      row('pmo.new_key', 'v'),                      // add
    ];
    const d = diffImport(current, incoming);
    expect(d.find((r) => r.key === SETTING_FEATURE_TOGGLES)!.changeType).toBe('change');
    expect(d.find((r) => r.key === 'pmo.team_tabs.t1')!.changeType).toBe('unchanged');
    expect(d.find((r) => r.key === 'pmo.new_key')!.changeType).toBe('add');
  });

  it('portable changes are default-selected; unchanged + identity are not', () => {
    const incoming = [
      row(SETTING_FEATURE_TOGGLES, '{"a":false}'),
      row('pmo.team_tabs.t1', '["nav.projects"]'),
      row(SETTING_TENANT_ID, 'other-tenant'),
    ];
    const d = diffImport(current, incoming);
    expect(d.find((r) => r.key === SETTING_FEATURE_TOGGLES)!.defaultSelected).toBe(true);   // portable change
    expect(d.find((r) => r.key === 'pmo.team_tabs.t1')!.defaultSelected).toBe(false);       // unchanged
    expect(d.find((r) => r.key === SETTING_TENANT_ID)!.defaultSelected).toBe(false);        // identity
  });

  it('flags malformed JSON-valued incoming rows and never default-selects them', () => {
    const incoming = [row(SETTING_FEATURE_TOGGLES, '{bad json')];
    const d = diffImport(current, incoming);
    expect(d[0].malformed).toBe(true);
    expect(d[0].defaultSelected).toBe(false);
  });

  it('merge-only: keys absent from incoming are not represented (never deleted)', () => {
    const incoming = [row('pmo.new_key', 'v')];
    const d = diffImport(current, incoming);
    expect(d.map((r) => r.key)).toEqual(['pmo.new_key']);
  });
});
