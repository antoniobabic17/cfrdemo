/**
 * formulaFunctions — curated Excel-compatible function table for the custom
 * column formula engine.
 *
 * Wraps @formulajs/formulajs (MIT) with a tightly-scoped, documented set of
 * functions appropriate for a PMO data grid. Functions are grouped by category
 * for the formula-bar autocomplete UI.
 *
 * Design decisions:
 *   - All formulajs functions are called with their exact signature; the engine
 *     passes already-typed arguments (numbers, booleans, Date/ISO strings).
 *   - Date functions that formulajs returns as raw date-serial numbers are
 *     wrapped to return ISO strings instead (consistent with what `readCellValue`
 *     feeds back in for field references).
 *   - TODAY/NOW return ISO strings so they can be compared against date fields.
 *   - IFERROR catches any thrown error and returns the second argument.
 *   - All functions are evaluated per-row; no range / multi-cell semantics.
 */

import * as FJS from '@formulajs/formulajs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => unknown;

/** ISO string for a JS Date */
function toISO(d: Date): string {
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Coerce a value to a JS Date (accepts ISO string, JS Date, serial number). */
function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial: days since 1899-12-30
    return new Date((v - 25569) * 86400 * 1000);
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

/** Return value as number, or 0 if not coercible. */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// ─── Function categories (used by the formula-bar autocomplete UI) ────────────

export interface FormulaFunctionMeta {
  fn: Fn;
  /** One-line signature shown in autocomplete hint. */
  signature: string;
  /** Short description for the tooltip. */
  description: string;
  category: 'text' | 'logical' | 'math' | 'date';
}

export const FORMULA_FUNCTIONS: Record<string, FormulaFunctionMeta> = {
  // ── Text ────────────────────────────────────────────────────────────────────
  CONCATENATE: {
    fn: (...args: unknown[]) => FJS.CONCATENATE(...args),
    signature: 'CONCATENATE(text1, text2, ...)',
    description: 'Join text values together.',
    category: 'text',
  },
  LEFT: {
    fn: (text: unknown, n: unknown) => FJS.LEFT(String(text ?? ''), toNum(n)),
    signature: 'LEFT(text, num_chars)',
    description: 'First N characters of text.',
    category: 'text',
  },
  RIGHT: {
    fn: (text: unknown, n: unknown) => FJS.RIGHT(String(text ?? ''), toNum(n)),
    signature: 'RIGHT(text, num_chars)',
    description: 'Last N characters of text.',
    category: 'text',
  },
  MID: {
    fn: (text: unknown, start: unknown, n: unknown) =>
      FJS.MID(String(text ?? ''), toNum(start), toNum(n)),
    signature: 'MID(text, start, num_chars)',
    description: 'Extract N characters from position start.',
    category: 'text',
  },
  UPPER: {
    fn: (text: unknown) => FJS.UPPER(String(text ?? '')),
    signature: 'UPPER(text)',
    description: 'Convert text to uppercase.',
    category: 'text',
  },
  LOWER: {
    fn: (text: unknown) => FJS.LOWER(String(text ?? '')),
    signature: 'LOWER(text)',
    description: 'Convert text to lowercase.',
    category: 'text',
  },
  TRIM: {
    fn: (text: unknown) => FJS.TRIM(String(text ?? '')),
    signature: 'TRIM(text)',
    description: 'Remove leading, trailing, and extra spaces.',
    category: 'text',
  },
  LEN: {
    fn: (text: unknown) => FJS.LEN(String(text ?? '')),
    signature: 'LEN(text)',
    description: 'Number of characters in text.',
    category: 'text',
  },
  SUBSTITUTE: {
    fn: (text: unknown, old: unknown, replacement: unknown, instance?: unknown) =>
      FJS.SUBSTITUTE(String(text ?? ''), String(old ?? ''), String(replacement ?? ''),
        instance !== undefined ? toNum(instance) : undefined),
    signature: 'SUBSTITUTE(text, old_text, new_text, [instance])',
    description: 'Replace occurrences of old_text with new_text.',
    category: 'text',
  },
  REPLACE: {
    fn: (text: unknown, start: unknown, n: unknown, replacement: unknown) =>
      FJS.REPLACE(String(text ?? ''), toNum(start), toNum(n), String(replacement ?? '')),
    signature: 'REPLACE(text, start, num_chars, new_text)',
    description: 'Replace part of text at a specific position.',
    category: 'text',
  },
  TEXT: {
    fn: (value: unknown, format: unknown) => {
      const fmt = String(format ?? '');
      // formulajs TEXT needs a real Date object for date-format tokens
      // (y/m/d/h/s). A field value arrives as an ISO string, so detect a
      // date format and coerce the value to a Date first.
      if (/[ymdhsYMDHS]/.test(fmt) && typeof value !== 'number') {
        const d = toDate(value);
        if (!isNaN(d.getTime())) return FJS.TEXT(d, fmt);
      }
      return FJS.TEXT(value, fmt);
    },
    signature: 'TEXT(value, format)',
    description: 'Format a value as text using a format string, e.g. TEXT([Date],"MM/YYYY").',
    category: 'text',
  },
  VALUE: {
    fn: (text: unknown) => FJS.VALUE(String(text ?? '')),
    signature: 'VALUE(text)',
    description: 'Convert text representing a number to a number.',
    category: 'text',
  },
  FIND: {
    fn: (search: unknown, text: unknown, start?: unknown) =>
      FJS.FIND(String(search ?? ''), String(text ?? ''),
        start !== undefined ? toNum(start) : 1),
    signature: 'FIND(find_text, within_text, [start])',
    description: 'Position of find_text within within_text (case-sensitive).',
    category: 'text',
  },
  SEARCH: {
    fn: (search: unknown, text: unknown, start?: unknown) =>
      FJS.SEARCH(String(search ?? ''), String(text ?? ''),
        start !== undefined ? toNum(start) : 1),
    signature: 'SEARCH(find_text, within_text, [start])',
    description: 'Position of find_text within within_text (case-insensitive).',
    category: 'text',
  },

  // ── Logical ─────────────────────────────────────────────────────────────────
  IF: {
    fn: (condition: unknown, ifTrue: unknown, ifFalse: unknown) =>
      FJS.IF(condition, ifTrue, ifFalse),
    signature: 'IF(condition, value_if_true, value_if_false)',
    description: 'Returns one of two values depending on condition.',
    category: 'logical',
  },
  IFS: {
    fn: (...args: unknown[]) => FJS.IFS(...args),
    signature: 'IFS(condition1, value1, condition2, value2, ...)',
    description: 'Returns the first value whose condition is true.',
    category: 'logical',
  },
  AND: {
    fn: (...args: unknown[]) => FJS.AND(...args),
    signature: 'AND(condition1, condition2, ...)',
    description: 'Returns TRUE if all conditions are true.',
    category: 'logical',
  },
  OR: {
    fn: (...args: unknown[]) => FJS.OR(...args),
    signature: 'OR(condition1, condition2, ...)',
    description: 'Returns TRUE if any condition is true.',
    category: 'logical',
  },
  NOT: {
    fn: (condition: unknown) => FJS.NOT(condition),
    signature: 'NOT(condition)',
    description: 'Reverses a logical value.',
    category: 'logical',
  },
  IFERROR: {
    fn: (value: unknown, valueIfError: unknown) => {
      try {
        // formulajs IFERROR expects an actual value (not a thrown error).
        // The formula engine already catches throws at call sites, but we
        // also wrap here so IFERROR(some_expr, "fallback") works in the AST.
        return FJS.IFERROR(value, valueIfError);
      } catch {
        return valueIfError;
      }
    },
    signature: 'IFERROR(value, value_if_error)',
    description: 'Returns value_if_error if value throws an error.',
    category: 'logical',
  },
  SWITCH: {
    fn: (...args: unknown[]) => FJS.SWITCH(...args),
    signature: 'SWITCH(expression, value1, result1, [value2, result2, ...], [default])',
    description: 'Returns the result matching the first value that equals expression.',
    category: 'logical',
  },
  CHOOSE: {
    fn: (index: unknown, ...choices: unknown[]) => FJS.CHOOSE(toNum(index), ...choices),
    signature: 'CHOOSE(index, value1, value2, ...)',
    description: 'Returns the value at position index in the list.',
    category: 'logical',
  },

  // ── Math ────────────────────────────────────────────────────────────────────
  SUM: {
    fn: (...args: unknown[]) => FJS.SUM(...args),
    signature: 'SUM(number1, number2, ...)',
    description: 'Add numbers together.',
    category: 'math',
  },
  ROUND: {
    fn: (n: unknown, digits: unknown) => FJS.ROUND(toNum(n), toNum(digits)),
    signature: 'ROUND(number, num_digits)',
    description: 'Round a number to num_digits decimal places.',
    category: 'math',
  },
  ROUNDUP: {
    fn: (n: unknown, digits: unknown) => FJS.ROUNDUP(toNum(n), toNum(digits)),
    signature: 'ROUNDUP(number, num_digits)',
    description: 'Round a number up.',
    category: 'math',
  },
  ROUNDDOWN: {
    fn: (n: unknown, digits: unknown) => FJS.ROUNDDOWN(toNum(n), toNum(digits)),
    signature: 'ROUNDDOWN(number, num_digits)',
    description: 'Round a number down.',
    category: 'math',
  },
  ABS: {
    fn: (n: unknown) => FJS.ABS(toNum(n)),
    signature: 'ABS(number)',
    description: 'Absolute value.',
    category: 'math',
  },
  MIN: {
    fn: (...args: unknown[]) => FJS.MIN(...args),
    signature: 'MIN(number1, number2, ...)',
    description: 'Smallest value.',
    category: 'math',
  },
  MAX: {
    fn: (...args: unknown[]) => FJS.MAX(...args),
    signature: 'MAX(number1, number2, ...)',
    description: 'Largest value.',
    category: 'math',
  },
  AVERAGE: {
    fn: (...args: unknown[]) => FJS.AVERAGE(...args),
    signature: 'AVERAGE(number1, number2, ...)',
    description: 'Average of numbers.',
    category: 'math',
  },

  // ── Date ────────────────────────────────────────────────────────────────────
  TODAY: {
    fn: () => toISO(new Date()),
    signature: 'TODAY()',
    description: "Today's date as YYYY-MM-DD.",
    category: 'date',
  },
  NOW: {
    fn: () => new Date().toISOString(),
    signature: 'NOW()',
    description: 'Current date and time as an ISO string.',
    category: 'date',
  },
  YEAR: {
    fn: (v: unknown) => {
      const d = toDate(v);
      return isNaN(d.getTime()) ? '' : d.getUTCFullYear();
    },
    signature: 'YEAR(date)',
    description: 'Extract the year from a date.',
    category: 'date',
  },
  MONTH: {
    fn: (v: unknown) => {
      const d = toDate(v);
      return isNaN(d.getTime()) ? '' : d.getUTCMonth() + 1;
    },
    signature: 'MONTH(date)',
    description: 'Extract the month (1-12) from a date.',
    category: 'date',
  },
  DAY: {
    fn: (v: unknown) => {
      const d = toDate(v);
      return isNaN(d.getTime()) ? '' : d.getUTCDate();
    },
    signature: 'DAY(date)',
    description: 'Extract the day of month from a date.',
    category: 'date',
  },
  DATE: {
    fn: (year: unknown, month: unknown, day: unknown) => {
      const d = new Date(Date.UTC(toNum(year), toNum(month) - 1, toNum(day)));
      return toISO(d);
    },
    signature: 'DATE(year, month, day)',
    description: 'Build a date from year, month, day.',
    category: 'date',
  },
  DATEDIF: {
    fn: (start: unknown, end: unknown, unit: unknown) => {
      const s = toDate(start), e = toDate(end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
      return FJS.DATEDIF(s, e, String(unit ?? 'D'));
    },
    signature: 'DATEDIF(start_date, end_date, unit)',
    description: 'Difference between dates. unit: "D","M","Y".',
    category: 'date',
  },
  EDATE: {
    fn: (date: unknown, months: unknown) => {
      const d = toDate(date);
      if (isNaN(d.getTime())) return '';
      const result = FJS.EDATE(d, toNum(months));
      return toISO(toDate(result));
    },
    signature: 'EDATE(date, months)',
    description: 'Date N months before/after a date.',
    category: 'date',
  },
  EOMONTH: {
    fn: (date: unknown, months: unknown) => {
      const d = toDate(date);
      if (isNaN(d.getTime())) return '';
      const result = FJS.EOMONTH(d, toNum(months));
      return toISO(toDate(result));
    },
    signature: 'EOMONTH(date, months)',
    description: 'Last day of month N months away.',
    category: 'date',
  },
};

/** Sorted alphabetically within each category, for autocomplete display. */
export const FORMULA_FUNCTION_NAMES = Object.keys(FORMULA_FUNCTIONS).sort();

/** Category → sorted function names, for grouped autocomplete. */
export const FORMULA_FUNCTIONS_BY_CATEGORY: Record<string, string[]> = {};
for (const [name, meta] of Object.entries(FORMULA_FUNCTIONS)) {
  (FORMULA_FUNCTIONS_BY_CATEGORY[meta.category] ??= []).push(name);
}
for (const cat of Object.keys(FORMULA_FUNCTIONS_BY_CATEGORY)) {
  FORMULA_FUNCTIONS_BY_CATEGORY[cat].sort();
}
