/**
 * sharePointData.ts — unit tests.
 *
 * Covers:
 *  1. Registry completeness invariants.
 *  2. SP_BACKED_ENTITY_SETS derived set.
 *  3. getSpListDef helper.
 *  4. isSharePointDataActive — the guard used by dataverseClient.ts.
 *
 * isSharePointDataActive depends on getCachedDataSource(), which is
 * a module-level cache in taskSource.ts. We stub it so tests are
 * independent of app-settings state.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

let _cachedSource = 'pss';
vi.mock('./taskSource', () => ({
  getCachedDataSource: () => _cachedSource,
}));

import {
  SP_LIST_REGISTRY,
  SP_BACKED_ENTITY_SETS,
  getSpListDef,
  isSharePointDataActive,
} from './sharePointData';

// ─── Registry invariants ─────────────────────────────────────────────────────

describe('SP_LIST_REGISTRY', () => {
  it('contains at least one entry per major custom-table group', () => {
    const sets = new Set(SP_LIST_REGISTRY.map((d) => d.entitySet));
    for (const required of [
      'pmo_projects', 'pmo_programs', 'pmo_tasks', 'pmo_buckets',
      'pmo_taskassignments', 'pmo_projectrisks', 'pmo_projectissues',
      'pmo_projectrequests', 'pmo_notifications', 'pmo_userviews',
    ]) {
      expect(sets.has(required), `Missing ${required}`).toBe(true);
    }
  });

  it('every entry has a non-empty entitySet, listName, primaryKey, and at least one field', () => {
    for (const def of SP_LIST_REGISTRY) {
      expect(def.entitySet.length, `entitySet empty on ${def.listName}`).toBeGreaterThan(0);
      expect(def.listName.length,  `listName empty on ${def.entitySet}`).toBeGreaterThan(0);
      expect(def.primaryKey.length, `primaryKey empty on ${def.entitySet}`).toBeGreaterThan(0);
      expect(def.fields.length, `no fields on ${def.entitySet}`).toBeGreaterThan(0);
    }
  });

  it('each primaryKey column is present in the fields array', () => {
    for (const def of SP_LIST_REGISTRY) {
      const keys = new Set(def.fields.map((f) => f.key));
      expect(
        keys.has(def.primaryKey),
        `${def.entitySet}: primaryKey '${def.primaryKey}' not in fields`,
      ).toBe(true);
    }
  });

  it('has no duplicate entitySet entries', () => {
    const seen = new Set<string>();
    for (const def of SP_LIST_REGISTRY) {
      expect(seen.has(def.entitySet), `Duplicate entitySet: ${def.entitySet}`).toBe(false);
      seen.add(def.entitySet);
    }
  });

  it('has no duplicate field keys within a single list', () => {
    for (const def of SP_LIST_REGISTRY) {
      const seen = new Set<string>();
      for (const f of def.fields) {
        expect(seen.has(f.key), `${def.entitySet}: duplicate field '${f.key}'`).toBe(false);
        seen.add(f.key);
      }
    }
  });

  it('every field type is one of the accepted SpFieldType values', () => {
    const VALID: string[] = ['Text', 'Note', 'Number', 'Currency', 'DateTime', 'Boolean'];
    for (const def of SP_LIST_REGISTRY) {
      for (const f of def.fields) {
        expect(VALID.includes(f.type), `${def.entitySet}.${f.key}: unknown type '${f.type}'`).toBe(true);
      }
    }
  });

  it('all isLookupGuid columns use a _*_value key naming convention', () => {
    for (const def of SP_LIST_REGISTRY) {
      for (const f of def.fields) {
        if (f.isLookupGuid) {
          expect(
            f.key.startsWith('_') && f.key.endsWith('_value'),
            `${def.entitySet}.${f.key}: isLookupGuid=true but not a _*_value column`,
          ).toBe(true);
        }
      }
    }
  });

  it('pmo_appsettings is NOT in the registry (bootstrap safety)', () => {
    const sets = new Set(SP_LIST_REGISTRY.map((d) => d.entitySet));
    expect(sets.has('pmo_appsettings')).toBe(false);
  });

  it('no msdyn_* or cr87a_* entity sets are in the registry', () => {
    for (const def of SP_LIST_REGISTRY) {
      expect(def.entitySet.startsWith('msdyn_'), `PSS table in registry: ${def.entitySet}`).toBe(false);
      expect(def.entitySet.startsWith('cr87a_'), `Tenant-specific table in registry: ${def.entitySet}`).toBe(false);
    }
  });
});

// ─── SP_BACKED_ENTITY_SETS ───────────────────────────────────────────────────

describe('SP_BACKED_ENTITY_SETS', () => {
  it('is derived correctly from the registry', () => {
    for (const def of SP_LIST_REGISTRY) {
      expect(SP_BACKED_ENTITY_SETS.has(def.entitySet)).toBe(true);
    }
    expect(SP_BACKED_ENTITY_SETS.size).toBe(SP_LIST_REGISTRY.length);
  });

  it('does not contain pmo_appsettings', () => {
    expect(SP_BACKED_ENTITY_SETS.has('pmo_appsettings')).toBe(false);
  });
});

// ─── getSpListDef ─────────────────────────────────────────────────────────────

describe('getSpListDef', () => {
  it('returns the correct def for a known entity set', () => {
    const def = getSpListDef('pmo_projects');
    expect(def).toBeDefined();
    expect(def!.listName).toBe('PMO Projects');
    expect(def!.primaryKey).toBe('pmo_projectid');
  });

  it('returns undefined for an entity set not in the registry', () => {
    expect(getSpListDef('pmo_appsettings')).toBeUndefined();
    expect(getSpListDef('msdyn_projects')).toBeUndefined();
    expect(getSpListDef('unknown_entity')).toBeUndefined();
  });
});

// ─── isSharePointDataActive ───────────────────────────────────────────────────

describe('isSharePointDataActive', () => {
  beforeEach(() => { _cachedSource = 'pss'; });

  it('is false when data source is pss', () => {
    _cachedSource = 'pss';
    expect(isSharePointDataActive('pmo_projects')).toBe(false);
  });

  it('is false when data source is custom (Dataverse custom tables)', () => {
    _cachedSource = 'custom';
    expect(isSharePointDataActive('pmo_projects')).toBe(false);
  });

  it('is true for a registered entity set when data source is sharepoint', () => {
    _cachedSource = 'sharepoint';
    expect(isSharePointDataActive('pmo_projects')).toBe(true);
    expect(isSharePointDataActive('pmo_tasks')).toBe(true);
    expect(isSharePointDataActive('pmo_notifications')).toBe(true);
  });

  it('is false for pmo_appsettings even when data source is sharepoint', () => {
    _cachedSource = 'sharepoint';
    expect(isSharePointDataActive('pmo_appsettings')).toBe(false);
  });

  it('is false for msdyn_* even when data source is sharepoint', () => {
    _cachedSource = 'sharepoint';
    expect(isSharePointDataActive('msdyn_projects')).toBe(false);
  });

  it('is false for an unknown entity set even when data source is sharepoint', () => {
    _cachedSource = 'sharepoint';
    expect(isSharePointDataActive('unknown_table')).toBe(false);
  });
});
