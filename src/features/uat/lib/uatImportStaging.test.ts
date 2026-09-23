/**
 * T035 — durable staging. 500 rows in, 500 rows staged, ZERO test cases.
 *
 * The headline test is a real 500-row CSV parsed by the real parser and staged through the
 * real module, with a fake Dataverse counting what it was asked to write. 500 is the number
 * because ~98% of the legacy import's staged rows were invisible: a filter that dropped
 * "ineligible" rows would show here as any number below 500, and the assertion is on the
 * number rather than on the absence of a predicate in the source.
 *
 * The second headline is the negative one, and it is the more important: a row that will
 * certainly fail validation is STILL staged. Its existence is a fact about the operator's
 * file; whether it can become a test case is a judgement about it, made later and recorded
 * on the row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const createUatImportBatch = vi.fn();
const createUatImportRow = vi.fn();
const listUatImportRows = vi.fn();
vi.mock('../../../api/uatProjectSettings.api', () => ({
  createUatImportBatch: (...a: unknown[]) => createUatImportBatch(...a),
  createUatImportRow: (...a: unknown[]) => createUatImportRow(...a),
  listUatImportRows: (...a: unknown[]) => listUatImportRows(...a),
}));

import {
  stageImport,
  buildStagedRows,
  stagingIsComplete,
  stagingIdempotencyKey,
  STAGING_CONCURRENCY,
  UatStagingError,
} from './uatImportStaging';
import { parseImportFile } from './uatFileParse';
import { UAT_IMPORT_BATCH_STATUS, UAT_IMPORT_ROW_STATUS } from '../../../lib/uatOptionSets';
import type { ParsedSheet, ParsedRow } from './uatFileParse';
import type { UatImportRow } from '../../../models/uatDefect.model';

/** Rows written to the fake Dataverse, in write order. */
let written: Record<string, unknown>[] = [];

function sheet(rows: ParsedRow[], headers = ['Title', 'Steps']): ParsedSheet {
  return { headers, rows, warnings: [], sheetName: 'Cases' };
}

const parsedRow = (n: number, values: Record<string, string> = { Title: `T${n}`, Steps: 's' }): ParsedRow =>
  ({ sourceRow: n + 1, values });

const input = (s: ParsedSheet) => ({
  sheet: s,
  projectId: 'p-1',
  dataSource: 'custom' as const,
  fileName: 'cases.csv',
  mapping: { Title: 'pmo_title', Steps: 'pmo_steps' },
});

beforeEach(() => {
  vi.clearAllMocks();
  written = [];
  createUatImportBatch.mockResolvedValue({ pmo_uatimportbatchid: 'b-1' });
  createUatImportRow.mockImplementation(async (payload: Record<string, unknown>) => {
    written.push(payload);
    return { pmo_uatimportrowid: `r-${written.length}` };
  });
  // The verified count is a READ, so the fake answers from what it was actually asked to write.
  listUatImportRows.mockImplementation(async () => written.map(() => ({}) as UatImportRow));
});

