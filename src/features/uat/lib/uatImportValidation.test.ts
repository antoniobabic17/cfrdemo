/**
 * T036 — per-row validation. 3 bad rows out of 50, reported as exactly those 3.
 *
 * The headline test builds 50 rows, spoils three of them in three different ways, and asserts
 * the report names those three source row numbers and no others. "Exactly" is the claim: the
 * legacy import stopped at the first failure, so nobody ever saw the second, and its report
 * was keyed to nothing a person could find in their own file.
 *
 * The other load-bearing test is the reference one. Legacy defect 5 was a chain — an
 * unresolved reference became a null lookup, became an empty `@odata.bind`, became an HTTP
 * 400, became an unhandled dead iteration with earlier rows already written. It is broken at
 * the first link: a row whose reference does not resolve never reaches the valid list, and
 * `hasEmptyBind` asserts that no payload validation produced can carry one.
 */
import { describe, it, expect } from 'vitest';
import {
  validateStagedRows,
  parseImportDate,
  parsePriority,
  hasEmptyBind,
  IMPORT_TARGET_FIELDS,
  type ImportReferences,
  type RowToValidate,
} from './uatImportValidation';
import { UAT_PRIORITY, UAT_SOURCE } from '../../../lib/uatOptionSets';

const MAPPING = {
  Title: 'pmo_title',
  Objective: 'pmo_objective',
  Priority: 'pmo_priority',
  'Planned start': 'pmo_plannedstart',
  Minutes: 'pmo_estimatedminutes',
  Cycle: 'pmo_Cycle',
  Tester: 'pmo_AssignedTester',
};

const REFERENCES: ImportReferences = {
  cyclesByName: { 'Sprint 1': 'cyc-1', 'Sprint 2': 'cyc-2' },
  testersByName: { 'Pat Weir': 'usr-1', 'pat.weir@example.invalid': 'usr-1' },
};

const row = (sourceRow: number, values: Record<string, string>): RowToValidate =>
  ({ sourceRow, values, rowId: `r-${sourceRow}` });

/** A good row, parameterised so 50 of them can be built. */
const goodRow = (n: number) => row(n + 1, {
  Title: `Case ${n}`,
  Objective: 'check the thing',
  Priority: 'High',
  'Planned start': '2026-09-01',
  Minutes: '15',
  Cycle: 'Sprint 1',
  Tester: 'Pat Weir',
});

describe('3 bad rows out of 50, reported as exactly those 3', () => {
  const rows: RowToValidate[] = Array.from({ length: 50 }, (_, i) => goodRow(i));
  // Three different failure kinds, so one broken check cannot mask the others.
  rows[6] = row(7, { ...rows[6].values, Title: '' });                    // required, empty
  rows[19] = row(20, { ...rows[19].values, Cycle: 'Sprint 9' });          // reference misses
  rows[41] = row(42, { ...rows[41].values, Minutes: 'about twenty' });    // wrong type

  const result = validateStagedRows(rows, MAPPING, REFERENCES);

  it('reports exactly three rows, by their source row numbers', () => {
    expect(result.invalid.map((r) => r.sourceRow)).toEqual([7, 20, 42]);
    expect(result.valid).toHaveLength(47);
    // And the 47 are the OTHER 47 — not merely a count that happens to match.
    expect(result.valid.map((r) => r.sourceRow)).not.toContain(7);
    expect(result.valid.map((r) => r.sourceRow)).not.toContain(20);
    expect(result.valid.map((r) => r.sourceRow)).not.toContain(42);
  });

  it('gives each one a reason naming the column and the value', () => {
    const reasonFor = (sourceRow: number) =>
      result.invalid.find((r) => r.sourceRow === sourceRow)!.reasons.map((x) => x.reason).join(' ');

    expect(reasonFor(7)).toMatch(/Title is required/i);
    expect(reasonFor(20)).toContain('Sprint 9');
    expect(reasonFor(20)).toMatch(/Create the cycle first/i);   // says what to do
    expect(reasonFor(42)).toContain('about twenty');
    expect(reasonFor(42)).toMatch(/whole number/i);

    // Every issue carries the column the operator mapped, so the report points at a cell.
    const columns = result.issues.map((i) => i.column);
    expect(columns).toContain('Cycle');
    expect(columns).toContain('Minutes');
  });

  it('lists issues in source-row order, which is the order the file reads in', () => {
    expect(result.issues.map((i) => i.sourceRow)).toEqual([7, 20, 42]);
  });

  it('does not stop at the first bad row', () => {
    // The whole legacy defect: 50 rows, a failure at row 7, and rows 8-50 never looked at.
    expect(result.valid.length + result.invalid.length).toBe(50);
  });

  it('reports every reason a row failed, not just the first', () => {
    const doubly = validateStagedRows(
      [row(3, { Title: '', Cycle: 'Nope', Minutes: 'x' })],
      MAPPING,
      REFERENCES,
    );
    const reasons = doubly.invalid[0].reasons;
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    expect(reasons.every((r) => r.sourceRow === 3)).toBe(true);
  });
});

