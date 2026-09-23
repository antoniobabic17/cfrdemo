/**
 * The commit loop — every row gets an outcome, and nothing is unknown.
 *
 * **Legacy defects 1, 3 and 4 all live here, and each is answered by a specific property:**
 *
 *  - **Defect 1 — a background process did the creating.** This runs from the operator's own
 *    click, inside `useAppMutation`, with a progress count they watch. There is no timer, no
 *    flow, no queue. The batch is never left in `Committing`: the final status write is in a
 *    `finally`, because a batch stuck mid-state is exactly what an abandoned background job
 *    looks like.
 *  - **Defect 3 — the sentinel was never cleared, so every press re-created the same rows.**
 *    Here the sentinel is the row's own `pmo_CreatedTestCase` lookup, written in the same
 *    step as the row's Created status. A second commit finds it set and SKIPS, incrementing
 *    the skipped count. Nothing is "cleared", so nothing can fail to be cleared.
 *  - **Defect 4 — one failed iteration killed the run, with earlier rows already written and
 *    no record of which.** Every row is processed; a failure is caught, written onto that
 *    row as its status and reason, and the loop continues. At the end every row carries one
 *    of Created / Skipped / Failed — no row is left Staged, which is what makes "nothing is
 *    unknown" checkable rather than aspirational.
 *
 * Rows are processed in source-row order, one at a time. Concurrency here would buy seconds
 * and cost the deterministic per-row ordering the failure report depends on.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from '../../../hooks/useAppMutation';
import { useDataSource } from '../../../lib/taskSource';
import type { DataSource } from '../../../lib/taskSource';
import {
  getUatImportBatch,
  listUatImportBatchesByProject,
  listUatImportRows,
  updateUatImportBatch,
  updateUatImportRow,
  resolveTestersByName,
} from '../../../api/uatProjectSettings.api';
import { createUatTestCase } from '../../../api/uatTestCases.api';
import { listUatCyclesByProject } from '../../../api/uatTestRuns.api';
import { projectBind } from '../../../lib/projectLookupRef';
import {
  UAT_IMPORT_BATCH_STATUS,
  UAT_IMPORT_ROW_STATUS,
} from '../../../lib/uatOptionSets';
import { UAT_ENTITY_SETS } from '../lib/uatEntitySets';
import { stagingIsComplete } from '../lib/uatImportStaging';
import {
  validateStagedRows,
  hasEmptyBind,
  IMPORT_TARGET_FIELDS,
  type ImportReferences,
  type RowToValidate,
} from '../lib/uatImportValidation';
import type { UatImportRow } from '../../../models/uatDefect.model';

// ── Reads ────────────────────────────────────────────────────────────────────
// The query keys live here, beside the invalidations that reference them, so a rename
// cannot leave the commit invalidating a key nothing queries.

export const IMPORT_BATCH_QK = (batchId: string) => ['uatImportBatch', batchId] as const;
export const IMPORT_ROWS_QK = (batchId: string) => ['uatImportRows', batchId] as const;
export const IMPORT_BATCHES_QK = (projectId: string) => ['uatImportBatches', projectId] as const;

export function useUatImportBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: IMPORT_BATCH_QK(batchId ?? ''),
    queryFn: () => getUatImportBatch(batchId!),
    enabled: !!batchId,
    staleTime: 30_000,
  });
}

/**
 * One batch's rows, in source-row order.
 *
 * No `staleTime`: this is the list a person watches after a commit to see what happened, and
 * a cached answer there is the same lie the legacy run told.
 */
export function useUatImportRows(batchId: string | undefined) {
  return useQuery({
    queryKey: IMPORT_ROWS_QK(batchId ?? ''),
    queryFn: () => listUatImportRows(batchId!),
    enabled: !!batchId,
  });
}