describe('a 500-row file produces 500 staged rows and zero test cases', () => {
  it('stages all 500, through the real parser', async () => {
    const lines = ['Title,Steps', ...Array.from({ length: 500 }, (_, i) => `Case ${i + 1},do the thing`)];
    const parsed = await parseImportFile(new File([`${lines.join('\n')}\n`], 'cases.csv'));
    expect(parsed.rows).toHaveLength(500);

    const result = await stageImport(input(parsed));

    // The number IS the assertion. Anything less is legacy defect 2.
    expect(result.staged).toBe(500);
    expect(result.expected).toBe(500);
    expect(createUatImportRow).toHaveBeenCalledTimes(500);
    expect(written).toHaveLength(500);
  });

  it('creates ZERO test cases — the api surface it may touch has no create for one', async () => {
    const parsed = sheet(Array.from({ length: 500 }, (_, i) => parsedRow(i)));
    await stageImport(input(parsed));
    // Structural: the mocked api module exposes exactly three functions, none of which is a
    // test-case create. A module that reached for one would fail to import, not misbehave.
    const apiModule = await import('../../../api/uatProjectSettings.api');
    expect(Object.keys(apiModule).sort()).toEqual([
      'createUatImportBatch', 'createUatImportRow', 'listUatImportRows',
    ]);
  });

  it('records the count on the batch BEFORE any row is written', async () => {
    const parsed = sheet(Array.from({ length: 7 }, (_, i) => parsedRow(i)));
    await stageImport(input(parsed));

    expect(createUatImportBatch).toHaveBeenCalledBefore(createUatImportRow);
    const batch = createUatImportBatch.mock.calls[0][0] as Record<string, unknown>;
    expect(batch.pmo_rowcount).toBe(7);
    expect(batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.Staged);
    expect(batch.pmo_createdcount).toBe(0);
    expect(batch.pmo_skippedcount).toBe(0);
    expect(batch.pmo_failedcount).toBe(0);
    // Written under the project, in the current data-source mode.
    expect(batch['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(p-1)');
    // The operator's hand-built map travels with the batch, so a retry needs no re-mapping.
    expect(JSON.parse(String(batch.pmo_columnmapping))).toEqual({ Title: 'pmo_title', Steps: 'pmo_steps' });
  });

  it('reports progress as a count, not a spinner', async () => {
    const parsed = sheet(Array.from({ length: 10 }, (_, i) => parsedRow(i)));
    const seen: number[] = [];
    await stageImport({ ...input(parsed), onProgress: (n, total) => { seen.push(n); expect(total).toBe(10); } });
    expect(seen).toHaveLength(10);
    expect(Math.max(...seen)).toBe(10);
  });
});

describe('no row\'s existence depends on a filter', () => {
  it('stages a row that will certainly fail validation', async () => {
    // Empty title, junk reference — the shape the legacy filter dropped. It is staged.
    const parsed = sheet([
      parsedRow(0, { Title: 'Good', Steps: 'ok' }),
      parsedRow(1, { Title: '', Steps: '' }),
      parsedRow(2, { Title: 'Also good', Steps: 'ok' }),
    ]);
    const result = await stageImport(input(parsed));
    expect(result.staged).toBe(3);
    expect(JSON.parse(String(written[1].pmo_rawdata))).toEqual({ Title: '', Steps: '' });
    expect(written[1].pmo_status).toBe(UAT_IMPORT_ROW_STATUS.Staged);
  });

  it('builds exactly one payload per parsed row, whatever the rows contain', () => {
    const rows = [parsedRow(0), parsedRow(1, { Title: '', Steps: '' }), parsedRow(2, {})];
    const payloads = buildStagedRows(rows, 'b-1');
    expect(payloads).toHaveLength(rows.length);
    expect(payloads.map((p) => p.pmo_sourcerownumber)).toEqual([1, 2, 3]);
  });

  it('carries the source row number and the raw values onto every row', async () => {
    const parsed = await parseImportFile(new File(['Title\nA\n\nB\n'], 'gaps.csv'));
    await stageImport(input(parsed));
    // Row numbers as the spreadsheet shows them — 2 and 4, with the gap intact.
    expect(written.map((w) => w.pmo_sourcerownumber)).toEqual([2, 4]);
    expect(written.map((w) => w.pmo_name)).toEqual(['Row 2', 'Row 4']);
    expect(JSON.parse(String(written[1].pmo_rawdata))).toEqual({ Title: 'B' });
  });

  it('binds every row to its batch, so a batch delete takes its rows with it', () => {
    const payloads = buildStagedRows([parsedRow(0), parsedRow(1)], 'b-9');
    for (const payload of payloads) {
      expect(payload['pmo_Batch@odata.bind']).toBe('/pmo_uatimportbatchs(b-9)');
    }
  });
});

describe('the count is verified, not assumed', () => {
  it('refuses when fewer rows landed than were parsed, naming the ones that did not', async () => {
    const parsed = sheet(Array.from({ length: 5 }, (_, i) => parsedRow(i)));
    createUatImportRow.mockImplementation(async (payload: Record<string, unknown>) => {
      if (payload.pmo_sourcerownumber === 3) throw new Error('429 throttled');
      written.push(payload);
      return {};
    });

    const thrown = await stageImport(input(parsed)).then(() => null, (e: unknown) => e);
    expect(thrown).toBeInstanceOf(UatStagingError);
    const error = thrown as UatStagingError;
    expect(error.missingRows).toEqual([3]);
    expect(error.message).toContain('Only 4 of 5 rows were staged');
    // The message says what happens next, and it is the truth: the commit is gated.
    expect(error.message).toMatch(/nothing has been created/i);
  });

  it('does not abandon the other rows when one fails', async () => {
    const parsed = sheet(Array.from({ length: 5 }, (_, i) => parsedRow(i)));
    createUatImportRow.mockImplementation(async (payload: Record<string, unknown>) => {
      if (payload.pmo_sourcerownumber === 2) throw new Error('boom');
      written.push(payload);
      return {};
    });
    await stageImport(input(parsed)).catch(() => undefined);
    expect(written).toHaveLength(4);
  });

  it('counts by READING the rows back, not by counting resolved writes', async () => {
    const parsed = sheet(Array.from({ length: 3 }, (_, i) => parsedRow(i)));
    // Every write resolves, but only two rows exist. A write that resolved is not the same
    // claim as a row that exists, which is why the count is a read.
    listUatImportRows.mockResolvedValue([{}, {}] as UatImportRow[]);
    await expect(stageImport(input(parsed))).rejects.toThrow(/Only 2 of 3/);
  });

  it('gates the commit on completeness, as a pure function anyone can ask', () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({}) as UatImportRow);
    expect(stagingIsComplete(500, rows(500))).toBe(true);
    expect(stagingIsComplete(500, rows(499))).toBe(false);
    expect(stagingIsComplete(500, rows(501))).toBe(false);
    expect(stagingIsComplete(null, rows(0))).toBe(false);
    expect(stagingIsComplete(0, rows(0))).toBe(false);
  });
});