describe('every reference is resolved before any write (legacy defect 5)', () => {
  it('resolves a cycle and a tester to real ids, as binds', () => {
    const { valid } = validateStagedRows([goodRow(0)], MAPPING, REFERENCES);
    expect(valid[0].payload['pmo_Cycle@odata.bind']).toBe('/pmo_uatcycles(cyc-1)');
    expect(valid[0].payload['pmo_AssignedTester@odata.bind']).toBe('/systemusers(usr-1)');
  });

  it('never produces an empty bind, for any row it calls valid', () => {
    const mixed = [
      goodRow(0),
      row(9, { Title: 'No cycle named', Cycle: 'Ghost' }),
      row(10, { Title: 'No tester named', Tester: 'Nobody' }),
      row(11, { Title: 'Nothing referenced at all' }),
    ];
    const { valid, invalid } = validateStagedRows(mixed, MAPPING, REFERENCES);
    // Unresolved references are refused rather than written as nothing.
    expect(invalid.map((r) => r.sourceRow)).toEqual([9, 10]);
    for (const candidate of valid) {
      expect(hasEmptyBind(candidate.payload)).toBe(false);
    }
    // A row that references nothing is fine — it simply has no bind at all.
    const bare = valid.find((v) => v.sourceRow === 11)!;
    expect(Object.keys(bare.payload).filter((k) => k.endsWith('@odata.bind'))).toEqual([]);
  });

  it('recognises the shapes of an empty bind that would 400', () => {
    expect(hasEmptyBind({ 'pmo_Cycle@odata.bind': null })).toBe(true);
    expect(hasEmptyBind({ 'pmo_Cycle@odata.bind': '' })).toBe(true);
    expect(hasEmptyBind({ 'pmo_Cycle@odata.bind': '/pmo_uatcycles()' })).toBe(true);
    expect(hasEmptyBind({ 'pmo_Cycle@odata.bind': '/pmo_uatcycles(cyc-1)' })).toBe(false);
    expect(hasEmptyBind({ pmo_title: '' })).toBe(false);      // an empty non-bind is not this
  });

  it('matches a tester by email as well as by name, case-insensitively', () => {
    const { valid } = validateStagedRows(
      [row(2, { Title: 'x', Tester: 'PAT.WEIR@EXAMPLE.INVALID' })],
      MAPPING,
      REFERENCES,
    );
    expect(valid[0].payload['pmo_AssignedTester@odata.bind']).toBe('/systemusers(usr-1)');
  });

  it('treats a blank reference cell as "no reference", not as a failure', () => {
    const { valid, invalid } = validateStagedRows(
      [row(2, { Title: 'x', Cycle: '   ', Tester: '' })],
      MAPPING,
      REFERENCES,
    );
    expect(invalid).toHaveLength(0);
    expect(Object.keys(valid[0].payload).filter((k) => k.endsWith('@odata.bind'))).toEqual([]);
  });
});

