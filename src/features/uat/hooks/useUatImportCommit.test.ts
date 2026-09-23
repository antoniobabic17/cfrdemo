/**
 * T038 and T039 — the commit loop, and the automated regression for legacy defect 3.
 *
 * **T039's test is the reason this file must exist rather than a manual check.** The legacy
 * behaviour looked like success every time: the sentinel was never cleared, so every press of
 * the button re-created the same 7 rows and the run reported 7 created. A person watching it
 * saw the number they expected. Only committing the same batch twice and comparing the counts
 * shows it, which is what the first describe block does.
 *
 * **T038's test induces a failure mid-batch** and asserts the three things that were all
 * absent from the legacy run: the batch says completed-with-errors, every row carries its own
 * outcome, and the rows that succeeded are still there. Nothing lost, nothing unknown.
 *
 * A fake Dataverse holds the batch and its rows as real mutable state, so a second commit
 * reads what the first one wrote. Asserting against call arguments alone would let a sentinel
 * that is written but never read pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── A fake Dataverse with state, not just spies ──────────────────────────────
interface FakeRow {
  pmo_uatimportrowid: string;
  pmo_sourcerownumber: number;
  pmo_rawdata: string | null;
  pmo_status: number | null;
  pmo_failurereason: string | null;
  _pmo_createdtestcase_value: string | null;
}
const state = {
  batch: {} as Record<string, unknown>,
  rows: [] as FakeRow[],
  createdCases: [] as Record<string, unknown>[],
  /** Source row numbers whose test-case create should throw. */
  failCreateFor: new Set<number>(),
};

const getUatImportBatch = vi.fn(async () => ({ ...state.batch }));
const listUatImportRows = vi.fn(async () => state.rows.map((r) => ({ ...r })));
const updateUatImportBatch = vi.fn(async (_id: string, payload: Record<string, unknown>) => {
  Object.assign(state.batch, payload);
});
const updateUatImportRow = vi.fn(async (id: string, payload: Record<string, unknown>) => {
  const row = state.rows.find((r) => r.pmo_uatimportrowid === id);
  if (!row) throw new Error(`no such row ${id}`);
  if (payload.pmo_status !== undefined) row.pmo_status = payload.pmo_status as number;
  if (payload.pmo_failurereason !== undefined) row.pmo_failurereason = payload.pmo_failurereason as string;
  const bind = payload['pmo_CreatedTestCase@odata.bind'] as string | undefined;
  if (bind) row._pmo_createdtestcase_value = /\(([^)]+)\)/.exec(bind)?.[1] ?? bind;
});
const resolveTestersByName = vi.fn(async () => ({}));
vi.mock('../../../api/uatProjectSettings.api', () => ({
  getUatImportBatch: (...a: unknown[]) => getUatImportBatch(...(a as [])),
  listUatImportRows: (...a: unknown[]) => listUatImportRows(...(a as [])),
  updateUatImportBatch: (id: string, p: Record<string, unknown>) => updateUatImportBatch(id, p),
  updateUatImportRow: (id: string, p: Record<string, unknown>) => updateUatImportRow(id, p),
  resolveTestersByName: (...a: unknown[]) => resolveTestersByName(...(a as [])),
}));

const createUatTestCase = vi.fn(async (payload: Record<string, unknown>) => {
  const title = String(payload.pmo_title ?? '');
  const row = state.rows.find((r) => (r.pmo_rawdata ?? '').includes(`"${title}"`));
  if (row && state.failCreateFor.has(row.pmo_sourcerownumber)) {
    throw new Error('Dataverse 400: something went wrong on this row');
  }
  const created = { pmo_uattestcaseid: `tc-${state.createdCases.length + 1}`, ...payload };
  state.createdCases.push(created);
  return created;
});
vi.mock('../../../api/uatTestCases.api', () => ({
  createUatTestCase: (p: Record<string, unknown>) => createUatTestCase(p),
}));

vi.mock('../../../api/uatTestRuns.api', () => ({
  listUatCyclesByProject: vi.fn(async () => [{ pmo_uatcycleid: 'cyc-1', pmo_name: 'Sprint 1' }]),
}));

