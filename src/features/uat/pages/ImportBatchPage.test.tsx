/**
 * T040 — the batch page. Failures visible with their row numbers, retry touches only them.
 *
 * The failure list is the page's reason to exist: the legacy report named no row and gave no
 * reason, so a run that lost 98% of its rows looked exactly like one that worked. The tests
 * assert the number the operator can find in their own file, and the reason beside it.
 *
 * "Retry processes only the failures" is proven where it is actually decided — in the commit
 * loop, by the row sentinel (see useUatImportCommit.test.ts, which commits the same batch
 * twice and counts). Here the claim is narrower and still worth pinning: the button calls the
 * SAME commit path rather than a second one that could behave differently, and it says how
 * many rows it will act on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../hooks/useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const batchState = { data: {} as Record<string, unknown>, isPending: false, isError: false };
const rowsState = { data: [] as Record<string, unknown>[], isPending: false, isError: false };
const commitMutateAsync = vi.fn();
vi.mock('../hooks/useUatImportCommit', () => ({
  useUatImportBatch: () => ({ ...batchState, refetch: vi.fn() }),
  useUatImportRows: () => ({ ...rowsState, refetch: vi.fn() }),
  useUatImportCommit: () => ({ mutateAsync: commitMutateAsync, isPending: false }),
}));

const evidenceMounts: Record<string, unknown>[] = [];
vi.mock('../components/UatAttachmentMounts', () => ({
  UatEvidenceFor: (props: Record<string, unknown>) => {
    evidenceMounts.push(props);
    return <div data-testid="evidence-panel" />;
  },
}));

import { ImportBatchPage } from './ImportBatchPage';
import { UAT_IMPORT_BATCH_STATUS, UAT_IMPORT_ROW_STATUS } from '../../../lib/uatOptionSets';
import { toast } from '../../../hooks/useToast';

const row = (sourceRow: number, status: number, reason: string | null = null) => ({
  pmo_uatimportrowid: `r-${sourceRow}`,
  pmo_sourcerownumber: sourceRow,
  pmo_status: status,
  pmo_failurereason: reason,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/uat/imports/b-1']}>
      <Routes>
        <Route path="/uat/imports/:id" element={<ImportBatchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  evidenceMounts.length = 0;
  batchState.data = {
    pmo_uatimportbatchid: 'b-1',
    pmo_name: 'IMP-1004',
    pmo_filename: 'sprint-9-cases.xlsx',
    pmo_status: UAT_IMPORT_BATCH_STATUS.CompletedWithErrors,
    pmo_rowcount: 50,
    pmo_createdcount: 47,
    pmo_skippedcount: 0,
    pmo_failedcount: 3,
    _pmo_projectref_value: 'p-1',
  };
  batchState.isPending = false;
  batchState.isError = false;
  rowsState.data = [
    ...Array.from({ length: 47 }, (_, i) => row(i + 2, UAT_IMPORT_ROW_STATUS.Created)),
    row(49, UAT_IMPORT_ROW_STATUS.Failed, 'Title is required and this row\'s Title is empty.'),
    row(50, UAT_IMPORT_ROW_STATUS.Failed, 'No cycle called "Sprint 99" exists in this project.'),
    row(51, UAT_IMPORT_ROW_STATUS.Failed, 'Estimated minutes must be a whole number of zero or more.'),
  ];
  rowsState.isPending = false;
  rowsState.isError = false;
  commitMutateAsync.mockResolvedValue({
    created: 3, skipped: 47, failed: 0, total: 50, done: 50, failures: [], unmarked: [],
  });
});

describe('failed rows are visible with their reasons and source row numbers', () => {
  it('shows only the failures by default, because three in five hundred is not findable by scrolling', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Failed \(3\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All \(50\)/ })).toBeTruthy();

    // Scoped to the table: the summary counts render numbers too, and "50" is both a row
    // number and the row count. A test that matches either is a test that passes by accident.
    const table = within(screen.getByTestId('uat-batch-rows'));
    // The three rows, by the number in the operator's own file.
    expect(table.getByText('49')).toBeTruthy();
    expect(table.getByText('50')).toBeTruthy();
    expect(table.getByText('51')).toBeTruthy();
    // And their reasons, in full.
    expect(table.getByText(/No cycle called "Sprint 99"/)).toBeTruthy();
    expect(table.getByText(/whole number of zero or more/)).toBeTruthy();
    // The 47 successes are not in the way.
    expect(table.queryByText('2')).toBeNull();
  });

  it('shows every row when asked, successes included', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /All \(50\)/ }));
    const table = within(screen.getByTestId('uat-batch-rows'));
    expect(table.getAllByText('Created').length).toBe(47);
    expect(table.getAllByText('Failed').length).toBe(3);
  });

  it('shows the batch\'s own counts, so the totals can be reconciled', () => {
    renderPage();
    const counts = screen.getByTestId('uat-batch-counts').textContent ?? '';
    expect(counts).toContain('50');
    expect(counts).toContain('47');
    expect(counts).toContain('3');
  });

  it('says plainly when nothing failed, rather than showing an empty table', () => {
    rowsState.data = Array.from({ length: 5 }, (_, i) => row(i + 2, UAT_IMPORT_ROW_STATUS.Created));
    batchState.data = { ...batchState.data, pmo_failedcount: 0, pmo_status: UAT_IMPORT_BATCH_STATUS.Completed };
    renderPage();
    expect(screen.getByText(/No rows failed in this batch/i)).toBeTruthy();
    // And no retry button, because there is nothing to retry.
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });

  it('distinguishes a read failure from an empty batch', () => {
    rowsState.data = [];
    rowsState.isError = true;
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/this is a read failure/i);
  });
});

describe('retry', () => {
  it('names how many rows it will act on, and calls the same commit path', async () => {
    renderPage();
    const retry = screen.getByRole('button', { name: /Retry 3 failed rows/i });
    fireEvent.click(retry);

    await waitFor(() => expect(commitMutateAsync).toHaveBeenCalledTimes(1));
    // The SAME commit, on the same batch — not a second code path that could diverge.
    expect((commitMutateAsync.mock.calls[0][0] as { batchId: string }).batchId).toBe('b-1');
    // And it reports what happened in the operator's terms.
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/3 rows created on retry/);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/47 left alone/);
  });

  it('warns loudly about a row whose case exists but is unlinked, because a further retry would duplicate it', async () => {
    commitMutateAsync.mockResolvedValue({
      created: 1, skipped: 47, failed: 2, total: 50, done: 50, failures: [],
      unmarked: [{ sourceRow: 49, testCaseId: 'tc-99' }],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Retry 3 failed rows/i }));
    await waitFor(() => expect(vi.mocked(toast.warning)).toHaveBeenCalled());
    const warning = vi.mocked(toast.warning).mock.calls[0][0];
    expect(warning).toMatch(/would create duplicates/i);
    expect(warning).toContain('49');
  });

  it('offers no retry while the batch is committing or cancelled', () => {
    for (const status of [UAT_IMPORT_BATCH_STATUS.Committing, UAT_IMPORT_BATCH_STATUS.Cancelled]) {
      batchState.data = { ...batchState.data, pmo_status: status };
      const { unmount } = renderPage();
      expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
      unmount();
    }
  });

  it('keeps the page usable when the commit rejects', async () => {
    commitMutateAsync.mockRejectedValue(new Error('403'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Retry 3 failed rows/i }));
    // The rejection is already toasted and logged by useAppMutation; the page must not blank.
    await waitFor(() => expect(commitMutateAsync).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Retry 3 failed rows/i })).toBeTruthy();
  });
});

describe('the archived source file (T041) is reachable here', () => {
  it('mounts the batch\'s evidence panel, which is what makes the file downloadable', () => {
    renderPage();
    expect(screen.getByTestId('evidence-panel')).toBeTruthy();
    // The seventh parent kind, and this page is the surface T032 had none for.
    expect(evidenceMounts[0].parent).toBe('ImportBatch');
    expect(evidenceMounts[0].recordId).toBe('b-1');
    expect(evidenceMounts[0].projectId).toBe('p-1');
  });

  it('says what the attached file is for', () => {
    renderPage();
    expect(screen.getByText(/not a copy that has been edited since/i)).toBeTruthy();
  });
});

describe('loading and error states', () => {
  it('says it is loading rather than rendering an empty batch', () => {
    batchState.isPending = true;
    renderPage();
    expect(screen.getByText(/Loading the batch/i)).toBeTruthy();
  });

  it('offers a retry when the batch itself cannot be read', () => {
    batchState.isError = true;
    batchState.data = {};
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i);
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });
});
