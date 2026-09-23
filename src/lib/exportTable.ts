import { toast } from '../hooks/useToast';

export interface ExportColumn<T> {
  header: string;
  getValue: (row: T) => string | number | null | undefined;
}

export interface ExportRowsOptions<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  /** Full download file name, e.g. "Projects 2026-08-11.xlsx". */
  fileName: string;
  /** Worksheet tab name. Excel caps this at 31 chars; longer names are trimmed. */
  sheetName?: string;
}

// Excel worksheet names are limited to 31 characters and may not contain
// any of these characters. We sanitize rather than let the library throw.
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

function safeSheetName(name: string): string {
  const cleaned = name.replace(INVALID_SHEET_CHARS, ' ').trim();
  return (cleaned || 'Export').slice(0, 31);
}

/** Column width bounds — a single long value must not blow the sheet out. */
export const MIN_COLUMN_WIDTH = 8;
export const MAX_COLUMN_WIDTH = 60;

/**
 * Hand a workbook's bytes to the browser as a download.
 *
 * Extracted and exported so a test can assert what was produced without a real download,
 * and because this is the one part ExcelJS does not do for us: SheetJS had `writeFile`,
 * which built the anchor itself. The object URL is revoked on the next tick — not
 * immediately, because the click is asynchronous and a revoked URL downloads nothing.
 */
export async function downloadWorkbook(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    await Promise.resolve();
    URL.revokeObjectURL(url);
  }
}

/**
 * Build a real .xlsx workbook from a set of rows + columns and trigger a
 * browser download. Fully client-side — no server or Power Automate.
 *
 * **ExcelJS, not SheetJS.** The owner decided this on 2026-08-31 (G-PARSER): Snyk's HIGH
 * advisory for `xlsx` records no fixed version at any release, and it matches on package
 * name and version rather than on registry origin, so every rung of the SheetJS ladder —
 * including 0.20.3 from the vendor's own CDN — installs something called `xlsx` and carries
 * the identical finding. ExcelJS is not flagged.
 *
 * The library is imported dynamically so it is code-split out of the initial bundle and
 * only fetched the first time a user actually exports.
 *
 * Numbers are written as numbers (so Excel treats them numerically); every
 * other value is coerced to a string. Null/undefined become an empty cell.
 */
export async function exportRowsToXlsx<T>({
  rows,
  columns,
  fileName,
  sheetName = 'Export',
}: ExportRowsOptions<T>): Promise<void> {
  if (rows.length === 0) {
    toast.info('Nothing to export — no rows match the current filters.');
    return;
  }

  let ExcelJS: typeof import('exceljs');
  try {
    ExcelJS = await import('exceljs');
  } catch {
    toast.error('Export unavailable — could not load the spreadsheet library.', {
      action: 'exportRowsToXlsx',
    });
    return;
  }

  const header = columns.map((c) => c.header);
  const body = rows.map((row) =>
    columns.map((col) => {
      const raw = col.getValue(row);
      if (raw == null) return '';
      return typeof raw === 'number' ? raw : String(raw);
    }),
  );

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(safeSheetName(sheetName));
  worksheet.addRow(header);
  for (const line of body) worksheet.addRow(line);

  // Auto-size columns from the widest cell in each column, clamped.
  worksheet.columns.forEach((column, colIndex) => {
    let widest = header[colIndex].length;
    for (const line of body) {
      const length = String(line[colIndex] ?? '').length;
      if (length > widest) widest = length;
    }
    column.width = Math.min(Math.max(widest + 2, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  await downloadWorkbook(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName,
  );

  toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${fileName}.`);
}