import { commitBatch, UatCommitBlockedError } from './useUatImportCommit';
import { UAT_IMPORT_BATCH_STATUS, UAT_IMPORT_ROW_STATUS } from '../../../lib/uatOptionSets';

/** Set up a staged batch of `count` rows, all valid unless spoiled. */
function stageBatch(count: number, spoil: Record<number, Record<string, string>> = {}) {
  state.rows = Array.from({ length: count }, (_, i) => {
    const sourceRow = i + 2;
    const values = spoil[sourceRow] ?? { Title: `Case ${i + 1}` };
    return {
      pmo_uatimportrowid: `r-${sourceRow}`,
      pmo_sourcerownumber: sourceRow,
      pmo_rawdata: JSON.stringify(values),
      pmo_status: UAT_IMPORT_ROW_STATUS.Staged,
      pmo_failurereason: null,
      _pmo_createdtestcase_value: null,
    };
  });
  state.batch = {
    pmo_uatimportbatchid: 'b-1',
    pmo_rowcount: count,
    pmo_status: UAT_IMPORT_BATCH_STATUS.Staged,
    pmo_columnmapping: JSON.stringify({ Title: 'pmo_title', Cycle: 'pmo_Cycle' }),
    pmo_createdcount: 0,
    pmo_skippedcount: 0,
    pmo_failedcount: 0,
  };
}

const commit = () => commitBatch({ batchId: 'b-1', projectId: 'p-1', dataSource: 'custom' });

/**
 * Re-install every fake's behaviour.
 *
 * `vi.clearAllMocks()` clears CALLS but leaves a `mockRejectedValue` in place, so one test's
 * induced failure leaked into the next and made it fail for an unrelated reason. Worth the
 * explicit reset: a leaked implementation is the hardest kind of test failure to read.
 */
function installFakes() {
  updateUatImportRow.mockImplementation(async (id: string, payload: Record<string, unknown>) => {
    const row = state.rows.find((r) => r.pmo_uatimportrowid === id);
    if (!row) throw new Error(`no such row ${id}`);
    if (payload.pmo_status !== undefined) row.pmo_status = payload.pmo_status as number;
    if (payload.pmo_failurereason !== undefined) row.pmo_failurereason = payload.pmo_failurereason as string;
    const bind = payload['pmo_CreatedTestCase@odata.bind'] as string | undefined;
    if (bind) row._pmo_createdtestcase_value = /\(([^)]+)\)/.exec(bind)?.[1] ?? bind;
  });
  updateUatImportBatch.mockImplementation(async (_id: string, payload: Record<string, unknown>) => {
    Object.assign(state.batch, payload);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installFakes();
  state.createdCases = [];
  state.failCreateFor = new Set();
});

describe('T039 — committing the same batch twice (legacy defect 3)', () => {
  it('yields the SAME test-case count and increments the skipped count', async () => {
    stageBatch(7);

    const first = await commit();
    expect(first.created).toBe(7);
    expect(first.skipped).toBe(0);
    expect(state.createdCases).toHaveLength(7);

    // Press the button again. The legacy system created another 7 here and called it success.
    state.batch.pmo_status = UAT_IMPORT_BATCH_STATUS.Completed;
    const second = await commit();

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(7);
    // The number that matters: still 7 test cases in the world, not 14.
    expect(state.createdCases).toHaveLength(7);
    expect(state.batch.pmo_createdcount).toBe(0);
    expect(state.batch.pmo_skippedcount).toBe(7);
  });

  it('reads the sentinel from the ROW, so it survives a page reload between presses', async () => {
    stageBatch(3);
    await commit();
    // Every row carries its created case. Nothing is held in memory between commits.
    expect(state.rows.every((r) => !!r._pmo_createdtestcase_value)).toBe(true);
    expect(state.rows.every((r) => r.pmo_status === UAT_IMPORT_ROW_STATUS.Created)).toBe(true);

    state.batch.pmo_status = UAT_IMPORT_BATCH_STATUS.Completed;
    await commit();
    expect(createUatTestCase).toHaveBeenCalledTimes(3);      // three in total, from the first pass
  });

  it('writes the status and the sentinel in ONE update, so neither can exist without the other', async () => {
    stageBatch(1);
    await commit();
    const [, payload] = updateUatImportRow.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.pmo_status).toBe(UAT_IMPORT_ROW_STATUS.Created);
    expect(payload['pmo_CreatedTestCase@odata.bind']).toMatch(/^\/pmo_uattestcases\(tc-1\)$/);
  });

  it('re-commits only the rows that had failed, leaving the successes alone', async () => {
    stageBatch(5);
    state.failCreateFor = new Set([4]);
    const first = await commit();
    expect(first.created).toBe(4);
    expect(first.failed).toBe(1);

    // The retry: the failure is no longer induced.
    state.failCreateFor = new Set();
    state.batch.pmo_status = UAT_IMPORT_BATCH_STATUS.CompletedWithErrors;
    const second = await commit();

    expect(second.created).toBe(1);       // exactly the one that had failed
    expect(second.skipped).toBe(4);       // the four successes untouched
    expect(state.createdCases).toHaveLength(5);
  });
});