export function useUatImportBatches(projectId: string | undefined) {
  return useQuery({
    queryKey: IMPORT_BATCHES_QK(projectId ?? ''),
    queryFn: () => listUatImportBatchesByProject(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/** Refusals that stop a commit before it writes anything. */
export class UatCommitBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UatCommitBlockedError';
  }
}

export interface CommitProgress {
  done: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
}

export interface CommitSummary extends CommitProgress {
  batchId: string;
  /** The batch's final status integer — Completed or CompletedWithErrors. */
  status: number;
  /** Source row numbers that failed, with their reasons, for the batch page. */
  failures: { sourceRow: number; reason: string }[];
  /**
   * Rows whose test case WAS created but whose row could not be marked as such.
   *
   * A distinct outcome, not a failure and not a clean success, because it is the one state in
   * which a re-commit would create a duplicate: the sentinel is what makes the second press
   * skip, and this row has none. Reported by row number and case id so a person can either
   * mark it or delete the case. Rare — it takes a create that succeeds followed by an update
   * that fails three times — and silently calling it "failed" would be the worse answer,
   * because the case exists and the next commit would make a second one.
   */
  unmarked: { sourceRow: number; testCaseId: string }[];
}

/** The staged row's own raw values, or an empty object if the JSON is unreadable. */
function valuesOf(row: UatImportRow): Record<string, string> | null {
  if (!row.pmo_rawdata) return null;
  try {
    const parsed = JSON.parse(row.pmo_rawdata) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      values[key] = value == null ? '' : String(value);
    }
    return values;
  } catch {
    return null;
  }
}

/** The operator's stored heading→field map, or an empty map if it is unreadable. */
function mappingOf(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const mapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') mapping[key] = value;
    }
    return mapping;
  } catch {
    return {};
  }
}

/**
 * Read the reference data one commit needs, once.
 *
 * Only the tester names the file actually contains are looked up — see
 * `resolveTestersByName`. Cycles are read per project because a cycle name is only unique
 * inside one, and a cross-project match would silently attach a case to another project's
 * cycle.
 */
export async function loadImportReferences(
  projectId: string,
  rows: { values: Record<string, string> }[],
  mapping: Record<string, string>,
): Promise<ImportReferences> {
  const cycles = await listUatCyclesByProject(projectId);
  const cyclesByName: Record<string, string> = {};
  for (const cycle of cycles) {
    if (cycle.pmo_name) cyclesByName[cycle.pmo_name] = cycle.pmo_uatcycleid;
  }

  const testerColumns = Object.entries(mapping)
    .filter(([, field]) => field === 'pmo_AssignedTester')
    .map(([column]) => column);
  const names = testerColumns.length === 0
    ? []
    : rows.flatMap((row) => testerColumns.map((column) => row.values[column] ?? ''));

  return { cyclesByName, testersByName: await resolveTestersByName(names) };
}

export interface CommitBatchInput {
  batchId: string;
  projectId: string;
  dataSource: DataSource;
  onProgress?: (progress: CommitProgress) => void;
}

/**
 * Commit one staged batch. Returns a summary; throws only when it wrote nothing.
 *
 * The distinction matters. A refusal (incomplete staging, an already-finished batch) throws,
 * because the operator's action did not happen. A batch where 3 of 50 rows failed RESOLVES,
 * with the outcome on every row — because it did happen, and reporting it as an error would
 * hide the 47 that worked, which is the legacy report inverted.
 */
