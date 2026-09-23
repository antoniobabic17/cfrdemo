/**
 * Failed-saves tray — Stage 5 of the task-write reliability work.
 *
 * Persistent (no auto-dismiss) bottom-right list of failed PSS task updates.
 * Each entry exposes Retry (re-enqueues the captured patch through the same
 * per-task queue) and Dismiss. Sits ABOVE the regular toast bar with an
 * offset so transient toasts don't visually collide.
 */
import { useState } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import { useFailedSaves, dismissFailedSave, retryFailedSave, type FailedSave } from '../../lib/failedSavesStore';

/**
 * Map ScheduleTaskUpdate field keys to user-facing labels. Matches the labels
 * used in TaskDetailPanel so the tray copy reads the same as the form.
 */
const FIELD_LABELS: Record<string, string> = {
  subject: 'Title',
  description: 'Notes',
  priority: 'Priority',
  scheduledStart: 'Start',
  scheduledEnd: 'Due',
  duration: 'Duration',
  effort: 'Effort',
  effortCompleted: 'Progress',
  isMilestone: 'Milestone',
  bucketId: 'Bucket',
  progress: 'Progress',
};

function formatFields(fields: readonly string[]): string {
  if (fields.length === 0) return 'Update';
  return fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
}

function shortTaskId(taskId: string): string {
  // Optimistic ids look like "optimistic-1700000000000" — show as-is.
  if (taskId.startsWith('optimistic-')) return 'New task';
  // GUIDs: show first 8 chars for context without dominating the line.
  return taskId.slice(0, 8);
}

function FailedSaveCard({ save }: { save: FailedSave }) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryFailedSave(save.id);
      // On success the store removes this entry; the tray re-renders without it.
    } catch {
      // Failure path: the queue records a NEW failed save with a fresh id, and
      // retryFailedSave already dismissed the original. Nothing else to do.
    }
    // No setRetrying(false) needed — the component will unmount either way.
  }

  const tone = save.isQuota
    ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-rose-300 bg-rose-50 text-rose-900';
  const iconTone = save.isQuota ? 'text-amber-600' : 'text-rose-600';

  return (
    <div
      role="alert"
      className={`rounded-lg border px-3 py-2.5 shadow-md text-xs flex items-start gap-2 animate-in slide-in-from-bottom-2 ${tone}`}
    >
      <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${iconTone}`} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-semibold leading-tight">
          Couldn’t save: {formatFields(save.fields)}
          <span className="ml-1 font-normal opacity-60">({shortTaskId(save.taskId)})</span>
        </div>
        <div className="leading-snug opacity-80 break-words">{save.message}</div>
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded border border-current/30 px-2 py-0.5 font-medium hover:bg-white/50 disabled:opacity-50"
          >
            <RotateCcw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={() => dismissFailedSave(save.id)}
            className="text-[11px] opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => dismissFailedSave(save.id)}
        aria-label="Dismiss"
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function FailedSavesTray() {
  const saves = useFailedSaves();
  if (saves.length === 0) return null;
  return (
    // bottom-20 keeps us clear of the regular toast bar (which sits at bottom-4).
    <div className="fixed bottom-20 right-4 z-[101] flex flex-col gap-2 max-w-sm w-[22rem]">
      {saves.map((s) => (
        <FailedSaveCard key={s.id} save={s} />
      ))}
    </div>
  );
}