describe('T038 — an induced mid-batch failure', () => {
  it('marks the batch completed-with-errors, keeps the successes, and gives every row an outcome', async () => {
    stageBatch(10);
    state.failCreateFor = new Set([5]);     // row 5 of 10 blows up mid-batch

    const summary = await commit();

    expect(summary.created).toBe(9);
    expect(summary.failed).toBe(1);
    expect(state.batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.CompletedWithErrors);
    expect(state.batch.pmo_createdcount).toBe(9);
    expect(state.batch.pmo_failedcount).toBe(1);

    // Nothing unknown: no row is left Staged.
    expect(state.rows.filter((r) => r.pmo_status === UAT_IMPORT_ROW_STATUS.Staged)).toHaveLength(0);
    // Nothing lost: the nine successes are real and the failure names itself.
    expect(state.createdCases).toHaveLength(9);
    const failedRow = state.rows.find((r) => r.pmo_sourcerownumber === 5)!;
    expect(failedRow.pmo_status).toBe(UAT_IMPORT_ROW_STATUS.Failed);
    expect(failedRow.pmo_failurereason).toContain('Dataverse 400');
    // And the rows AFTER the failure were still processed — the legacy run stopped here.
    expect(state.rows.filter((r) => r.pmo_sourcerownumber > 5)
      .every((r) => r.pmo_status === UAT_IMPORT_ROW_STATUS.Created)).toBe(true);
  });

  it('reports every failure with its source row number', async () => {
    stageBatch(6);
    state.failCreateFor = new Set([3, 6]);
    const summary = await commit();
    expect(summary.failures.map((f) => f.sourceRow).sort((a, b) => a - b)).toEqual([3, 6]);
    expect(summary.failures.every((f) => f.reason.length > 0)).toBe(true);
  });

  it('marks a row that cannot be validated as Failed with its reason, and creates the rest', async () => {
    stageBatch(4, { 3: { Title: '' }, 4: { Title: 'ok', Cycle: 'Sprint 99' } });
    const summary = await commit();

    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(2);
    const empty = state.rows.find((r) => r.pmo_sourcerownumber === 3)!;
    const badCycle = state.rows.find((r) => r.pmo_sourcerownumber === 4)!;
    expect(empty.pmo_failurereason).toMatch(/Title is required/i);
    expect(badCycle.pmo_failurereason).toContain('Sprint 99');
  });

  it('records a row whose staged data cannot be read, rather than refusing the batch', async () => {
    stageBatch(3);
    state.rows[1].pmo_rawdata = '{not json';
    const summary = await commit();
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(1);
    expect(state.rows[1].pmo_failurereason).toMatch(/could not be read/i);
  });

  it('never leaves the batch in Committing, even when the loop itself throws', async () => {
    // A throw the loop cannot anticipate, from code it does not own: the caller's own progress
    // callback. A setState after unmount is the everyday version of this.
    stageBatch(3);
    await expect(commitBatch({
      batchId: 'b-1', projectId: 'p-1', dataSource: 'custom',
      onProgress: () => { throw new Error('the caller blew up'); },
    })).rejects.toThrow('the caller blew up');

    // A batch stuck in Committing is indistinguishable from an abandoned background job —
    // which is the appearance legacy defect 1 is about.
    expect(state.batch.pmo_status).not.toBe(UAT_IMPORT_BATCH_STATUS.Committing);
    expect(state.batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.Completed);
    // And what it managed before the throw is recorded, not discarded.
    expect(state.batch.pmo_createdcount).toBe(1);
  });

  it('records what it managed even when every row write fails', async () => {
    stageBatch(2);
    updateUatImportRow.mockRejectedValue(new Error('row update unavailable'));
    state.failCreateFor = new Set([2, 3]);

    const summary = await commit();
    expect(summary.failed).toBe(2);
    expect(state.batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.CompletedWithErrors);
  });

  it('reports a created case whose row could not be marked, rather than calling it failed', async () => {
    // The one state in which a second press would duplicate: the case exists and the sentinel
    // does not. Calling it "failed" would hide a real test case; calling it clean would invite
    // the duplicate. It gets its own list, and the batch is not clean.
    stageBatch(1);
    updateUatImportRow.mockRejectedValue(new Error('row update unavailable'));

    const summary = await commit();

    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.unmarked).toEqual([{ sourceRow: 2, testCaseId: 'tc-1' }]);
    expect(state.createdCases).toHaveLength(1);
    expect(state.batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.CompletedWithErrors);
    // Retried, not attempted once — this is the window a duplicate comes through.
    expect(updateUatImportRow).toHaveBeenCalledTimes(3);
  });

  it('resolves rather than throwing when some rows failed, so the successes are reported', async () => {
    stageBatch(3);
    state.failCreateFor = new Set([2]);
    // Reporting a partly-successful commit as an error is the legacy report inverted: it
    // hides the rows that worked.
    await expect(commit()).resolves.toMatchObject({ created: 2, failed: 1 });
  });

  it('reports progress as it goes, ending at the row count', async () => {
    stageBatch(5);
    const seen: number[] = [];
    const summary = await commitBatch({
      batchId: 'b-1', projectId: 'p-1', dataSource: 'custom',
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(summary.done).toBe(5);
    expect(summary.total).toBe(5);
  });
});

describe('the commit refuses to run at all when it must', () => {
  it('refuses an incomplete batch, and writes nothing', async () => {
    stageBatch(5);
    state.batch.pmo_rowcount = 6;          // one row never landed
    await expect(commit()).rejects.toThrow(UatCommitBlockedError);
    expect(createUatTestCase).not.toHaveBeenCalled();
    expect(state.batch.pmo_status).toBe(UAT_IMPORT_BATCH_STATUS.Staged);
  });

  it('refuses a batch that is already committing', async () => {
    stageBatch(2);
    state.batch.pmo_status = UAT_IMPORT_BATCH_STATUS.Committing;
    await expect(commit()).rejects.toThrow(/already being committed/i);
    expect(createUatTestCase).not.toHaveBeenCalled();
  });

  it('refuses a cancelled batch', async () => {
    stageBatch(2);
    state.batch.pmo_status = UAT_IMPORT_BATCH_STATUS.Cancelled;
    await expect(commit()).rejects.toThrow(/cancelled/i);
  });

  it('refuses a batch with no saved column mapping', async () => {
    stageBatch(2);
    state.batch.pmo_columnmapping = null;
    await expect(commit()).rejects.toThrow(/no column mapping/i);
    expect(createUatTestCase).not.toHaveBeenCalled();
  });

  it('stamps every created case with its batch and its project', async () => {
    stageBatch(1);
    await commit();
    const payload = state.createdCases[0];
    expect(payload['pmo_ImportBatch@odata.bind']).toBe('/pmo_uatimportbatchs(b-1)');
    expect(payload['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(p-1)');
  });
});