describe('write concurrency and the re-upload key', () => {
  it('keeps at most STAGING_CONCURRENCY writes in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    createUatImportRow.mockImplementation(async (payload: Record<string, unknown>) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      written.push(payload);
      return {};
    });
    await stageImport(input(sheet(Array.from({ length: 40 }, (_, i) => parsedRow(i)))));
    // Pinned to the literal 4 as well as to the constant. Asserting only
    // `peak <= STAGING_CONCURRENCY` is self-referential: raising the constant to 500 raises
    // the bound with it and the test stays green while 500 requests go out at once. Measured:
    // that mutation survived until this line was added.
    expect(STAGING_CONCURRENCY).toBe(4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);          // and it is not accidentally sequential
    expect(written).toHaveLength(40);
  });

  it('gives the same file staged for the same project the same key', () => {
    const one = sheet([parsedRow(0), parsedRow(1)]);
    expect(stagingIdempotencyKey('p-1', 'Cases.csv', one))
      .toBe(stagingIdempotencyKey('p-1', 'cases.csv', one));
    // A different project, a different row count or different headings is a different key.
    expect(stagingIdempotencyKey('p-2', 'cases.csv', one))
      .not.toBe(stagingIdempotencyKey('p-1', 'cases.csv', one));
    expect(stagingIdempotencyKey('p-1', 'cases.csv', sheet([parsedRow(0)])))
      .not.toBe(stagingIdempotencyKey('p-1', 'cases.csv', one));
    expect(stagingIdempotencyKey('p-1', 'cases.csv', sheet([parsedRow(0), parsedRow(1)], ['A', 'B'])))
      .not.toBe(stagingIdempotencyKey('p-1', 'cases.csv', one));
  });
});