describe('types, and the values a spreadsheet actually contains', () => {
  it('stamps every imported case as coming from an import', () => {
    const { valid } = validateStagedRows([goodRow(0)], MAPPING, REFERENCES);
    expect(valid[0].payload.pmo_source).toBe(UAT_SOURCE.Import);
  });

  it('reads a priority label whatever its case and spacing, and refuses a non-member', () => {
    expect(parsePriority('High')).toBe(UAT_PRIORITY.High);
    expect(parsePriority('  high  ')).toBe(UAT_PRIORITY.High);
    expect(parsePriority('URGENT-ish')).toBeNull();
    expect(parsePriority('')).toBeNull();
    // A bare integer is accepted only if it is a real member of the set. The non-member is
    // DERIVED from the set rather than typed: T014's guard forbids an 89346xxxx literal
    // anywhere under features/uat, and it caught this line when it was one.
    const notAMember = String(Math.max(...Object.values(UAT_PRIORITY)) + 500);
    expect(parsePriority(String(UAT_PRIORITY.High))).toBe(UAT_PRIORITY.High);
    expect(parsePriority(notAMember)).toBeNull();
  });

  it('reads ISO dates and four-digit slash dates, and refuses ambiguity', () => {
    expect(parseImportDate('2026-09-01')).toBe('2026-09-01');
    expect(parseImportDate('9/1/2026')).toBe('2026-09-01');
    // 13 cannot be a month, so it is read as the day rather than producing the wrong date.
    expect(parseImportDate('13/9/2026')).toBe('2026-09-13');
    // A two-digit year has three plausible readings; none is safe to pick.
    expect(parseImportDate('03/04/26')).toBeNull();
    // A date that does not exist is refused rather than rolled forward into March.
    expect(parseImportDate('2026-02-31')).toBeNull();
    expect(parseImportDate('not a date')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });

  it('refuses a value longer than the column, naming both lengths', () => {
    const { invalid } = validateStagedRows(
      [row(4, { Title: 'x'.repeat(401) })],
      MAPPING,
      REFERENCES,
    );
    expect(invalid[0].reasons[0].reason).toContain('401 characters');
    expect(invalid[0].reasons[0].reason).toContain('400');
  });

  it('refuses anything but plain digits for a minute count', () => {
    // Number() would read '1e3' as 1000 and '0x10' as 16 — a plausible number nobody typed.
    for (const value of ['-5', '1.5', '1e3', '0x10', '12 minutes']) {
      const { invalid } = validateStagedRows([row(5, { Title: 'x', Minutes: value })], MAPPING, REFERENCES);
      expect(invalid).toHaveLength(1);
    }
    expect(validateStagedRows([row(5, { Title: 'x', Minutes: '0' })], MAPPING, REFERENCES).valid).toHaveLength(1);
  });
});

describe('the mapping itself', () => {
  it('says so, once per row, when no column feeds a required field', () => {
    // 50 rows with no Title column is 50 rows that cannot be created, and saying it against
    // every row is the honest report rather than one message about the file.
    const rows = Array.from({ length: 3 }, (_, i) => row(i + 2, { Objective: 'x' }));
    const { invalid, valid } = validateStagedRows(rows, { Objective: 'pmo_objective' }, REFERENCES);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(3);
    for (const bad of invalid) {
      expect(bad.reasons.some((r) => r.column === null && /no column is mapped/i.test(r.reason))).toBe(true);
    }
  });

  it('ignores a heading mapped to something that is not an importable field', () => {
    // The guard against an import writing derived state: pmo_executionstatus is not in the
    // target list, so mapping to it silently does nothing rather than corrupting a status.
    const { valid } = validateStagedRows(
      [row(2, { Title: 'x', Status: 'Completed' })],
      { Title: 'pmo_title', Status: 'pmo_executionstatus' },
      REFERENCES,
    );
    expect(valid).toHaveLength(1);
    expect(valid[0].payload.pmo_executionstatus).toBeUndefined();
  });

  it('offers no derived or external-tracker field as an import target', () => {
    const fields = IMPORT_TARGET_FIELDS.map((f) => f.field);
    for (const forbidden of ['pmo_executionstatus', 'pmo_externalkey', 'pmo_externalsystem', 'pmo_name', 'pmo_source']) {
      expect(fields).not.toContain(forbidden);
    }
    // Title is the only required one, so a file with just titles imports.
    expect(IMPORT_TARGET_FIELDS.filter((f) => f.required).map((f) => f.field)).toEqual(['pmo_title']);
  });

  it('carries each staged row\'s Dataverse id through, so the commit can mark it', () => {
    const { valid, invalid } = validateStagedRows(
      [goodRow(0), row(3, { Title: '' })],
      MAPPING,
      REFERENCES,
    );
    expect(valid[0].rowId).toBe('r-1');
    expect(invalid[0].rowId).toBe('r-3');
  });
});
