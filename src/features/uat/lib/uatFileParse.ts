/**
 * Parse an uploaded `.xlsx` or `.csv` into a header list plus row objects.
 *
 * **Every failure is named.** The legacy import's defining behaviour was reporting success
 * while producing nothing, so this module has no path that returns an empty result quietly:
 * an unreadable file, a file with no rows, a file with only a header, a file with ambiguous
 * headers — each throws a `UatParseError` carrying a code and a sentence a tester can act
 * on. A silent empty result is the defect, not a state.
 *
 * **Source row numbers are carried, not recomputed.** `sourceRow` is the row number as the
 * spreadsheet shows it — 1-based, header included — because that is the number the tester
 * looks at, and T036 has to report "row 47" about the row the tester can find. Blank
 * interior rows are dropped but the numbers do NOT close up behind them.
 *
 * **ExcelJS, loaded dynamically.** The library is ~900 KB and is code-split so it is
 * fetched only when someone actually imports or exports. `exportTable.ts` records why it is
 * ExcelJS and not SheetJS (G-PARSER, owner decision 2026-08-31).
 */
import { UAT_MAX_FILE_BYTES, formatBytes } from './uatEvidence';

export type UatParseErrorCode =
  | 'file-too-large'
  | 'unsupported-type'
  | 'empty-file'
  | 'unreadable-file'
  | 'no-header-row'
  | 'no-data-rows'
  | 'duplicate-headers'
  | 'too-many-rows';

/** A parse failure with a code to branch on and a message to show. */
export class UatParseError extends Error {
  readonly code: UatParseErrorCode;
  constructor(code: UatParseErrorCode, message: string) {
    super(message);
    this.name = 'UatParseError';
    this.code = code;
  }
}

export interface ParsedRow {
  /** 1-based row number as the spreadsheet displays it, header row included. */
  sourceRow: number;
  /** Header name → cell text. Every header is present, '' for an empty cell. */
  values: Record<string, string>;
}

export interface ParsedSheet {
  headers: string[];
  rows: ParsedRow[];
  /** Things a tester should know that are not failures — blank rows, named columns. */
  warnings: string[];
  /** The worksheet the rows came from, or null for a CSV. */
  sheetName: string | null;
}

/**
 * Row ceiling for one import.
 *
 * A stated refusal rather than a silent truncation, for the same reason FR-033a gives about
 * page size: a file that imports 10,000 of its 12,000 rows and says nothing is the legacy
 * failure wearing a different hat. 10,000 is well above the largest legacy batch (the whole
 * legacy test table holds 20,646 rows accumulated over years) and low enough that the
 * browser can hold every staged row while the user reviews them.
 */
export const MAX_IMPORT_ROWS = 10_000;

/**
 * Size ceiling, shared with evidence on purpose: T041 archives the import source file
 * through the evidence path, so a file this parser accepted but the archive would reject
 * could be imported and then not kept. One number, one behaviour.
 */
export const MAX_IMPORT_BYTES = UAT_MAX_FILE_BYTES;

const XLSX_EXTENSIONS = ['.xlsx'];
const CSV_EXTENSIONS = ['.csv'];

/** 'xlsx' | 'csv' from the file name, or null when it is neither. */
export function importKindOf(fileName: string): 'xlsx' | 'csv' | null {
  const lower = fileName.toLowerCase();
  if (XLSX_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'xlsx';
  if (CSV_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'csv';
  return null;
}

/**
 * Split CSV text into rows of fields, RFC 4180 style.
 *
 * Hand-written rather than another dependency, and it handles the three things that make a
 * naive `split(',')` lose data: quoted fields containing commas, quoted fields containing
 * NEWLINES (which is what turns one row into two and shifts every column after it), and
 * doubled quotes as an escaped quote. CRLF, LF and a leading BOM are all accepted because
 * every one of them arrives from Excel's own "Save as CSV".
 */
export function splitCsvRows(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      }
      else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') {
      // Bare CR is a row break too — old Mac exports still exist.
      if (source[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
      continue;
    }
    if (char === '\n') { row.push(field); field = ''; rows.push(row); row = []; continue; }
    field += char;
  }
  // A file not ending in a newline still has a last row; one that does must not gain a
  // phantom empty row.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** ExcelJS cell values are a union of eight shapes; this is the one string form. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) {
    // Date-only, in ISO order. A locale-formatted date is the classic import ambiguity:
    // 03/04 is two different days depending on who exported the file.
    return value.toISOString().slice(0, 10);
  }
  const bag = value as Record<string, unknown>;
  if (typeof bag.text === 'string') return bag.text.trim();               // hyperlink
  if (Array.isArray(bag.richText)) {
    return bag.richText.map((part) => String((part as { text?: string }).text ?? '')).join('').trim();
  }
  if ('result' in bag) return cellToString(bag.result);                    // formula
  if ('error' in bag) return String(bag.error);                           // #REF! etc, shown
  return String(value).trim();
}

/**
 * Name the headers, refusing an ambiguous set.
 *
 * A blank header cell is NAMED (`Column 3`) with a warning rather than refused: a trailing
 * empty column is common and harmless, and T037 lets the user map columns by hand anyway.
 * A repeated non-empty name IS refused, because two columns called "Title" make every later
 * mapping ambiguous and picking one silently is how a column's data disappears.
 */
