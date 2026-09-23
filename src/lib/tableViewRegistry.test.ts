import { describe, it, expect } from 'vitest';
import {
  columnCatalogKey, parseColumnCatalog, mergeColumns, getRegistryTable,
  findDuplicateLabels,
  type DiscoveredColumn,
} from './tableViewRegistry';

describe('columnCatalogKey', () => {
  it('namespaces per table', () => {
    expect(columnCatalogKey('projects')).toBe('columns.catalog.projects');
  });
});

describe('parseColumnCatalog', () => {
  it('returns [] for undefined / bad json', () => {
    expect(parseColumnCatalog(undefined)).toEqual([]);
    expect(parseColumnCatalog('not json')).toEqual([]);
    expect(parseColumnCatalog('{"not":"array"}')).toEqual([]);
  });
  it('parses a valid catalog and drops keyless rows', () => {
    const raw = JSON.stringify([
      { key: 'a', header: 'A', type: 'String' },
      { header: 'no key' },
    ]);
    expect(parseColumnCatalog(raw)).toEqual([{ key: 'a', header: 'A', type: 'String' }]);
  });
});

describe('mergeColumns', () => {
  it('returns shipped columns unchanged when no catalog', () => {
    const shipped = getRegistryTable('projects')!.columns;
    const merged = mergeColumns('projects', []);
    expect(merged.map((c) => c.key)).toEqual(shipped.map((c) => c.key));
    expect(merged.every((c) => !c.isNew && !c.isRemoved)).toBe(true);
  });

  it('flags a shipped column absent from the catalog as removed', () => {
    const shipped = getRegistryTable('projects')!.columns;
    // Catalog with every shipped key EXCEPT the first one.
    const catalog: DiscoveredColumn[] = shipped.slice(1).map((c) => ({ key: c.key, header: c.header, type: 'String' }));
    const merged = mergeColumns('projects', catalog);
    const first = merged.find((c) => c.key === shipped[0].key)!;
    expect(first.isRemoved).toBe(true);
  });

  it('appends a discovered-only column flagged isNew', () => {
    const catalog: DiscoveredColumn[] = [{ key: 'pmo_brandnewfield', header: 'Brand New', type: 'String' }];
    const merged = mergeColumns('projects', catalog);
    const added = merged.find((c) => c.key === 'pmo_brandnewfield');
    expect(added).toBeDefined();
    expect(added!.isNew).toBe(true);
    expect(added!.header).toBe('Brand New');
  });

  it('suppresses the legacy SAE lookup when the snapshot column is in the catalog', () => {
    // After a re-pull the catalog contains BOTH the shipped snapshot text column
    // (pmo_payerinitiatives_saedisplayname, DV label "Payer Initiative Team: SAE
    // Name") and the superseded lookup (_pmo_payerinitiatives_strategicaccount
    // executive_value, DV label "Payer Initiative Team: Strategic Account
    // Executive"). Neither DV label matches the shipped header "Strategic Account
    // Executive", so the shippedLabels guard cannot catch the lookup -- only the
    // TABLE_ALIAS_MAP entry prevents it becoming a SECOND selectable SAE column
    // (which renders blank, the lookup FormattedValue being empty on most rows).
    const catalog: DiscoveredColumn[] = [
      { key: 'pmo_payerinitiatives_saedisplayname', header: 'Payer Initiative Team: SAE Name', type: 'String' },
      { key: '_pmo_payerinitiatives_strategicaccountexecutive_value', header: 'Payer Initiative Team: Strategic Account Executive', type: 'Lookup', isLookup: true },
    ];
    const merged = mergeColumns('projects', catalog);
    // The shipped SAE column survives and is not flagged removed.
    const shippedSae = merged.find((c) => c.key === 'pmo_payerinitiatives_saedisplayname');
    expect(shippedSae).toBeDefined();
    expect(shippedSae!.isRemoved).toBe(false);
    // The legacy lookup must NOT appear as a separate column.
    const legacyLookup = merged.find((c) => c.key === '_pmo_payerinitiatives_strategicaccountexecutive_value');
    expect(legacyLookup).toBeUndefined();
    // And exactly ONE column carries the SAE header.
    const saeHeaders = merged.filter((c) => c.header === 'Strategic Account Executive');
    expect(saeHeaders).toHaveLength(1);
  });
});

describe('findDuplicateLabels', () => {
  it('returns empty array when all labels are unique', () => {
    const cols = [
      { key: 'a', header: 'Alpha' },
      { key: 'b', header: 'Beta' },
      { key: 'c', header: 'Gamma' },
    ];
    expect(findDuplicateLabels(cols)).toEqual([]);
  });

  it('detects a collision by default header', () => {
    const cols = [
      { key: 'a', header: 'Finish Date' },
      { key: 'b', header: 'Finish Date' },
      { key: 'c', header: 'Something Else' },
    ];
    const result = findDuplicateLabels(cols);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('finish date');
    expect(result[0].keys).toEqual(['a', 'b']);
  });

  it('is case-insensitive', () => {
    const cols = [
      { key: 'x', header: 'Program' },
      { key: 'y', header: 'PROGRAM' },
    ];
    const result = findDuplicateLabels(cols);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(['x', 'y']);
  });

  it('honours label overrides over default headers', () => {
    const cols = [
      { key: 'a', header: 'Finish Date' },
      { key: 'b', header: 'Finish Date' },
    ];
    // Override 'a' to a unique name — collision resolved.
    expect(findDuplicateLabels(cols, { a: 'Target Finish' })).toEqual([]);
  });

  it('detects collision introduced by an override', () => {
    const cols = [
      { key: 'a', header: 'Alpha' },
      { key: 'b', header: 'Beta' },
    ];
    // Admin renamed 'b' to 'Alpha' — now they clash.
    const result = findDuplicateLabels(cols, { b: 'Alpha' });
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(['a', 'b']);
  });

  it('ignores columns with empty labels', () => {
    const cols = [
      { key: 'a', header: '' },
      { key: 'b', header: '' },
    ];
    expect(findDuplicateLabels(cols)).toEqual([]);
  });
});
