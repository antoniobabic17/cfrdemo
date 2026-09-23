/**
 * exportTable + ExcelJS round trip.
 *
 * **These four tests are carried across from PR #38, and they are why the migration is
 * safe to make.** That PR added them for the SheetJS 0.18.5 → 0.20.3 swap, observing that
 * the 537 tests then in the suite covered `exportTable.ts` not at all and imported the
 * spreadsheet library nowhere — so `tsc` and `npm run build` were the only evidence that
 * the app's ONLY spreadsheet consumer survived a library replacement, and neither of those
 * proves a workbook is readable. PR #38 was closed unmerged when its premise turned out to
 * be wrong (Snyk matches on package name and version, so no SheetJS release clears the
 * finding), but its tests were the right work and are the only coverage this file has.
 *
 * The claims are unchanged; the surface they are asserted against is ExcelJS. Deliberately
 * NOT rewritten to be gentler: the round trip still serializes real bytes and reads them
 * back, because "it compiled" is exactly what was insufficient last time.
 *
 * `exportRowsToXlsx` ends in a browser download, so the two browser primitives it needs are
 * stubbed — `URL.createObjectURL`, which jsdom does not implement, and the anchor click —
 * and the real blob handed to the former is re-parsed. Stubbing the BROWSER rather than the
 * library or the module's own download helper keeps the whole production path inside the
 * test: workbook build, column sizing, serialization, blob, anchor and file name. (Mocking
 * `downloadWorkbook` through a self-mock of this module does not work and is worth
 * recording: an internal call site holds a direct binding, so the export was replaced and
 * the real function still ran.)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('../hooks/useToast', () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  exportRowsToXlsx,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  type ExportColumn,
} from './exportTable';

let downloadedBlob: Blob | null = null;
let downloadedName: string | null = null;

interface Row {
  name: string;
  amount: number | null;
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Name', getValue: (r) => r.name },
  { header: 'Amount', getValue: (r) => r.amount },
];

const ROWS: Row[] = [
  { name: 'Alpha', amount: 1234 },
  { name: 'Beta', amount: null },
  { name: 'Gamma with a deliberately long value to exercise column sizing', amount: -7 },
];

/** Re-read the blob the export handed to the browser, as Excel would. */
async function rereadWorkbook(): Promise<ExcelJS.Workbook> {
  if (!downloadedBlob) throw new Error('No workbook was downloaded.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloadedBlob.arrayBuffer());
  return workbook;
}

beforeEach(() => {
  downloadedBlob = null;
  downloadedName = null;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloadedBlob = blob;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadedName = this.getAttribute('download');
  });
});

describe('exportTable + ExcelJS round trip', () => {
  it('produces a parseable workbook whose cells round-trip', async () => {
    await exportRowsToXlsx({
      rows: ROWS,
      columns: COLUMNS,
      fileName: 'Round Trip 2026-08-29.xlsx',
      sheetName: 'Sheet/One:Two',
    });

    expect(downloadedBlob).toBeTruthy();
    expect(downloadedName).toBe('Round Trip 2026-08-29.xlsx');

    const workbook = await rereadWorkbook();
    // Invalid sheet-name characters are sanitized, and the name is capped at 31.
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Sheet One Two');
    expect(sheet.name.length).toBeLessThanOrEqual(31);

    const value = (row: number, col: number) => sheet.getRow(row).getCell(col).value;
    expect([value(1, 1), value(1, 2)]).toEqual(['Name', 'Amount']);
    expect([value(2, 1), value(2, 2)]).toEqual(['Alpha', 1234]);
    // Null becomes an empty cell, not the string "null".
    expect(value(3, 1)).toBe('Beta');
    expect(value(3, 2) ?? '').toBe('');
    expect(value(4, 2)).toBe(-7);
  });

  it('writes numbers as numbers and everything else as strings', async () => {
    await exportRowsToXlsx({
      rows: [{ name: '007', amount: 42 }],
      columns: COLUMNS,
      fileName: 'Types.xlsx',
    });

    const sheet = (await rereadWorkbook()).worksheets[0];
    // A2 is the string "007" — coerced, so a leading zero is not eaten.
    expect(sheet.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getRow(2).getCell(1).value).toBe('007');
    // B2 is a true number, so Excel treats it numerically.
    expect(sheet.getRow(2).getCell(2).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.getRow(2).getCell(2).value).toBe(42);
  });

  it('sets column widths within the clamped range', async () => {
    await exportRowsToXlsx({ rows: ROWS, columns: COLUMNS, fileName: 'Cols.xlsx' });

    const sheet = (await rereadWorkbook()).worksheets[0];
    const widths = sheet.columns.map((c) => c.width);

    expect(widths).toHaveLength(2);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
      expect(width).toBeLessThanOrEqual(MAX_COLUMN_WIDTH);
    }
    // The long third row drives the Name column to the 60 cap.
    expect(widths[0]).toBe(MAX_COLUMN_WIDTH);
  });

  it('exports nothing and does not build a workbook when there are no rows', async () => {
    await exportRowsToXlsx({ rows: [], columns: COLUMNS, fileName: 'Empty.xlsx' });

    expect(downloadedBlob).toBeNull();
    expect(downloadedName).toBeNull();
  });
});