export async function commitBatch(input: CommitBatchInput): Promise<CommitSummary> {
  const { batchId, projectId, dataSource, onProgress } = input;

  const batch = await getUatImportBatch(batchId);
  const stagedRows = await listUatImportRows(batchId);

  // Gate one: staging must be complete. T035's invariant, enforced at the point it protects.
  if (!stagingIsComplete(batch.pmo_rowcount, stagedRows)) {
    throw new UatCommitBlockedError(
      `This batch has ${stagedRows.length} staged rows but records ${batch.pmo_rowcount ?? 0}. `
      + 'Nothing was created — an incomplete batch cannot be committed, because the result would '
      + 'be a partial import that looked finished.',
    );
  }
  // Gate two: a batch already being committed is not committed again. Not a lock — a
  // same-tab double-click guard, and an honest message if a second person is mid-commit.
  if (batch.pmo_status === UAT_IMPORT_BATCH_STATUS.Committing) {
    throw new UatCommitBlockedError(
      'This batch is already being committed. Wait for it to finish, then reload the page.',
    );
  }
  if (batch.pmo_status === UAT_IMPORT_BATCH_STATUS.Cancelled) {
    throw new UatCommitBlockedError('This batch was cancelled and cannot be committed.');
  }

  const mapping = mappingOf(batch.pmo_columnmapping);
  if (Object.keys(mapping).length === 0) {
    throw new UatCommitBlockedError(
      'This batch has no column mapping saved, so there is nothing to create from its rows. '
      + 'Import the file again.',
    );
  }

  // A row whose raw data cannot be read is a failure of THIS row, recorded on it — not a
  // reason to refuse the batch.
  const unreadable: UatImportRow[] = [];
  const readable: (RowToValidate & { row: UatImportRow })[] = [];
  for (const row of stagedRows) {
    const values = valuesOf(row);
    if (!values) { unreadable.push(row); continue; }
    readable.push({
      sourceRow: row.pmo_sourcerownumber ?? 0,
      values,
      rowId: row.pmo_uatimportrowid,
      row,
    });
  }

  const references = await loadImportReferences(projectId, readable, mapping);
  const { valid, invalid } = validateStagedRows(readable, mapping, references);
  const rowById = new Map(readable.map((r) => [r.rowId!, r.row]));

  await updateUatImportBatch(batchId, { pmo_status: UAT_IMPORT_BATCH_STATUS.Committing });

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;
  const total = stagedRows.length;
  const failures: { sourceRow: number; reason: string }[] = [];
  const unmarked: { sourceRow: number; testCaseId: string }[] = [];
  const report = () => onProgress?.({ done, total, created, skipped, failed });

  /** Mark a row Created and stamp its sentinel. Retried; true when it stuck. */
  const markRowCreated = async (rowId: string, testCaseId: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await updateUatImportRow(rowId, {
          pmo_status: UAT_IMPORT_ROW_STATUS.Created,
          'pmo_CreatedTestCase@odata.bind': `/${UAT_ENTITY_SETS.testCase}(${testCaseId})`,
        });
        return true;
      } catch {
        // Retried in place rather than left to the caller: the window this closes is exactly
        // the one in which a re-commit duplicates a row.
      }
    }
    return false;
  };

  /** Record a row's failure on the row itself, then keep going. */
  const recordFailure = async (rowId: string, sourceRow: number, reason: string) => {
    failed++;
    failures.push({ sourceRow, reason });
    try {
      await updateUatImportRow(rowId, {
        pmo_status: UAT_IMPORT_ROW_STATUS.Failed,
        // Truncated to the column's length rather than risking a 400 while reporting a 400.
        pmo_failurereason: reason.slice(0, 2000),
      });
    } catch {
      // If even the failure write fails, the count still reflects it and the summary still
      // names the row. Losing the reason is bad; losing the row is worse.
    }
  };

  try {
    for (const row of unreadable) {
      await recordFailure(
        row.pmo_uatimportrowid,
        row.pmo_sourcerownumber ?? 0,
        'This row\'s staged data could not be read, so nothing was created from it. Import the file again.',
      );
      done++; report();
    }

    for (const bad of invalid) {
      await recordFailure(bad.rowId!, bad.sourceRow, bad.reasons.map((r) => r.reason).join(' '));
      done++; report();
    }

    for (const candidate of valid) {
      const staged = rowById.get(candidate.rowId!);
      // The sentinel. Set on the row when its case was created, so a second commit skips it.
      if (staged?._pmo_createdtestcase_value) {
        skipped++;
        try {
          await updateUatImportRow(candidate.rowId!, { pmo_status: UAT_IMPORT_ROW_STATUS.Skipped });
        } catch { /* the count is the record; the status is a convenience */ }
        done++; report();
        continue;
      }

      const payload = {
        ...candidate.payload,
        'pmo_ImportBatch@odata.bind': `/${UAT_ENTITY_SETS.importBatch}(${batchId})`,
        ...projectBind(projectId, dataSource),
      };
      // The last guard before the write, and the one legacy defect 5 needed. Validation
      // should make this unreachable; "should" is why it is checked here.
      if (hasEmptyBind(payload)) {
        await recordFailure(
          candidate.rowId!, candidate.sourceRow,
          'A reference on this row did not resolve, so it was not created. Fix the referenced '
          + 'value in the file and retry this row.',
        );
        done++; report();
        continue;
      }

      let testCaseId: string | null = null;
      try {
        const testCase = await createUatTestCase(payload);
        testCaseId = testCase.pmo_uattestcaseid;
      } catch (error) {
        await recordFailure(
          candidate.rowId!, candidate.sourceRow,
          error instanceof Error ? error.message : String(error),
        );
        done++; report();
        continue;
      }

      // The case exists. Marking the row is now the ONLY thing standing between a second
      // press and a duplicate, so it is retried rather than attempted once. Status and
      // sentinel go in ONE write: two writes could leave a created case whose row says
      // Staged, and the next commit would create it again.
      created++;
      const marked = await markRowCreated(candidate.rowId!, testCaseId);
      if (!marked) {
        unmarked.push({ sourceRow: candidate.sourceRow, testCaseId });
      }
      done++; report();
    }
  } finally {
    // ALWAYS. A batch left in Committing is indistinguishable from an abandoned background
    // job, which is the appearance legacy defect 1 is about.
    // An unmarked row makes the batch not-clean even with zero failures: it is the one state
    // a person has to look at before pressing the button again.
    const status = failed > 0 || unmarked.length > 0
      ? UAT_IMPORT_BATCH_STATUS.CompletedWithErrors
      : UAT_IMPORT_BATCH_STATUS.Completed;
    try {
      await updateUatImportBatch(batchId, {
        pmo_status: status,
        pmo_createdcount: created,
        pmo_skippedcount: skipped,
        pmo_failedcount: failed,
      });
    } catch { /* the summary the caller receives is still accurate */ }
  }

  return {
    batchId,
    total,
    done,
    created,
    skipped,
    failed,
    failures,
    unmarked,
    status: failed > 0 || unmarked.length > 0
      ? UAT_IMPORT_BATCH_STATUS.CompletedWithErrors
      : UAT_IMPORT_BATCH_STATUS.Completed,
  };
}

