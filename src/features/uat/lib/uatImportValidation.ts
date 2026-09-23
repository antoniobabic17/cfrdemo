/**
 * Per-row validation — every reference resolved BEFORE any write.
 *
 * **This module is the fix for legacy defect 5.** There, a row carrying a reference that did
 * not resolve produced a null lookup, which produced an empty `@odata.bind`, which produced
 * an HTTP 400, which was not handled — and the iteration died with earlier rows already
 * created and no record of what had happened. Every part of that chain starts with a
 * reference that was never checked.
 *
 * So validation happens once, over every staged row, against reference data read once, and
 * it produces two lists: rows that can be written and rows that cannot, each of the latter
 * carrying its **source row number** and a reason a person can act on. The commit loop
 * (T038) writes only from the first list, and a bind it produces can never be empty, because
 * a row reaches that list only if every reference it names was found.
 *
 * **Reasons name the row, the column and the value.** "Cycle not found" is not actionable;
 * *"row 12, column Cycle: no cycle called 'Sprint 9' exists in this project — create it
 * first, or clear the cell"* is. The legacy import reported neither.
 */
import {
  UAT_PRIORITY,
  UAT_PRIORITY_LABELS,
  UAT_SOURCE,
} from '../../../lib/uatOptionSets';
import type { UatTestCaseCreate } from '../../../models/uatTestCase.model';
import { UAT_ENTITY_SETS } from './uatEntitySets';
import type { ParsedRow } from './uatFileParse';

/** What kind of value a target field holds, and therefore how it is checked. */
export type ImportFieldKind = 'text' | 'multiline' | 'integer' | 'date' | 'priority' | 'cycle' | 'tester';

export interface ImportFieldSpec {
  /** The Dataverse column or bind key this field writes. */
  field: string;
  /** What the wizard shows the operator. */
  label: string;
  kind: ImportFieldKind;
  required?: true;
  maxLength?: number;
}

/**
 * The fields an import may set on a test case — and nothing else.
 *
 * Deliberately a SHORT list rather than every writable column. The legacy import was locked
 * to two fixed view column contracts; this is the opposite failure to avoid, but "the
 * operator may map any column to any field" would let an import write `pmo_executionstatus`
 * and put a case into a state no run produced. Derived state and external-tracker keys are
 * not importable.
 */
export const IMPORT_TARGET_FIELDS: readonly ImportFieldSpec[] = [
  { field: 'pmo_title', label: 'Title', kind: 'text', required: true, maxLength: 400 },
  { field: 'pmo_objective', label: 'Objective', kind: 'multiline', maxLength: 4000 },
  { field: 'pmo_scenario', label: 'Scenario', kind: 'multiline', maxLength: 4000 },
  { field: 'pmo_preconditions', label: 'Preconditions', kind: 'multiline', maxLength: 4000 },
  { field: 'pmo_testdata', label: 'Test data', kind: 'multiline', maxLength: 4000 },
  { field: 'pmo_priority', label: 'Priority', kind: 'priority' },
  { field: 'pmo_plannedstart', label: 'Planned start', kind: 'date' },
  { field: 'pmo_plannedend', label: 'Planned end', kind: 'date' },
  { field: 'pmo_estimatedminutes', label: 'Estimated minutes', kind: 'integer' },
  { field: 'pmo_Cycle', label: 'Cycle', kind: 'cycle' },
  { field: 'pmo_AssignedTester', label: 'Assigned tester', kind: 'tester' },
];

const FIELD_BY_NAME = new Map(IMPORT_TARGET_FIELDS.map((spec) => [spec.field, spec]));

/** The reference data every lookup is resolved against — read ONCE, before validation. */
export interface ImportReferences {
  /** Cycle name (as the operator would type it) → cycle id, for this project only. */
  cyclesByName: Record<string, string>;
  /** Tester name or email → systemuser id. */
  testersByName: Record<string, string>;
}

export interface RowIssue {
  /** The row number in the operator's own file. */
  sourceRow: number;
  /** The heading the operator mapped, or null when the problem is the row as a whole. */
  column: string | null;
  reason: string;
}

