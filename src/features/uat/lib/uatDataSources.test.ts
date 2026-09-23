/**
 * Cross-checks the three places a UAT table must be registered.
 *
 * A table is queryable at runtime only if it appears in ALL THREE of:
 *
 *   1. app/src/features/uat/lib/uatDataSources.ts   (generated from DEV)
 *   2. app/src/lib/dataverseClient.ts               DATAVERSE_SOURCES
 *   3. app/power.config.json                        databaseReferences
 *
 * Miss any one and nothing fails at build time. It throws at CALL time with
 * "Data source not found: No Dataverse data source found for table: ..." -- and
 * only for the code path that happens to touch that table, which may be a page
 * nobody opens during review. `check-powerconfig-datasource-parity.py`'s own
 * docstring records that this "has bitten PROD once and DEV once".
 *
 * Reviewing three files by eye for a 15-row diff is exactly the task humans are
 * worst at, so this asserts the agreement instead. It reads the two registries as
 * TEXT rather than importing them: dataverseClient.ts does not export
 * DATAVERSE_SOURCES, and importing it would drag the whole Power Apps SDK into a
 * unit test.
 */
import { describe, expect, it } from 'vitest';
import { UAT_DATA_SOURCES, UAT_ENTITY_SET_NAMES } from './uatDataSources';

const dataverseClientSource = Object.values(
  import.meta.glob('../../../lib/dataverseClient.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

const powerConfigRaw = Object.values(
  import.meta.glob('../../../../power.config.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
)[0];

interface PowerConfig {
  databaseReferences: Record<string, {
    dataSources: Record<string, { entitySetName: string; logicalName: string; isHidden: boolean }>;
  }>;
}

// The config is committed with a UTF-8 BOM tolerance in the Python gate; strip any
// leading BOM before parsing so this test agrees with that gate rather than
// disagreeing over an invisible byte.
const powerConfig = JSON.parse(powerConfigRaw.replace(/^\uFEFF/, '')) as PowerConfig;
const configuredDataSources = powerConfig.databaseReferences['default.cds'].dataSources;

describe('UAT data source registration', () => {
  it('covers all 15 tables from data-model.md', () => {
    expect(UAT_DATA_SOURCES).toHaveLength(15);
  });

  it('loaded both registries', () => {
    // If a glob path drifts these come back undefined and every assertion below
    // would pass vacuously.
    expect(dataverseClientSource, 'dataverseClient.ts was not loaded').toBeTruthy();
    expect(powerConfigRaw, 'power.config.json was not loaded').toBeTruthy();
    expect(Object.keys(configuredDataSources).length).toBeGreaterThan(15);
  });

  it('registers every UAT entity set in dataverseClient.ts DATAVERSE_SOURCES', () => {
    const missing = UAT_DATA_SOURCES.filter(
      (source) => !new RegExp(`\\b${source.entitySetName}\\s*:\\s*\\{`).test(dataverseClientSource),
    ).map((source) => source.entitySetName);
    expect(
      missing,
      'Add these to DATAVERSE_SOURCES in app/src/lib/dataverseClient.ts, or the runtime '
      + 'throws "Data source not found" the first time a UAT page queries them.',
    ).toEqual([]);
  });

  it('maps each entity set to its correct logical name in dataverseClient.ts', () => {
    // A registration with the wrong tableId is worse than a missing one: it
    // resolves, and then queries the wrong table.
    const wrong: string[] = [];
    for (const source of UAT_DATA_SOURCES) {
      const match = new RegExp(
        `\\b${source.entitySetName}\\s*:\\s*\\{[^}]*tableId:\\s*'([^']+)'`,
      ).exec(dataverseClientSource);
      if (!match) continue;
      if (match[1] !== source.logicalName) {
        wrong.push(`${source.entitySetName} -> tableId '${match[1]}', expected '${source.logicalName}'`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('registers every UAT entity set in power.config.json', () => {
    const configured = new Set(
      Object.values(configuredDataSources).map((entry) => entry.entitySetName),
    );
    const missing = UAT_ENTITY_SET_NAMES.filter((name) => !configured.has(name));
    expect(
      missing,
      'Add these to databaseReferences["default.cds"].dataSources in app/power.config.json. '
      + 'dataverseClient.ts alone is not enough -- both are required at runtime.',
    ).toEqual([]);
  });

  it('pairs each power.config entry with the matching logical name', () => {
    const byEntitySet = new Map(
      Object.values(configuredDataSources).map((entry) => [entry.entitySetName, entry.logicalName]),
    );
    const wrong: string[] = [];
    for (const source of UAT_DATA_SOURCES) {
      const logical = byEntitySet.get(source.entitySetName);
      if (logical && logical !== source.logicalName) {
        wrong.push(`${source.entitySetName} -> logicalName '${logical}', expected '${source.logicalName}'`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The one name in this model that a reasonable person gets wrong. Dataverse
   * appends "s" rather than applying English pluralization, so the English
   * spelling 404s at call time. Asserted explicitly because every OTHER table
   * here pluralizes the way English would, which is what makes this one a trap.
   */
  it('uses pmo_uatimportbatchs, not pmo_uatimportbatches', () => {
    const importBatch = UAT_DATA_SOURCES.find((s) => s.logicalName === 'pmo_uatimportbatch');
    expect(importBatch?.entitySetName).toBe('pmo_uatimportbatchs');
    expect(dataverseClientSource).not.toContain('pmo_uatimportbatches');
    expect(powerConfigRaw).not.toContain('pmo_uatimportbatches');
  });

  it('derives every id attribute from its logical name', () => {
    for (const source of UAT_DATA_SOURCES) {
      expect(source.idAttribute).toBe(`${source.logicalName}id`);
    }
  });
});
