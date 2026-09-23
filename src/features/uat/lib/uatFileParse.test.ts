/**
 * T034 — the parse module. Every failure is NAMED; nothing returns an empty result quietly.
 *
 * The five cases T034 names are each tested against BOTH formats where the format can
 * express them, because a CSV and an XLSX of the same content must refuse the same way — a
 * parser that is strict about one and permissive about the other is two parsers.
 *
 * The .xlsx cases build real workbooks with ExcelJS and hand the parser real bytes. A fake
 * workbook object would test the mapping and not the reader, and the reader is where the
 * surprises live (empty rows that `eachRow` skips, dates, formulas, rich text).
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseImportFile,
  splitCsvRows,
  importKindOf,
  UatParseError,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
} from './uatFileParse';

function csv(text: string, name = 'cases.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

/** A real .xlsx file from a grid of values — the bytes Excel itself would write. */
async function xlsx(grid: unknown[][], name = 'cases.xlsx', sheetName = 'Cases'): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of grid) sheet.addRow(row as never[]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** The thrown UatParseError, or a failure if nothing was thrown. */
async function refusal(file: File): Promise<UatParseError> {
  try {
    await parseImportFile(file);
  } catch (error) {
    expect(error).toBeInstanceOf(UatParseError);
    return error as UatParseError;
  }
  throw new Error('Expected parseImportFile to refuse this file, but it returned a result.');
}

describe('both formats parse to headers plus row objects', () => {
  it('reads a CSV into headers and rows carrying their source row numbers', async () => {
    const sheet = await parseImportFile(csv('Title,Steps,Owner\nLogin,Open the app,ab\nLogout,Close it,cd\n'));
    expect(sheet.headers).toEqual(['Title', 'Steps', 'Owner']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toEqual({
      sourceRow: 2,
      values: { Title: 'Login', Steps: 'Open the app', Owner: 'ab' },
    });
    expect(sheet.rows[1].sourceRow).toBe(3);
    expect(sheet.sheetName).toBeNull();
  });

  it('reads an .xlsx into the same shape, and names the worksheet', async () => {
    const sheet = await parseImportFile(await xlsx([
      ['Title', 'Steps', 'Owner'],
      ['Login', 'Open the app', 'ab'],
      ['Logout', 'Close it', 'cd'],
    ]));
    expect(sheet.headers).toEqual(['Title', 'Steps', 'Owner']);
    expect(sheet.rows.map((r) => r.sourceRow)).toEqual([2, 3]);
    expect(sheet.rows[0].values.Title).toBe('Login');
    expect(sheet.sheetName).toBe('Cases');
  });

  it('gives a CSV and an .xlsx of the same content the same result', async () => {
    const fromCsv = await parseImportFile(csv('A,B\n1,2\n3,4\n'));
    const fromXlsx = await parseImportFile(await xlsx([['A', 'B'], [1, 2], [3, 4]]));
    expect(fromXlsx.headers).toEqual(fromCsv.headers);
    expect(fromXlsx.rows).toEqual(fromCsv.rows);
  });

  it('reads dates, formulas, rich text and hyperlinks as text a human would recognise', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cases');
    sheet.addRow(['When', 'Sum', 'Rich', 'Link']);
    const row = sheet.addRow([]);
    row.getCell(1).value = new Date(Date.UTC(2026, 7, 31));
    row.getCell(2).value = { formula: 'SUM(1,2)', result: 3 } as never;
    row.getCell(3).value = { richText: [{ text: 'bold' }, { text: ' plain' }] } as never;
    row.getCell(4).value = { text: 'CVS', hyperlink: 'https://example.invalid' } as never;
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'types.xlsx');

    const parsed = await parseImportFile(file);
    expect(parsed.rows[0].values.When).toBe('2026-08-31');   // ISO order, never 08/31 vs 31/08
    expect(parsed.rows[0].values.Sum).toBe('3');
    expect(parsed.rows[0].values.Rich).toBe('bold plain');
    expect(parsed.rows[0].values.Link).toBe('CVS');
  });

  it('accepts a file whose headers match nothing this app knows (T037\'s premise)', async () => {
    // The legacy import was locked to two fixed view column contracts, which is what confined
    // it to one domain. Nothing here knows what a column MEANS.
    const sheet = await parseImportFile(csv('Widget,Sprocket,Zeta\nx,y,z\n'));
    expect(sheet.headers).toEqual(['Widget', 'Sprocket', 'Zeta']);
    expect(sheet.rows).toHaveLength(1);
  });
});