function resolveHeaders(raw: string[], warnings: string[]): string[] {
  const headers = raw.map((cell, index) => {
    const name = cell.trim();
    if (name) return name;
    const named = `Column ${index + 1}`;
    warnings.push(`Column ${index + 1} has no heading; it is shown as "${named}".`);
    return named;
  });

  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  headers.forEach((name, index) => {
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else duplicates.push(`"${name}" appears in column ${first + 1} and column ${index + 1}`);
  });
  if (duplicates.length > 0) {
    throw new UatParseError(
      'duplicate-headers',
      `This file has repeated column headings, so a column cannot be mapped without guessing: `
      + `${duplicates.join('; ')}. Rename them so each heading is unique and upload it again.`,
    );
  }
  return headers;
}

/**
 * Turn a rectangle of cell text into the parse result.
 *
 * Shared by both formats, so a CSV and an XLSX of the same content produce the same rows —
 * including the same row numbers and the same refusals. The legacy import was locked to two
 * fixed view column contracts; nothing here knows what a column MEANS.
 */
function buildSheet(grid: string[][], sheetName: string | null): ParsedSheet {
  const warnings: string[] = [];
  const isBlank = (cells: string[]) => cells.every((cell) => cell.trim() === '');

  // Leading blank rows are skipped to find the header — an exported file often has a title
  // row above it — and the row numbers still refer to the real spreadsheet.
  const headerIndex = grid.findIndex((cells) => !isBlank(cells));
  if (headerIndex === -1) {
    throw new UatParseError(
      'empty-file',
      'This file has no rows in it. Nothing was imported.',
    );
  }
  if (headerIndex > 0) {
    warnings.push(`The first ${headerIndex} row${headerIndex === 1 ? '' : 's'} `
      + `${headerIndex === 1 ? 'was' : 'were'} empty and skipped; headings were read from row `
      + `${headerIndex + 1}.`);
  }

  const headers = resolveHeaders(grid[headerIndex], warnings);

  const rows: ParsedRow[] = [];
  const blankRows: number[] = [];
  for (let index = headerIndex + 1; index < grid.length; index++) {
    const cells = grid[index];
    const sourceRow = index + 1;                      // 1-based, as the spreadsheet shows it
    if (isBlank(cells)) { blankRows.push(sourceRow); continue; }
    const values: Record<string, string> = {};
    headers.forEach((name, column) => { values[name] = (cells[column] ?? '').trim(); });
    rows.push({ sourceRow, values });
  }

  if (blankRows.length > 0) {
    // Reported, not silent: a blank row in the middle of a file is usually a mistake in the
    // file, and the tester is the only one who can tell.
    warnings.push(`${blankRows.length} empty row${blankRows.length === 1 ? '' : 's'} `
      + `skipped (row${blankRows.length === 1 ? '' : 's'} ${blankRows.join(', ')}).`);
  }

  if (rows.length === 0) {
    throw new UatParseError(
      'no-data-rows',
      `This file has column headings (${headers.join(', ')}) but no data rows beneath them. `
      + 'Nothing was imported.',
    );
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new UatParseError(
      'too-many-rows',
      `This file has ${rows.length.toLocaleString()} rows. The limit for one import is `
      + `${MAX_IMPORT_ROWS.toLocaleString()} — split it and import the parts, so that every row `
      + 'is accounted for rather than some being dropped.',
    );
  }

  return { headers, rows, warnings, sheetName };
}

/** Read an .xlsx file's first worksheet into a grid of cell text. */
async function gridFromXlsx(file: File): Promise<{ grid: string[][]; sheetName: string }> {
  let ExcelJS: typeof import('exceljs');
  try {
    ExcelJS = await import('exceljs');
  } catch {
    throw new UatParseError(
      'unreadable-file',
      'The spreadsheet reader could not be loaded, so this file was not opened. Try again, or '
      + 'save the file as CSV and upload that.',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch (error) {
    // The library's own message is included: "not a zip file" and "corrupt" mean different
    // things to whoever has to fix the file.
    throw new UatParseError(
      'unreadable-file',
      `"${file.name}" could not be opened as a spreadsheet (${error instanceof Error ? error.message : String(error)}). `
      + 'If it was renamed to .xlsx from another format, save it as a real Excel file or as CSV.',
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new UatParseError('empty-file', `"${file.name}" contains no worksheets.`);
  }

  const grid: string[][] = [];
  // rowCount rather than eachRow: eachRow SKIPS empty rows, which would silently close the
  // gaps this module reports and shift every source row number after a blank one.
  const width = Math.max(worksheet.columnCount, 1);
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let column = 1; column <= width; column++) {
      cells.push(cellToString(row.getCell(column).value));
    }
    grid.push(cells);
  }
  return { grid, sheetName: worksheet.name };
}

/**
 * Parse an uploaded import file. Throws `UatParseError` with a code on every failure.
 *
 * The refusals happen in order of cheapness: type, then size, then content. Reading a
 * 9 MB file to discover it is a `.docx` is work nobody needs done.
 */
export async function parseImportFile(file: File): Promise<ParsedSheet> {
  const kind = importKindOf(file.name);
  if (!kind) {
    throw new UatParseError(
      'unsupported-type',
      `"${file.name}" is not a spreadsheet this import can read. Upload an .xlsx or .csv file.`,
    );
  }
  if (file.size === 0) {
    throw new UatParseError('empty-file', `"${file.name}" is empty (0 bytes).`);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new UatParseError(
      'file-too-large',
      `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMPORT_BYTES)} `
      + '— split it into smaller files and import them one at a time.',
    );
  }

  if (kind === 'csv') {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      throw new UatParseError(
        'unreadable-file',
        `"${file.name}" could not be read (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
    return buildSheet(splitCsvRows(text), null);
  }

  const { grid, sheetName } = await gridFromXlsx(file);
  return buildSheet(grid, sheetName);
}
