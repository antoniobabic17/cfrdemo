import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { useAppErrorLog } from '../../hooks/useTelemetryEvents';
import { parseAppErrorPayload } from '../../lib/errorLog';
import { useRouteEntityLookup, annotateRouteWithNames } from '../../hooks/useRouteEntityLookup';
import type { TelemetryEvent } from '../../models/telemetryEvent.model';
import { AlertTriangle, Copy, RefreshCw, X, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from '../../hooks/useToast';
import { StagingSystemJobsPanel } from './StagingSystemJobsPanel';
import { ErrorLogAnalyticsTab } from './ErrorLogAnalyticsTab';
// PssOpSetDiagnosticTile removed 2026-07-22: since the 2026-07-21 sync-CustomAPI
// switch (commit 3c970fa), the client no longer opens PSS OperationSets, so
// the widget always shows 0/10 in-flight. File kept for rollback story only.
import { RepushConfirmModal } from '../../components/staging/RepushConfirmModal';
import { getStagingRow } from '../../api/taskStaging.api';
import { STAGING_SYNC_STATUS } from '../../lib/constants';
import type { TaskStagingRow } from '../../models/taskStaging.model';

/**
 * Admin > Error Log — two tabs:
 *
 *   1. Errors — one row per red toast that fired in the app.
 *      Every call to toast.error / toast.warning writes a pmo_telemetryevent
 *      with pmo_eventtype='AppError' via lib/errorLog.ts.
 *
 *   2. System Jobs — pmo_taskstaging flush activity + currently stuck rows,
 *      with per-row retry and mark-abandoned actions. See
 *      docs/staging-architecture.md for the full contract.
 *
 * NB: entries are best-effort writes -- users who lack Create on
 * pmo_telemetryevent (some team-role users) will not appear in this log for
 * their own errors. That's a Dataverse role gap to be fixed separately.
 */
type ErrorRow = {
  event: TelemetryEvent;
  payload: ReturnType<typeof parseAppErrorPayload>;
};

function ErrorsTab() {
  const { data: events = [], isLoading, error, refetch } = useAppErrorLog();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows: ErrorRow[] = useMemo(
    () => events.map((e) => ({ event: e, payload: parseAppErrorPayload(e.pmo_payload) })),
    [events],
  );

  const allRoutes = useMemo(
    () => rows.map((r) => r.payload.route ?? '').filter(Boolean),
    [rows],
  );
  const { labels: routeLabels } = useRouteEntityLookup(allRoutes);

  const selectedRow = selectedId ? rows.find((r) => r.event.pmo_telemetryeventid === selectedId) : null;

  // Timeline drill-down: when the selected row has a stagingRowId, gather
  // every AppError row sharing that stagingRowId (in createdon ASC order)
  // so admins can see the full retry lifecycle at a glance.
  const timelineRows: ErrorRow[] = useMemo(() => {
    if (!selectedRow || !selectedRow.payload.stagingRowId) return [];
    const sid = selectedRow.payload.stagingRowId;
    return rows
      .filter((r) => r.payload.stagingRowId === sid)
      .slice()
      .sort((a, b) => {
        const at = a.event.createdon ? new Date(a.event.createdon).getTime() : 0;
        const bt = b.event.createdon ? new Date(b.event.createdon).getTime() : 0;
        return at - bt;
      });
  }, [selectedRow, rows]);

  // Repush support -- fetch the current pmo_taskstaging row so we can
  // gate the button on its status and pass its full payload to the
  // RepushConfirmModal. Only queried when the details modal is open on
  // a row whose payload carries a stagingRowId.
  const stagingRowId = selectedRow?.payload.stagingRowId;
  const { data: stagingRow, isLoading: stagingRowLoading } = useQuery<TaskStagingRow | null>({
    queryKey: ['errorLogStagingRow', stagingRowId ?? 'none'],
    enabled: Boolean(stagingRowId),
    staleTime: 15 * 1000,
    retry: false,
    queryFn: async () => {
      if (!stagingRowId) return null;
      try { return await getStagingRow(stagingRowId); }
      catch { return null; } // 404 = retention job cleaned up; treat as no-repush.
    },
  });
  const [repushOpen, setRepushOpen] = useState(false);

  // Row-level Repush (2026-07-22): admins want a per-line button in the table
  // itself, not just inside the drilldown drawer. When set, we fetch the
  // staging row on-demand and open the same RepushConfirmModal.
  const [rowRepushStagingId, setRowRepushStagingId] = useState<string | null>(null);
  const { data: rowRepushStagingRow, isLoading: rowRepushLoading } = useQuery<TaskStagingRow | null>({
    queryKey: ['errorLogRowRepushStagingRow', rowRepushStagingId ?? 'none'],
    enabled: Boolean(rowRepushStagingId),
    staleTime: 5 * 1000,
    retry: false,
    queryFn: async () => {
      if (!rowRepushStagingId) return null;
      try { return await getStagingRow(rowRepushStagingId); }
      catch { return null; }
    },
  });

  const columns: DataTableColumn<ErrorRow>[] = [
    {
      key: 'createdon',
      header: 'Time',
      sortable: true,
      getValue: (r) => r.event.createdon ?? '',
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {r.event.createdon ? new Date(r.event.createdon).toLocaleString('en-US', {
            month: 'numeric', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          }) : '—'}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'User',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      getValue: (r) => r.event['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
      render: (r) => (
        <span className="text-sm text-foreground">
          {r.event['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
        </span>
      ),
    },
    {
      key: 'route',
      header: 'Page',
      sortable: true,
      getValue: (r) => r.payload.route ?? '',
      render: (r) => {
        const raw = r.payload.route ?? '';
        const annotated = annotateRouteWithNames(raw, routeLabels);
        return (
          <span
            className="block max-w-[320px] truncate text-xs text-muted-foreground font-mono"
            title={annotated || raw || ''}
          >
            {annotated || '—'}
          </span>
        );
      },
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      filterable: true,
      getValue: (r) => r.payload.action ?? '—',
      render: (r) => (
        <span
          className="block max-w-[180px] truncate text-xs text-muted-foreground"
          title={r.payload.action ?? ''}
        >
          {r.payload.action ?? '—'}
        </span>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      getValue: (r) => r.payload.message ?? '',
      render: (r) => (
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
          <span
            className="block max-w-[420px] text-sm text-foreground line-clamp-2"
            title={r.payload.message ?? ''}
          >
            {r.payload.message ?? '—'}
          </span>
        </div>
      ),
    },
    {
      key: 'attempt',
      header: 'Attempt',
      sortable: true,
      getValue: (r) => r.payload.attempt ?? '',
      render: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.payload.attempt !== undefined ? r.payload.attempt : '—'}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      sortable: true,
      filterable: true,
      filterMode: 'multi',
      filterOptions: [
        { value: 'succeeded',          label: 'Succeeded (after retry)' },
        { value: 'abandoned',          label: 'Abandoned by admin' },
        { value: 'gave-up-auto-retry', label: 'Gave up (auto-retry)' },
      ],
      getValue: (r) => r.payload.outcome ?? '',
      render: (r) => {
        const o = r.payload.outcome;
        if (!o) return <span className="text-xs text-muted-foreground">—</span>;
        const cls = o === 'succeeded'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : o === 'abandoned'
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';
        const label = o === 'succeeded'
          ? 'succeeded'
          : o === 'abandoned'
          ? 'abandoned'
          : 'gave up';
        return (
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
            {label}
          </span>
        );
      },
    },
    {
      // Row-level Repush action (2026-07-22). Only rendered when the AppError
      // row carries a stagingRowId -- i.e. it originated from a
      // pmo_taskstaging write. Direct-OData failures (e.g. status-report
      // creates) have no staging counterpart to repush and get an em-dash.
      key: 'repush',
      header: 'Repush',
      render: (r) => {
        const sid = r.payload.stagingRowId;
        if (!sid) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={(e) => {
              e.stopPropagation(); // don't open the details drawer
              setRowRepushStagingId(sid);
            }}
            title="Re-run this staged write. Confirmation modal shows the payload before firing."
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Repush
          </Button>
        );
      },
    },
  ];

  if (error) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {events.length} {events.length === 1 ? 'error' : 'errors'} logged
          {isLoading ? ' (loading…)' : ''}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { qc.invalidateQueries({ queryKey: ['appErrorLog'] }); void refetch(); }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
        </Button>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.event.pmo_telemetryeventid}
        isLoading={isLoading}
        emptyMessage="No errors logged yet. When a user sees a red toast, it'll appear here."
        storageKey="cfr_error_log_view"
        tableKey="errorLog"
        defaultSortKey="createdon"
        defaultSortDir="desc"
        exportFileName="ErrorLog"
        onRowClick={(r) => setSelectedId(r.event.pmo_telemetryeventid)}
      />

      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setSelectedId(null)}>
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-card border border-border rounded-lg shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-border">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Error details</p>
                <p className="text-sm font-medium text-foreground mt-1">
                  {selectedRow.payload.message ?? '(no message captured)'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Row id: <span className="font-mono">{selectedRow.event.pmo_telemetryeventid}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Time: </span>
                  {selectedRow.event.createdon ? new Date(selectedRow.event.createdon).toLocaleString() : '—'}
                </div>
                <div>
                  <span className="text-muted-foreground">User: </span>
                  {selectedRow.event['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                </div>
                {selectedRow.payload.route && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Page: </span>
                    <span className="font-mono break-all">
                      {annotateRouteWithNames(selectedRow.payload.route, routeLabels)}
                    </span>
                  </div>
                )}
                {selectedRow.payload.action && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Action: </span>
                    {selectedRow.payload.action}
                  </div>
                )}
                {selectedRow.payload.entityType && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Entity: </span>
                    {selectedRow.payload.entityType}
                    {selectedRow.payload.entityId ? <span className="font-mono ml-2 text-[10px]">({selectedRow.payload.entityId})</span> : null}
                  </div>
                )}
                {selectedRow.payload.userAgent && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">User agent: </span>
                    <span className="font-mono text-[10px] break-all">{selectedRow.payload.userAgent}</span>
                  </div>
                )}
              </div>

              {selectedRow.payload.rawError ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">Raw error</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(selectedRow.payload.rawError ?? '');
                          toast.success('Copied raw error to clipboard');
                        } catch {
                          toast.error('Could not copy to clipboard');
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />Copy
                    </Button>
                  </div>
                  <pre className="text-[10px] leading-relaxed bg-muted/40 border border-border/60 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-words">
                    {selectedRow.payload.rawError}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No raw error captured — the call site invoked toast.error without a rawError context.
                </p>
              )}

              {timelineRows.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                    Retry timeline ({timelineRows.length} entries)
                  </p>
                  <ol className="text-[11px] space-y-1 bg-muted/40 border border-border/60 rounded p-3 max-h-56 overflow-y-auto">
                    {timelineRows.map((tr) => {
                      const t = tr.event.createdon ? new Date(tr.event.createdon) : null;
                      const o = tr.payload.outcome;
                      const badge = o === 'succeeded'
                        ? <span className="inline-block mr-2 rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">succeeded</span>
                        : o === 'abandoned'
                        ? <span className="inline-block mr-2 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">abandoned</span>
                        : o === 'gave-up-auto-retry'
                        ? <span className="inline-block mr-2 rounded bg-rose-100 text-rose-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">gave up</span>
                        : <span className="inline-block mr-2 rounded bg-muted text-muted-foreground px-1.5 py-0.5 text-[9px] uppercase tracking-wider">failed</span>;
                      const attemptTxt = tr.payload.attempt !== undefined ? `Attempt ${tr.payload.attempt} — ` : '';
                      const isSelected = tr.event.pmo_telemetryeventid === selectedRow.event.pmo_telemetryeventid;
                      return (
                        <li key={tr.event.pmo_telemetryeventid} className={isSelected ? 'font-semibold' : ''}>
                          <span className="tabular-nums text-muted-foreground mr-2">
                            {t ? t.toLocaleTimeString() : '—'}
                          </span>
                          {badge}
                          <span className="text-foreground">{attemptTxt}{tr.payload.message ?? '(no message)'}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </div>

            {/* Footer -- Repush button when this error corresponds to a staging row.
                Disabled if the target row is Synced/Abandoned or has been
                retention-deleted. Clicking opens the shared RepushConfirmModal
                which shows the payload before firing the actual retry. */}
            {stagingRowId && (
              <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
                {stagingRowLoading ? (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking status…
                  </span>
                ) : !stagingRow ? (
                  <span className="text-xs text-muted-foreground italic">
                    Original save no longer available (retention or deleted). Repush disabled.
                  </span>
                ) : stagingRow.pmo_syncstatus === STAGING_SYNC_STATUS.Synced ? (
                  <span className="text-xs text-muted-foreground italic">
                    Already synced. Repush disabled.
                  </span>
                ) : stagingRow.pmo_syncstatus === STAGING_SYNC_STATUS.Abandoned ? (
                  <span className="text-xs text-muted-foreground italic">
                    Marked abandoned. Repush disabled.
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setRepushOpen(true)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Repush
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {repushOpen && stagingRow && (
        <RepushConfirmModal
          stagingRow={stagingRow}
          open={repushOpen}
          onClose={() => setRepushOpen(false)}
          onConfirmed={async () => {
            setRepushOpen(false);
            setSelectedId(null);
            await qc.invalidateQueries({ queryKey: ['adminStuckStagingRows'] });
            await qc.invalidateQueries({ queryKey: ['adminStagingFlushActivity'] });
            await qc.invalidateQueries({ queryKey: ['errorLogStagingRow', stagingRowId] });
          }}
        />
      )}

      {/* Row-level Repush modal (2026-07-22). Fired from the per-row Repush
          button in the errors table. Loads the target staging row on demand;
          shows a small loader tile while the fetch is in flight, then swaps
          in the real RepushConfirmModal so admins see the same payload
          preview + terminal-state guards used by the details-drawer path. */}
      {rowRepushStagingId && rowRepushLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-lg bg-card px-6 py-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading staging row…
          </div>
        </div>
      )}
      {rowRepushStagingId && !rowRepushLoading && !rowRepushStagingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRowRepushStagingId(null)}>
          <div className="rounded-lg bg-card px-6 py-4 text-sm max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-foreground font-medium mb-1">Cannot repush this row</p>
            <p className="text-muted-foreground text-xs">
              The original pmo_taskstaging row is no longer available (likely retention-deleted). Nothing to repush.
            </p>
            <Button size="sm" className="mt-3" onClick={() => setRowRepushStagingId(null)}>Close</Button>
          </div>
        </div>
      )}
      {rowRepushStagingId && rowRepushStagingRow && (
        <RepushConfirmModal
          stagingRow={rowRepushStagingRow}
          open={true}
          onClose={() => setRowRepushStagingId(null)}
          onConfirmed={async () => {
            const sid = rowRepushStagingId;
            setRowRepushStagingId(null);
            await qc.invalidateQueries({ queryKey: ['adminStuckStagingRows'] });
            await qc.invalidateQueries({ queryKey: ['adminStagingFlushActivity'] });
            await qc.invalidateQueries({ queryKey: ['errorLogRowRepushStagingRow', sid] });
            await qc.invalidateQueries({ queryKey: ['errorLogStagingRow', sid] });
            await qc.invalidateQueries({ queryKey: ['appErrorLog'] });
          }}
        />
      )}
    </div>
  );
}

export function ErrorLogPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Error Log"
        subtitle="User-visible failures and background sync activity."
      />
      <Tabs defaultValue="errors">
        <TabsList>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="system-jobs">System Jobs</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="errors" className="pt-4">
          <ErrorsTab />
        </TabsContent>
        <TabsContent value="system-jobs" className="pt-4">
          <StagingSystemJobsPanel />
        </TabsContent>
        <TabsContent value="analytics" className="pt-4">
          <ErrorLogAnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
