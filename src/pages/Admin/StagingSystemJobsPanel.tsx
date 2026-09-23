/**
 * System Jobs panel — rendered under Admin > Error Log > System Jobs tab.
 *
 * Two side-by-side panels:
 *   A. Recent flush activity — reads pmo_telemetryevent WHERE
 *      pmo_eventtype='StagingFlush' ORDER BY createdon DESC. Success + failure
 *      rows both appear; the pmo_source column carries 'success' | 'failed'.
 *   B. Currently stuck rows — reads pmo_taskstaging WHERE syncstatus IN
 *      (Failed, InFlight). Each row has Retry / Mark abandoned / View raw.
 *
 * Retry invokes pmo_FlushTaskStaging with ForceRetry=true and the specific
 * StagingIds — the plugin flips Failed → Pending and re-drains.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from '../../hooks/useAppMutation';
import { RefreshCw, AlertOctagon, CheckCircle2, XCircle, Play, Ban, X, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { DataTable, type DataTableColumn } from '../../components/data-table';
import * as dv from '../../lib/dataverseClient';
import {
  ENTITY_SETS,
  STAGING_FLUSH_EVENT_TYPE,
  STAGING_SYNC_STATUS,
  STAGING_ENTITY_TYPE,
  STAGING_OPERATION,
  type StagingEntityType,
  type StagingOperation,
  type StagingSyncStatus,
} from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { useWriteGuard, WriteForbiddenError } from '../../hooks/useWriteGuard';
import { logAppError } from '../../lib/errorLog';
import {
  listStuckStagingRows,
  updateStagingRow,
} from '../../api/taskStaging.api';
import type { TaskStagingRow } from '../../models/taskStaging.model';
import { RepushConfirmModal } from '../../components/staging/RepushConfirmModal';

// ── Types & helpers ─────────────────────────────────────────────────────────

interface FlushEventRow {
  pmo_telemetryeventid: string;
  pmo_eventtype: string;
  pmo_source?: string;
  pmo_payload: string;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

interface FlushPayload {
  opset_id?: string;
  rows_synced?: number;
  duration_ms?: number;
  error_raw?: string;
  error_code?: string;
  project_id?: string;
}

function safeParse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function entityTypeLabel(t: StagingEntityType): string {
  if (t === STAGING_ENTITY_TYPE.Task) return 'Task';
  if (t === STAGING_ENTITY_TYPE.Bucket) return 'Bucket';
  if (t === STAGING_ENTITY_TYPE.Dependency) return 'Dependency';
  if (t === STAGING_ENTITY_TYPE.Assignment) return 'Assignment';
  return String(t);
}

function operationLabel(o: StagingOperation): string {
  if (o === STAGING_OPERATION.Create) return 'Create';
  if (o === STAGING_OPERATION.Update) return 'Update';
  if (o === STAGING_OPERATION.Delete) return 'Delete';
  return String(o);
}

function statusLabel(s: StagingSyncStatus): string {
  if (s === STAGING_SYNC_STATUS.Pending)   return 'Pending';
  if (s === STAGING_SYNC_STATUS.InFlight)  return 'In flight';
  if (s === STAGING_SYNC_STATUS.Synced)    return 'Synced';
  if (s === STAGING_SYNC_STATUS.Failed)    return 'Failed';
  if (s === STAGING_SYNC_STATUS.Abandoned) return 'Abandoned';
  return String(s);
}

function statusPillClass(s: StagingSyncStatus): string {
  if (s === STAGING_SYNC_STATUS.Synced)   return 'bg-emerald-100 text-emerald-700';
  if (s === STAGING_SYNC_STATUS.Failed)   return 'bg-rose-100 text-rose-700';
  if (s === STAGING_SYNC_STATUS.InFlight) return 'bg-amber-100 text-amber-700';
  if (s === STAGING_SYNC_STATUS.Pending)  return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-500';
}

// ── Data hooks ──────────────────────────────────────────────────────────────

const FLUSH_ACTIVITY_KEY = ['adminStagingFlushActivity'] as const;
const STUCK_STAGING_KEY = ['adminStuckStagingRows'] as const;

function useFlushActivity() {
  return useQuery<FlushEventRow[]>({
    queryKey: FLUSH_ACTIVITY_KEY,
    queryFn: () =>
      dv.list<FlushEventRow>(ENTITY_SETS.telemetryEvent, {
        $select: [
          'pmo_telemetryeventid',
          'pmo_eventtype',
          'pmo_source',
          'pmo_payload',
          'createdon',
          '_pmo_project_value',
          '_createdby_value',
        ],
        $filter: `pmo_eventtype eq '${STAGING_FLUSH_EVENT_TYPE}' and statecode eq 0`,
        $orderby: 'createdon desc',
        $top: 200,
      }),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

function useStuckStagingRows() {
  return useQuery<TaskStagingRow[]>({
    queryKey: STUCK_STAGING_KEY,
    queryFn: listStuckStagingRows,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

// ── Panel A: recent flush activity ──────────────────────────────────────────

function FlushActivityPanel() {
  const { data: events = [], isLoading, error, refetch } = useFlushActivity();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(
    () => events.map((e) => ({
      event: e,
      payload: safeParse<FlushPayload>(e.pmo_payload) ?? {},
    })),
    [events],
  );

  type Row = typeof rows[number];

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'createdon',
      header: 'Time',
      sortable: true,
      getValue: (r) => r.event.createdon ?? '',
      render: (r) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatTime(r.event.createdon)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      getValue: (r) => r.event.pmo_source ?? '',
      render: (r) => {
        const ok = (r.event.pmo_source ?? '') === 'success';
        return (
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {ok ? 'Synced' : 'Failed'}
          </span>
        );
      },
    },
    {
      key: 'rows',
      header: 'Rows',
      sortable: true,
      getValue: (r) => r.payload.rows_synced ?? 0,
      render: (r) => <span className="text-xs tabular-nums">{r.payload.rows_synced ?? '—'}</span>,
    },
    {
      key: 'duration',
      header: 'Duration',
      sortable: true,
      getValue: (r) => r.payload.duration_ms ?? 0,
      render: (r) => <span className="text-xs tabular-nums text-muted-foreground">{r.payload.duration_ms ? `${(r.payload.duration_ms / 1000).toFixed(1)}s` : '—'}</span>,
    },
    {
      key: 'errorCode',
      header: 'Error code',
      sortable: true,
      getValue: (r) => r.payload.error_code ?? '',
      render: (r) => r.payload.error_code
        ? <span className="text-xs font-mono text-rose-700">{r.payload.error_code}</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: 'opSetId',
      header: 'OpSet',
      getValue: (r) => r.payload.opset_id ?? '',
      render: (r) => r.payload.opset_id
        ? <span className="text-[10px] font-mono text-muted-foreground" title={r.payload.opset_id}>{r.payload.opset_id.slice(0, 8)}…</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {events.length} flush {events.length === 1 ? 'event' : 'events'} in the last 24h
          {isLoading ? ' (loading…)' : ''}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { qc.invalidateQueries({ queryKey: FLUSH_ACTIVITY_KEY }); void refetch(); }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
        </Button>
      </div>
      {error && <p className="text-xs text-rose-600">Failed to load flush activity — {String((error as Error).message ?? error)}</p>}
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.event.pmo_telemetryeventid}
        isLoading={isLoading}
        emptyMessage="No flush activity yet. Once staging is enabled and users write, entries will appear here."
        storageKey="cfr_staging_flush_activity"
        onRowClick={(r) => setSelectedId(r.event.pmo_telemetryeventid)}
      />

      {(() => {
        const selected = selectedId ? rows.find((r) => r.event.pmo_telemetryeventid === selectedId) : null;
        if (!selected) return null;
        const ok = (selected.event.pmo_source ?? '') === 'success';
        const rowsSynced = selected.payload.rows_synced ?? 0;
        const durSec = selected.payload.duration_ms ? (selected.payload.duration_ms / 1000).toFixed(1) : null;
        const summary = ok
          ? ('Synced ' + rowsSynced + ' row' + (rowsSynced === 1 ? '' : 's') + (durSec ? ' in ' + durSec + 's' : ''))
          : (selected.payload.error_code ?? 'Flush failed');
        let rawText = '';
        if (ok) {
          try { rawText = JSON.stringify(JSON.parse(selected.event.pmo_payload ?? '{}'), null, 2); }
          catch { rawText = selected.event.pmo_payload ?? ''; }
        } else {
          rawText = selected.payload.error_raw ?? '';
        }
        const rawLabel = ok ? 'Raw payload' : 'Raw error';
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setSelectedId(null)}>
            <div
              className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-card border border-border rounded-lg shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Flush details</p>
                  <p className="text-sm font-medium text-foreground mt-1">{summary}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Row id: <span className="font-mono">{selected.event.pmo_telemetryeventid}</span>
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
                    {selected.event.createdon ? new Date(selected.event.createdon).toLocaleString() : '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">User: </span>
                    {selected.event['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Project: </span>
                    {selected.event['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                  </div>
                  {selected.payload.opset_id && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">OpSet id: </span>
                      <span className="font-mono break-all">{selected.payload.opset_id}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Rows synced: </span>
                    <span className="tabular-nums">{selected.payload.rows_synced ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration: </span>
                    <span className="tabular-nums">{durSec ? durSec + 's' : '—'}</span>
                  </div>
                  {selected.payload.error_code && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Error code: </span>
                      <span className="font-mono text-rose-700">{selected.payload.error_code}</span>
                    </div>
                  )}
                </div>

                {rawText ? (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-muted-foreground">{rawLabel}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(rawText);
                            toast.success('Copied ' + rawLabel.toLowerCase() + ' to clipboard');
                          } catch {
                            toast.error('Could not copy to clipboard');
                          }
                        }}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" />Copy
                      </Button>
                    </div>
                    <pre className="text-[10px] leading-relaxed bg-muted/40 border border-border/60 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-words">
                      {rawText}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No raw payload captured for this event.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Panel B: currently stuck rows ────────────────────────────────────────────

function StuckStagingRowsPanel() {
  const { data: rows = [], isLoading, error, refetch } = useStuckStagingRows();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const guard = useWriteGuard();

  // Fix 2026-07-20: retry is no longer a fire-on-click. Clicking Retry
  // opens the RepushConfirmModal which shows the payload; only after the
  // user hits "Confirm and repush" does the mutation fire. The shared
  // mutation body lives in hooks/useRepushStagingRow and is invoked
  // from within the modal.
  const [repushRow, setRepushRow] = useState<TaskStagingRow | null>(null);

  const abandonMut = useAppMutation({
    action: 'staging abandon',
    entityType: 'taskStaging',
    entityId: (row: TaskStagingRow) => row.pmo_taskstagingid,
    parentProjectId: (row: TaskStagingRow) => row['_pmo_project_value'],
    errorMessage: (_row, err) => `Mark abandoned failed: ${(err as Error).message}`,
    mutationFn: async (row: TaskStagingRow) => {
      // Abandoning a staging row -- admin-only.
      const v = guard('pmo_admin');
      if (!v.allow) throw new WriteForbiddenError(v.reason ?? 'Not allowed.', v.requiredRole);
      setBusyId(row.pmo_taskstagingid);
      await updateStagingRow(row.pmo_taskstagingid, {
        pmo_syncstatus: STAGING_SYNC_STATUS.Abandoned,
      });
      return row;
    },
    onSuccess: async (row) => {
      toast.success('Row marked abandoned.');
      // Terminal outcome log so Admin > Error Log shows a persistent
      // 'abandoned' pill for this lifecycle. Grouped with any prior
      // attempt failures via stagingRowId in the timeline drill-down.
      try {
        logAppError({
          message: 'Staging row marked abandoned by admin.',
          action: 'staging abandon ' + entityTypeLabel(row.pmo_entitytype),
          entityType: entityTypeLabel(row.pmo_entitytype),
          entityId: row.pmo_targetid,
          parentProjectId: row['_pmo_project_value'],
          attempt: row.pmo_attempts ?? 1,
          outcome: 'abandoned',
          stagingRowId: row.pmo_taskstagingid,
        });
      } catch { /* logging is best-effort */ }
      await qc.invalidateQueries({ queryKey: STUCK_STAGING_KEY });
    },
    onSettled: () => setBusyId(null),
  });

  const columns: DataTableColumn<TaskStagingRow>[] = [
    {
      key: 'createdon',
      header: 'Time',
      sortable: true,
      getValue: (r) => r.createdon ?? '',
      render: (r) => <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatTime(r.createdon)}</span>,
    },
    {
      key: 'user',
      header: 'User',
      sortable: true,
      filterable: true,
      getValue: (r) => r['_ownerid_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
      render: (r) => <span className="text-sm text-foreground">{r['_ownerid_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'project',
      header: 'Project',
      sortable: true,
      filterable: true,
      getValue: (r) => r['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] ?? '—',
      render: (r) => <span className="text-sm text-muted-foreground">{r['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}</span>,
    },
    {
      key: 'entity',
      header: 'Entity',
      sortable: true,
      getValue: (r) => entityTypeLabel(r.pmo_entitytype),
      render: (r) => <span className="text-xs">{entityTypeLabel(r.pmo_entitytype)}</span>,
    },
    {
      key: 'op',
      header: 'Op',
      sortable: true,
      getValue: (r) => operationLabel(r.pmo_operation),
      render: (r) => <span className="text-xs">{operationLabel(r.pmo_operation)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      getValue: (r) => statusLabel(r.pmo_syncstatus),
      render: (r) => (
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${statusPillClass(r.pmo_syncstatus)}`}>
          {statusLabel(r.pmo_syncstatus)}
        </span>
      ),
    },
    {
      key: 'attempts',
      header: 'Tries',
      sortable: true,
      getValue: (r) => r.pmo_attempts ?? 0,
      render: (r) => <span className="text-xs tabular-nums">{r.pmo_attempts ?? 0}</span>,
    },
    {
      key: 'error',
      header: 'Error',
      getValue: (r) => r.pmo_syncerror ?? '',
      render: (r) => (
        <span
          className="block max-w-[320px] truncate text-xs text-rose-700"
          title={r.pmo_syncerror ?? ''}
        >
          {r.pmo_syncerror ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      getValue: () => '',
      render: (r) => {
        const busy = busyId === r.pmo_taskstagingid;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || r.pmo_syncstatus !== STAGING_SYNC_STATUS.Failed}
              onClick={(e) => { e.stopPropagation(); setRepushRow(r); }}
              title="Open the repush confirmation modal for this row"
            >
              <Play className="h-3.5 w-3.5" />
              <span className="ml-1">Retry</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); abandonMut.mutate(r); }}
              title="Mark abandoned — row will no longer appear in overlay or stuck list"
            >
              <Ban className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {rows.length} stuck {rows.length === 1 ? 'row' : 'rows'}
          {isLoading ? ' (loading…)' : ''}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { qc.invalidateQueries({ queryKey: STUCK_STAGING_KEY }); void refetch(); }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
        </Button>
      </div>
      {error && <p className="text-xs text-rose-600">Failed to load stuck rows — {String((error as Error).message ?? error)}</p>}
      <DataTable
        data={rows}
        columns={columns}
        keyExtractor={(r) => r.pmo_taskstagingid}
        isLoading={isLoading}
        emptyMessage="No stuck rows. Nothing has failed or been stuck in flight."
        storageKey="cfr_staging_stuck_rows"
      />
      {repushRow && (
        <RepushConfirmModal
          stagingRow={repushRow}
          open={true}
          onClose={() => setRepushRow(null)}
          onConfirmed={async () => {
            setRepushRow(null);
            await qc.invalidateQueries({ queryKey: STUCK_STAGING_KEY });
            await qc.invalidateQueries({ queryKey: FLUSH_ACTIVITY_KEY });
          }}
        />
      )}
    </div>
  );
}

// ── Public component ────────────────────────────────────────────────────────

export function StagingSystemJobsPanel() {
  const { data: stuckRows = [] } = useStuckStagingRows();
  const failedCount = stuckRows.filter((r) => r.pmo_syncstatus === STAGING_SYNC_STATUS.Failed).length;

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-border/50 bg-muted/20 p-3 flex items-center gap-3">
        <AlertOctagon className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">
          Staging (pmo_taskstaging) is the queue between the app and the Project Scheduling Service.
          The flush plugin drains one project's pending rows into a single OperationSet, atomically.
        </p>
        {failedCount > 0 && (
          <span className="ml-auto shrink-0 rounded bg-rose-100 text-rose-700 text-xs font-medium px-2 py-0.5">
            {failedCount} failed
          </span>
        )}
      </div>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Recent flush activity</h3>
        <FlushActivityPanel />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Currently stuck rows</h3>
        <StuckStagingRowsPanel />
      </section>
    </div>
  );
}