export interface ValidatedRow {
  sourceRow: number;
  /** The staged row's Dataverse id, when validating rows read back from staging. */
  rowId?: string;
  /** Ready to spread into a create, with every bind resolved. */
  payload: UatTestCaseCreate;
}

export interface ValidationResult {
  valid: ValidatedRow[];
  /** One entry per row that cannot be written, with every reason it failed. */
  invalid: { sourceRow: number; rowId?: string; reasons: RowIssue[] }[];
  /** Every issue, flat, in source-row order — what the wizard lists. */
  issues: RowIssue[];
}

/** A staged row as validation sees it: its number, its values, and its Dataverse id. */
export interface RowToValidate extends ParsedRow {
  rowId?: string;
}

const normalise = (value: string) => value.trim().toLowerCase();

/** Parse a date the way a spreadsheet actually hands one over. */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // ISO first — the parser already normalises real Excel dates to this.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    // Rejects 2026-02-31: Date rolls it forward, so the round trip is the check.
    return date.toISOString().slice(0, 10) === text ? text : null;
  }
  // Then unambiguous slash forms with a 4-digit year. A 2-digit year is REFUSED rather
  // than guessed: '03/04/26' has three plausible readings and none of them is safe.
  const slash = /^(\d{1,2})[/](\d{1,2})[/](\d{4})$/.exec(text);
  if (slash) {
    const [, first, second, year] = slash;
    const month = Number(first);
    const day = Number(second);
    // Month-first is the tenant's locale (en-US). A first part above 12 cannot be a month,
    // so it is read as a day rather than silently producing the wrong date.
    const [m, d] = month > 12 ? [day, month] : [month, day];
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(Number(year), m - 1, d));
    const formatted = date.toISOString().slice(0, 10);
    return Number(formatted.slice(5, 7)) === m && Number(formatted.slice(8, 10)) === d
      ? formatted
      : null;
  }
  return null;
}

/** Resolve a priority label to its platform integer, case- and space-insensitively. */
export function parsePriority(raw: string): number | null {
  const text = normalise(raw);
  if (!text) return null;
  for (const [value, label] of Object.entries(UAT_PRIORITY_LABELS)) {
    if (normalise(label) === text) return Number(value);
  }
  // A bare integer is accepted only if it is a real member — never as a literal to trust.
  const asNumber = Number(text);
  if (Number.isInteger(asNumber) && Object.values(UAT_PRIORITY).includes(asNumber as never)) {
    return asNumber;
  }
  return null;
}

/**
 * Validate every staged row against the mapping and the reference data.
 *
 * One pass, no early exit: a row that fails does not stop the rows after it, and a row that
 * fails for two reasons reports both. The legacy import stopped at the first failure, which
 * is why nobody ever saw the second one.
 */