/**
 * The operator's own action, with synchronous feedback (defect 1).
 *
 * Through `useAppMutation` so a refusal reaches them as a toast and a telemetry row — but
 * note `retry: false`: the shared retry policy re-runs a whole mutation on a transient
 * error, and re-running a partly-committed batch is safe only because of the sentinel. Not
 * retrying keeps the operator's mental model simple: one press, one pass, a report.
 */
export interface CommitVars {
  batchId: string;
  onProgress?: (progress: CommitProgress) => void;
}

export function useUatImportCommit(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation<CommitVars, CommitSummary>({
    action: 'create test cases from an import',
    entityType: 'pmo_uatimportbatch',
    entityId: (vars: CommitVars) => vars.batchId,
    parentProjectId: projectId,
    retry: false,
    mutationFn: (vars: CommitVars) =>
      commitBatch({ batchId: vars.batchId, projectId, dataSource, onProgress: vars.onProgress }),
    onSettled: (_data, _error, vars) => {
      void qc.invalidateQueries({ queryKey: IMPORT_BATCH_QK(vars.batchId) });
      void qc.invalidateQueries({ queryKey: IMPORT_ROWS_QK(vars.batchId) });
      void qc.invalidateQueries({ queryKey: IMPORT_BATCHES_QK(projectId) });
      // The cases it created must appear on both test-case surfaces without a reload.
      void qc.invalidateQueries({ queryKey: ['uatTestCases', projectId] });
      void qc.invalidateQueries({ queryKey: ['uatTestCases', '__all__'] });
    },
  });
}

/** The import target fields, re-exported so the wizard has one import for its mapping UI. */
export { IMPORT_TARGET_FIELDS };
