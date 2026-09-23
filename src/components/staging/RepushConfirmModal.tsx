/**
 * Confirmation modal for repushing a stuck / failed pmo_taskstaging row.
 *
 * Two-step click flow requested by operator (2026-07-20 Tracey follow-up):
 * user clicks Repush somewhere -> this modal opens -> shows the payload we
 * are about to send -> user clicks "Confirm and repush" to actually fire.
 *
 * Displays:
 *   - Human-readable summary of the operation (via summarizeStagingRow)
 *   - Collapsible raw JSON payload (via formatRawPayload)
 *   - Metadata: original user, timestamp, project, target id, attempts,
 *     most-recent error
 *   - Amber warning banner when attempts >= 3 (suggests Abandon)
 *   - Footer: Cancel + Confirm and repush
 */
import { useState } from 'react';
import { Copy, Loader2, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from '../../hooks/useToast';
import { useRepushStagingRow } from '../../hooks/useRepushStagingRow';
import { summarizeStagingRow, formatRawPayload } from '../../lib/stagingPayloadSummary';
import { STAGING_SYNC_STATUS } from '../../lib/constants';
import type { TaskStagingRow } from '../../models/taskStaging.model';

interface Props {
  stagingRow: TaskStagingRow;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful (or intentionally-skipped) repush. */
  onConfirmed: () => void;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function RepushConfirmModal({ stagingRow, open, onClose, onConfirmed }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const repush = useRepushStagingRow();

  if (!open) return null;

  const summary = summarizeStagingRow(stagingRow);
  const raw = formatRawPayload(stagingRow);
  const attempts = stagingRow.pmo_attempts ?? 0;
  const isMuchTried = stagingRow.pmo_syncstatus === STAGING_SYNC_STATUS.Failed && attempts >= 3;
  const targetShort = stagingRow.pmo_targetid?.slice(0, 8) ?? '—';

  const handleConfirm = () => {
    repush.mutate(stagingRow, {
      onSuccess: (outcome) => {
        if (outcome?.skipped === 'in-flight') {
          toast.info('Row is already in flight — no action needed.');
        } else {
          toast.success('Repush queued.');
        }
        onConfirmed();
      },
      // errorMessage in useRepushStagingRow already produces the toast
      // via useAppMutation; nothing else to do here.
    });
  };

  const copyRaw = () => {
    try {
      navigator.clipboard.writeText(raw);
      toast.success('Copied raw payload to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-card border border-border rounded-lg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Repush this change?</p>
            <p className="text-sm font-medium text-foreground mt-1">{summary}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              This will re-run the same operation the user originally attempted.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Warning for high-attempt rows */}
          {isMuchTried && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This row has already failed {attempts} times. Consider <strong>Mark Abandoned</strong> instead if the payload is invalid.
              </span>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">User: </span>
              {stagingRow['_ownerid_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">Created: </span>
              {formatTime(stagingRow.createdon)}
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Project: </span>
              {stagingRow['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
            </div>
            <div>
              <span className="text-muted-foreground">Target: </span>
              <span className="font-mono">{targetShort}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Attempts: </span>
              <span className="tabular-nums">{attempts}</span>
            </div>
            {stagingRow.pmo_syncerror && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Most recent error: </span>
                <span className="text-rose-700">{stagingRow.pmo_syncerror}</span>
              </div>
            )}
          </div>

          {/* Collapsible raw payload */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {showRaw ? '▼' : '▶'} Show raw payload
              </button>
              {showRaw && (
                <Button size="sm" variant="outline" onClick={copyRaw}>
                  <Copy className="h-3.5 w-3.5 mr-1" />Copy
                </Button>
              )}
            </div>
            {showRaw && (
              <pre className="text-[10px] leading-relaxed bg-muted/40 border border-border/60 rounded p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-words">
                {raw}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={repush.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={repush.isPending}>
            {repush.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Confirm and repush
          </Button>
        </div>
      </div>
    </div>
  );
}