export function validateStagedRows(
  rows: RowToValidate[],
  /** Heading → target field. Built by hand in the wizard (T037). */
  mapping: Record<string, string>,
  references: ImportReferences,
): ValidationResult {
  const cycles = new Map(Object.entries(references.cyclesByName).map(([k, v]) => [normalise(k), v]));
  const testers = new Map(Object.entries(references.testersByName).map(([k, v]) => [normalise(k), v]));

  // Heading → spec, built once. An unmapped heading is simply not read.
  const mapped: { column: string; spec: ImportFieldSpec }[] = [];
  for (const [column, field] of Object.entries(mapping)) {
    const spec = FIELD_BY_NAME.get(field);
    if (spec) mapped.push({ column, spec });
  }

  const valid: ValidatedRow[] = [];
  const invalid: ValidationResult['invalid'] = [];
  const issues: RowIssue[] = [];

  for (const row of rows) {
    const reasons: RowIssue[] = [];
    const payload: Record<string, unknown> = { pmo_source: UAT_SOURCE.Import };
    const fail = (column: string | null, reason: string) =>
      reasons.push({ sourceRow: row.sourceRow, column, reason });

    for (const { column, spec } of mapped) {
      const raw = (row.values[column] ?? '').trim();

      if (!raw) {
        if (spec.required) fail(column, `${spec.label} is required and this row's ${column} is empty.`);
        continue;
      }
      if (spec.maxLength && raw.length > spec.maxLength) {
        fail(column, `${spec.label} is ${raw.length} characters; the limit is ${spec.maxLength}. `
          + 'Shorten it in the file and retry this row.');
        continue;
      }

      switch (spec.kind) {
        case 'text':
        case 'multiline':
          payload[spec.field] = raw;
          break;
        case 'integer': {
          // Plain digits only, NOT Number(): `Number` reads '1e3' as 1000, '0x10' as 16 and
          // ' 12 ' as 12, so a cell holding something odd would become a plausible number
          // nobody typed. That silent-wrong-value class is what this phase exists to end.
          if (!/^\d+$/.test(raw)) {
            fail(column, `${spec.label} must be a whole number of zero or more; this row has "${raw}".`);
          }
          else payload[spec.field] = Number(raw);
          break;
        }
        case 'date': {
          const value = parseImportDate(raw);
          if (!value) {
            fail(column, `${spec.label} "${raw}" is not a date this import can read. Use `
              + 'YYYY-MM-DD, or a slash date with a four-digit year.');
          }
          else payload[spec.field] = value;
          break;
        }
        case 'priority': {
          const value = parsePriority(raw);
          if (value === null) {
            fail(column, `${spec.label} "${raw}" is not one of `
              + `${Object.values(UAT_PRIORITY_LABELS).join(', ')}.`);
          }
          else payload[spec.field] = value;
          break;
        }
        case 'cycle': {
          // The reference check that legacy defect 5 was made of. Resolved here or refused
          // here; there is no path that reaches a write with an unresolved id.
          const id = cycles.get(normalise(raw));
          if (!id) {
            fail(column, `No cycle called "${raw}" exists in this project. Create the cycle `
              + 'first, or clear the cell to import the case without one.');
          }
          else payload['pmo_Cycle@odata.bind'] = `/${UAT_ENTITY_SETS.cycle}(${id})`;
          break;
        }
        case 'tester': {
          const id = testers.get(normalise(raw));
          if (!id) {
            fail(column, `No user matches "${raw}". Use the tester's full name or email exactly `
              + 'as it appears in the app, or clear the cell.');
          }
          else payload['pmo_AssignedTester@odata.bind'] = `/systemusers(${id})`;
          break;
        }
      }
    }

    // A required field that was never mapped at all is a row-level problem, not a cell one:
    // the operator mapped the file wrongly, and saying so against every row is the honest
    // report — 50 rows with no Title column is 50 rows that cannot be created.
    for (const spec of IMPORT_TARGET_FIELDS) {
      if (!spec.required) continue;
      if (payload[spec.field] === undefined && !reasons.some((r) => r.reason.includes(spec.label))) {
        fail(null, `${spec.label} is required, and no column is mapped to it.`);
      }
    }

    if (reasons.length > 0) {
      invalid.push({ sourceRow: row.sourceRow, rowId: row.rowId, reasons });
      issues.push(...reasons);
    }
    else {
      // Cast through unknown: the payload is assembled key by key, and `pmo_title`'s
      // presence is guaranteed by the required-field pass above rather than by the type.
      valid.push({
        sourceRow: row.sourceRow,
        rowId: row.rowId,
        payload: payload as unknown as UatTestCaseCreate,
      });
    }
  }

  issues.sort((a, b) => a.sourceRow - b.sourceRow);
  return { valid, invalid, issues };
}

/**
 * Would this payload produce an empty bind? Never, if validation built it — and this is the
 * guard that says so at the write, where it matters.
 *
 * Exported and called by the commit loop rather than trusted, because "validation ran" is a
 * claim about a previous step and an empty bind is a 400 in this one.
 */
export function hasEmptyBind(payload: object): boolean {
  return Object.entries(payload).some(
    ([key, value]) => key.endsWith('@odata.bind')
      && (value === null || value === undefined || String(value).trim() === ''
        || /\(\s*\)$/.test(String(value))),
  );
}
