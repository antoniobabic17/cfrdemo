/**
 * ImportBatchPage — what happened to every row, and a retry that touches only the failures.
 *
 * **The failure list is the page's reason to exist.** The legacy import's own report named no
 * row and gave no reason, so a run that lost 98% of its rows and a run that worked looked
 * identical. Here every failed row shows the number it has in the operator's own file and the
 * sentence explaining it, and the list is filterable to failures alone because with 500 rows
 * scrolling for the three that failed is the same as not reporting them.
 *
 * **Retry processes only the failures, and that is structural rather than filtered.** It calls
 * the same commit loop; rows that already produced a test case carry the sentinel and are
 * skipped. There is no "retry" code path that could behave differently from the first pass —
 * which is the property that makes pressing it twice safe, and the reason the button says what
 * it will do rather than just "Retry".
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Loader2, Paperclip } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { toast } from '../../../hooks/useToast';
import {
  useUatImportBatch,
  useUatImportRows,
  useUatImportCommit,
  type CommitProgress,
} from '../hooks/useUatImportCommit';
import { UatEvidenceFor } from '../components/UatAttachmentMounts';
import {
  UAT_IMPORT_BATCH_STATUS,
  UAT_IMPORT_BATCH_STATUS_LABELS,
  UAT_IMPORT_ROW_STATUS,
  UAT_IMPORT_ROW_STATUS_LABELS,
} from '../../../lib/uatOptionSets';
import { readProjectValue } from '../../../lib/projectLookupRef';

type RowFilter = 'all' | 'failed';

export function ImportBatchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RowFilter>('failed');
  const [progress, setProgress] = useState<CommitProgress | null>(null);

  const batchQuery = useUatImportBatch(id);
  const rowsQuery = useUatImportRows(id);
  const batch = batchQuery.data;
  const projectId = batch ? readProjectValue(batch) ?? '' : '';
  const commit = useUatImportCommit(projectId);

  const rows = rowsQuery.data ?? [];
  const failedRows = useMemo(
    () => rows.filter((row) => row.pmo_status === UAT_IMPORT_ROW_STATUS.Failed),
    [rows],
  );
  const shown = filter === 'failed' ? failedRows : rows;

  async function handleRetry() {
    if (!id) return;
    try {
      const summary = await commit.mutateAsync({ batchId: id, onProgress: setProgress });
      toast.success(
        `${summary.created} row${summary.created === 1 ? '' : 's'} created on retry`
        + (summary.skipped > 0 ? `, ${summary.skipped} left alone` : '')
        + (summary.failed > 0 ? `, ${summary.failed} still failing` : '') + '.',
      );
      if (summary.unmarked.length > 0) {
        // The one state that needs a person: a case exists whose row does not know it.
        toast.warning(
          `${summary.unmarked.length} test case(s) were created but could not be linked to their `
          + 'row. Retrying would create duplicates — check rows '
          + `${summary.unmarked.map((u) => u.sourceRow).join(', ')} before pressing again.`,
        );
      }
    } catch {
      // useAppMutation toasted and logged it. The batch is unchanged and can be retried.
    }
  }

  if (batchQuery.isPending) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the batch…
      </div>
    );
  }
  if (batchQuery.isError || !batch) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-destructive" role="alert">
          This import batch could not be loaded. It may have been deleted.
        </p>
        <Button variant="outline" size="sm" onClick={() => void batchQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const statusLabel = UAT_IMPORT_BATCH_STATUS_LABELS[batch.pmo_status ?? -1] ?? 'Unknown';
  const canRetry = failedRows.length > 0
    && batch.pmo_status !== UAT_IMPORT_BATCH_STATUS.Committing
    && batch.pmo_status !== UAT_IMPORT_BATCH_STATUS.Cancelled;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{batch.pmo_name || 'Import batch'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {batch.pmo_filename ?? 'an uploaded file'} · {statusLabel}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}?tab=uat`)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to the project
        </Button>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm" data-testid="uat-batch-counts">
        <div>
          <dt className="text-muted-foreground">Rows</dt>
          <dd className="tabular-nums font-medium">{batch.pmo_rowcount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="tabular-nums font-medium">{batch.pmo_createdcount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Skipped</dt>
          <dd className="tabular-nums font-medium">{batch.pmo_skippedcount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Failed</dt>
          <dd className="tabular-nums font-medium">{batch.pmo_failedcount ?? 0}</dd>
        </div>
      </dl>

      <section className="space-y-3" aria-label="Rows">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={filter === 'failed' ? 'default' : 'outline'}
              onClick={() => setFilter('failed')}
            >
              Failed ({failedRows.length})
            </Button>
            <Button
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              onClick={() => setFilter('all')}
            >
              All ({rows.length})
            </Button>
          </div>
          {canRetry && (
            <Button size="sm" onClick={() => void handleRetry()} disabled={commit.isPending}>
              {commit.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}
              Retry {failedRows.length} failed row{failedRows.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>

        {commit.isPending && progress && (
          <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {progress.done} of {progress.total} — {progress.created} created,{' '}
            {progress.skipped} left alone, {progress.failed} still failing
          </p>
        )}

        {rowsQuery.isPending && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading rows…
          </p>
        )}
        {rowsQuery.isError && (
          <p className="text-sm text-destructive" role="alert">
            The rows could not be loaded. They still exist — this is a read failure.
          </p>
        )}

        {!rowsQuery.isPending && !rowsQuery.isError && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {filter === 'failed'
              ? 'No rows failed in this batch.'
              : 'This batch has no rows.'}
          </p>
        )}

        {shown.length > 0 && (
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-sm" data-testid="uat-batch-rows">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 w-20">Row</th>
                  <th className="text-left px-3 py-2 w-32">Outcome</th>
                  <th className="text-left px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.pmo_uatimportrowid} className="border-t border-border align-top">
                    {/* The number in the operator's OWN file. A Dataverse guid here would make
                        the report unusable by the person who has to fix the spreadsheet. */}
                    <td className="px-3 py-1.5 tabular-nums">{row.pmo_sourcerownumber ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {UAT_IMPORT_ROW_STATUS_LABELS[row.pmo_status ?? -1] ?? 'Unknown'}
                    </td>
                    <td className="px-3 py-1.5">{row.pmo_failurereason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        The archived source file (T041), and any evidence attached to the batch. Mounted
        through the shared registry, which also closes T032's ImportBatch parent — the
        seventh, and the one with no surface until this page existed.
      */}
      <section aria-label="Source file">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          The file this batch was created from is attached below. Open it to download exactly
          what was uploaded, not a copy that has been edited since.
        </p>
        <UatEvidenceFor parent="ImportBatch" recordId={id} projectId={projectId} />
      </section>
    </div>
  );
}

export default ImportBatchPage;