describe('the five refusals T034 names — each stated, none silent', () => {
  it('1. an empty file', async () => {
    expect((await refusal(csv(''))).code).toBe('empty-file');
    expect((await refusal(new File([], 'blank.xlsx'))).code).toBe('empty-file');
    // A file with bytes but no non-blank rows is the same refusal, not an empty success.
    const blankRows = await refusal(csv('\n\n\n'));
    expect(blankRows.code).toBe('empty-file');
    expect(blankRows.message).toMatch(/no rows/i);
  });

  it('2. a header-only file', async () => {
    for (const file of [csv('Title,Steps\n'), await xlsx([['Title', 'Steps']])]) {
      const error = await refusal(file);
      expect(error.code).toBe('no-data-rows');
      // The message names the headings it DID find, so the tester can see it read the file.
      expect(error.message).toContain('Title');
      expect(error.message).toMatch(/no data rows/i);
    }
  });

  it('3. a file with duplicate headers', async () => {
    for (const file of [csv('Title,Steps,Title\na,b,c\n'), await xlsx([['Title', 'Steps', 'Title'], ['a', 'b', 'c']])]) {
      const error = await refusal(file);
      expect(error.code).toBe('duplicate-headers');
      // Both positions named: "rename the duplicate" is not actionable without them.
      expect(error.message).toContain('column 1');
      expect(error.message).toContain('column 3');
    }
  });

  it('3b. treats differently-cased duplicates as duplicates', async () => {
    // "Title" and "title" map to one field name and would silently overwrite each other.
    expect((await refusal(csv('Title,title\na,b\n'))).code).toBe('duplicate-headers');
  });

  it('4. blank interior rows — skipped, reported, and the row numbers do NOT close up', async () => {
    const sheet = await parseImportFile(csv('Title\nA\n\nB\n\n\nC\n'));
    expect(sheet.rows.map((r) => r.values.Title)).toEqual(['A', 'B', 'C']);
    // The whole point: C is on spreadsheet row 7 and must still say 7, or T036 reports a
    // row number the tester cannot find.
    expect(sheet.rows.map((r) => r.sourceRow)).toEqual([2, 4, 7]);
    expect(sheet.warnings.join(' ')).toMatch(/3 empty rows skipped \(rows 3, 5, 6\)/);
  });

  it('4b. keeps blank .xlsx rows visible, which eachRow would have hidden', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cases');
    sheet.getRow(1).getCell(1).value = 'Title';
    sheet.getRow(2).getCell(1).value = 'A';
    sheet.getRow(4).getCell(1).value = 'B';        // row 3 left untouched
    const buffer = await workbook.xlsx.writeBuffer();

    const parsed = await parseImportFile(new File([buffer], 'gaps.xlsx'));
    expect(parsed.rows.map((r) => r.values.Title)).toEqual(['A', 'B']);
    expect(parsed.rows.map((r) => r.sourceRow)).toEqual([2, 4]);
  });

  it('5. a malformed file', async () => {
    // A .docx renamed to .xlsx: real bytes, valid file, wrong format. This is the case that
    // arrives in practice, not a truncated zip.
    const notASpreadsheet = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02])], 'report.xlsx');
    const error = await refusal(notASpreadsheet);
    expect(error.code).toBe('unreadable-file');
    expect(error.message).toContain('report.xlsx');
    // Says what to do about it, not just that it failed.
    expect(error.message).toMatch(/save it as|CSV/i);
  });

  it('refuses an unsupported extension before reading a byte', async () => {
    const error = await refusal(new File(['x'], 'cases.pdf'));
    expect(error.code).toBe('unsupported-type');
    expect(error.message).toMatch(/\.xlsx or \.csv/);
  });

  it('refuses an over-size file with the evidence cap, which T041 will also apply', async () => {
    const big = Object.defineProperty(csv('A\n1\n', 'huge.csv'), 'size', { value: MAX_IMPORT_BYTES + 1 });
    const error = await refusal(big);
    expect(error.code).toBe('file-too-large');
    expect(MAX_IMPORT_BYTES).toBe(10_485_760);
  });

  it('refuses more rows than one import may carry, rather than truncating', async () => {
    const rows = ['Title', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `row-${i}`)];
    const error = await refusal(csv(`${rows.join('\n')}\n`, 'many.csv'));
    expect(error.code).toBe('too-many-rows');
    expect(error.message).toContain(MAX_IMPORT_ROWS.toLocaleString());
  });
});

describe('CSV splitting handles what a naive split(\',\') loses', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(splitCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('keeps a NEWLINE inside a quoted field — the one that shifts every later column', () => {
    expect(splitCsvRows('Title,Steps\n"A","step 1\nstep 2"\n'))
      .toEqual([['Title', 'Steps'], ['A', 'step 1\nstep 2']]);
  });

  it('reads a doubled quote as an escaped quote', () => {
    expect(splitCsvRows('a,"say ""hi""",b')).toEqual([['a', 'say "hi"', 'b']]);
  });

  it('accepts CRLF, LF and a bare CR, and strips a BOM', () => {
    expect(splitCsvRows('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitCsvRows('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(splitCsvRows('﻿a,b')).toEqual([['a', 'b']]);
  });

  it('adds no phantom row for a trailing newline, and loses none without one', () => {
    expect(splitCsvRows('a\nb\n')).toEqual([['a'], ['b']]);
    expect(splitCsvRows('a\nb')).toEqual([['a'], ['b']]);
  });

  it('preserves empty fields rather than collapsing them', () => {
    expect(splitCsvRows('a,,c')).toEqual([['a', '', 'c']]);
  });
});

describe('headers and leading rows', () => {
  it('names an unheaded column instead of dropping it, and says so', async () => {
    const sheet = await parseImportFile(csv('Title,,Owner\na,b,c\n'));
    expect(sheet.headers).toEqual(['Title', 'Column 2', 'Owner']);
    expect(sheet.rows[0].values['Column 2']).toBe('b');
    expect(sheet.warnings.join(' ')).toMatch(/Column 2 has no heading/);
  });

  it('skips a title row above the headings and reports which row it used', async () => {
    const sheet = await parseImportFile(csv('\nTitle,Steps\nA,B\n'));
    expect(sheet.headers).toEqual(['Title', 'Steps']);
    expect(sheet.rows[0].sourceRow).toBe(3);
    expect(sheet.warnings.join(' ')).toMatch(/headings were read from row 2/);
  });

  it('recognises the two extensions and nothing else', () => {
    expect(importKindOf('a.xlsx')).toBe('xlsx');
    expect(importKindOf('A.CSV')).toBe('csv');
    expect(importKindOf('a.xls')).toBeNull();
    expect(importKindOf('a.xlsx.pdf')).toBeNull();
  });
});
