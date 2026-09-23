/**
 * TaskCompletionCheckbox -- one-click mark-complete / reopen for a task.
 *
 * Two modes:
 *   - 'commit' (default): click fires the two mutations immediately.
 *     Used on board tiles, list rows, people cards, timeline -- anywhere
 *     there is no Save Changes button available.
 *   - 'draft': click reports the intended state up to the parent via
 *     onDraftChange, and reads the current draft back via draftValue.
 *     Used inside TaskDetailPanel so clicking the circle marks the
 *     panel dirty and lets Save Changes commit as part of the normal
 *     SubmitStep batch. Fixes 2026-07-16 report: "clicking the circle
 *     immediately spun the panel; Save Changes wasn't even an option."
 *
 * UI states (both modes):
 *   - Open task    -> progress ring (0-100% via purple arc)
 *   - Done task    -> emerald CheckCircle2, hover XCircle for reopen
 *   - Saving       -> Loader2 spinner (commit mode only)
 *
 * Commit-mode implementation:
 *   Mark complete   -> captureCompletionSnapshot then fire
 *     useUpdateProjectTask (PSS effortCompleted + effort seed) and
 *     useUpdateTaskCustomFields (direct OData pmo_taskeffort +
 *     pmo_taskhoursdone) in parallel.
 *   Reopen          -> popCompletionSnapshot and re-apply the exact
 *     effort tuple. No hardcoded fallback; missing snapshot -> Not
 *     Started (0h/0%).
 *   Errors surface via toast + logAppError.
 *
 * We do NOT touch statecode. PSS rejects statecode writes on
 * msdyn_projecttask (E_NOTEDITABLE); Done state is driven by
 * progress>=100.
 */
import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn, toFriendlyError, serializeError } from '../../lib/utils';
import { deriveTaskStatus } from '../../lib/taskStatus';
import {
  captureCompletionSnapshot,
  popCompletionSnapshot,
} from '../../lib/taskCompletionSnapshot';
import {
  useUpdateProjectTask,
  useUpdateTaskCustomFields,
} from '../../hooks/useProjectTaskMutations';
import type { ProjectTask } from '../../models/projectTask.model';
import { getDisplayProgressPct } from '../../models/projectTask.model';
import { buildCompletePayload, checkNewModelCompletionGuard, type CompletionGuardResult } from '../../lib/taskCompletionPayload';
import { GuardAlertDialog } from '../common/GuardAlertDialog';
import type { TaskAssignee } from './TaskRow';
import { toast } from '../../hooks/useToast';
import { logAppError } from '../../lib/errorLog';
import { useChangeAudit } from '../../hooks/useChangeAudit';

/**
 * Progress ring SVG. Base grey circle plus a violet arc starting at
 * 12 o'clock, sweeping clockwise proportional to progress (0-100%).
 * Lets the user tell 0h from 10-of-20h at a glance.
 */
function ProgressRing({ progress, size, className }: { progress: number; size: 'sm' | 'md'; className?: string }) {
  const pct = Math.max(0, Math.min(100, progress));
  const dim = size === 'md' ? 20 : 16;
  const stroke = 2;
  const r = (dim - stroke) / 2;
  const cx = dim / 2;
  const cy = dim / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  return (
    <svg
      width={dim}
      height={dim}
      viewBox={`0 0 ${dim} ${dim}`}
      className={className}
      style={{ transform: 'rotate(-90deg)' }}
      aria-hidden
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} opacity={0.35} />
      {pct > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          className="text-violet-500"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      )}
    </svg>
  );
}

/** Draft state reported to the parent in 'draft' mode.
 *  - null  -> user hasn't toggled the checkbox this session; parent
 *             uses task's own status.
 *  - true  -> user wants task marked complete on next save.
 *  - false -> user wants task reopened on next save. */
export type CompletionDraft = boolean | null;

interface Props {
  task: ProjectTask;
  projectId: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Commit mode (default) fires the mutations immediately. Draft mode
   *  reports intent via onDraftChange and reads back via draftValue --
   *  used by TaskDetailPanel so clicking the circle sets isDirty and
   *  Save Changes runs the write as part of its SubmitStep batch. */
  mode?: 'commit' | 'draft';
  draftValue?: CompletionDraft;
  onDraftChange?: (next: CompletionDraft) => void;
  /** Whether the project uses the New Resource Model. When true, completion
   *  requires effort set AND assignee hours == effort. */
  useNewResourceModel?: boolean;
  /** Per-task assignees (with contributedHours) — used by the NRM guard. */
  assignees?: TaskAssignee[];
}


export function TaskCompletionCheckbox({
  task,
  projectId,
  disabled = false,
  size = 'sm',
  mode = 'commit',
  draftValue = null,
  onDraftChange,
  useNewResourceModel = false,
  assignees = [],
}: Props) {
  // Underlying status from the server task.
  const serverStatus = deriveTaskStatus(task);
  const serverIsDone = serverStatus === 'done';

  // Effective "done" for rendering: in draft mode the user's toggle
  // wins over the server value so the icon flips immediately even
  // before Save Changes fires. Null draft means "no user override
  // this session" and we fall back to server.
  const isDone = mode === 'draft' && draftValue !== null ? draftValue : serverIsDone;

  const [hover, setHover] = useState(false);
  const [guardError, setGuardError] = useState<CompletionGuardResult | null>(null);
  const auditChange = useChangeAudit();
  const updateTask = useUpdateProjectTask(projectId);
  const updateCustomFields = useUpdateTaskCustomFields(projectId);
  // Include task._saving in the isSaving gate so the checkbox is inert
  // while the underlying task is still being created OR updated via a
  // Pending/InFlight staging row. Without this, clicking Complete on a
  // synthetic Pending-Create card fires a mutation against a client-
  // generated GUID that doesn't exist server-side, producing the
  // "Invalid entity msdyn_projecttask with Id ..." errors Tracey hit on
  // 2026-07-20 (rows 5, 1, 9 in her session).
  const stagingSaving = task._saving === true;
  const isSaving = stagingSaving || (mode === 'commit' && (updateTask.isPending || updateCustomFields.isPending));
  const iconSize = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';

  async function handleCommitComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled || isSaving) return;
    const guard = checkNewModelCompletionGuard(task, assignees, useNewResourceModel);
    if (!guard.ok) { setGuardError(guard); return; }
    captureCompletionSnapshot(task.msdyn_projecttaskid, task);
    // Payload shaping is in a pure helper so both the tile-checkbox
    // path (here) and the panel-draft path stay in lockstep and are
    // unit-testable without React. See taskCompletionPayload.ts for
    // the effort-is-user-owned invariant.
    const payload = buildCompletePayload(task);
    try {
      await Promise.all([
        updateTask.mutateAsync({
          taskId: task.msdyn_projecttaskid,
          ...payload.pss,
        }),
        updateCustomFields.mutateAsync({
          taskId: task.msdyn_projecttaskid,
          patch: payload.cvs,
        }),
      ]);
      // Success: emit an EntityChange audit row so the Change History
      // page can render "<user> marked <task> complete at <timestamp>".
      // Modeled as a relationship-shape entry (kind='relationship') with
      // relation='completion' so it's visually distinct from field
      // diffs on the timeline. Fire-and-forget; useChangeAudit swallows
      // its own errors.
      auditChange({
        entityType: 'task',
        entityId: task.msdyn_projecttaskid,
        entityName: task.msdyn_subject,
        action: 'update',
        changes: [{ kind: 'relationship', relation: 'completion', action: 'update', label: 'marked complete', old: false, new: true }],
        parentProjectId: projectId,
      });
    } catch (err) {
      const friendly = toFriendlyError(err);
      toast.error(`Couldn't mark task complete: ${friendly}`);
      try {
        logAppError({
          message: `Failed to mark task complete: ${friendly}`,
          rawError: serializeError(err),
          action: 'task complete checkbox',
          entityType: 'task',
          entityId: task.msdyn_projecttaskid,
          parentProjectId: projectId,
        });
      } catch { /* best-effort */ }
    }
  }

  async function handleCommitReopen(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled || isSaving) return;
    const snap = popCompletionSnapshot(task.msdyn_projecttaskid);
    const restoredEffort = snap?.effort;
    const restoredHoursDone = snap?.effortCompleted ?? 0;
    try {
      await Promise.all([
        updateTask.mutateAsync({
          taskId: task.msdyn_projecttaskid,
          effortCompleted: restoredHoursDone,
          ...(restoredEffort !== undefined ? { effort: restoredEffort } : {}),
          // Clear the custom-path pmo_progress completion signal so a
          // no-effort task doesn't stay 'done' after reopen (PSS ignores this).
          progress: restoredEffort && restoredEffort > 0 ? Math.min(100, (restoredHoursDone / restoredEffort) * 100) : 0,
        }),
        updateCustomFields.mutateAsync({
          taskId: task.msdyn_projecttaskid,
          patch: {
            pmo_taskeffort: restoredEffort ?? null,
            pmo_taskhoursdone: snap?.effortCompleted ?? null,
          },
        }),
      ]);
      // Success: emit the mirror EntityChange audit row for reopen.
      auditChange({
        entityType: 'task',
        entityId: task.msdyn_projecttaskid,
        entityName: task.msdyn_subject,
        action: 'update',
        changes: [{ kind: 'relationship', relation: 'completion', action: 'update', label: 'reopened', old: true, new: false }],
        parentProjectId: projectId,
      });
    } catch (err) {
      const friendly = toFriendlyError(err);
      toast.error(`Couldn't reopen task: ${friendly}`);
      try {
        logAppError({
          message: `Failed to reopen task: ${friendly}`,
          rawError: serializeError(err),
          action: 'task reopen checkbox',
          entityType: 'task',
          entityId: task.msdyn_projecttaskid,
          parentProjectId: projectId,
        });
      } catch { /* best-effort */ }
    }
  }

  function handleDraftClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    // Toggle: if already "done" (either via draft or server), draft
    // flips to false (reopen). Else draft flips to true (complete).
    // If the resulting draft matches the server state, clear the
    // draft to null so Save Changes doesn't include a no-op step.
    const next = !isDone;
    // NRM completion guard for draft mode: NOT run here — the guard runs at
    // Save Changes time in TaskDetailPanel.handleSubmit against the current
    // draft values (effort draft, assignee hours drafts). Running it here
    // would use stale server values and block the circle click even when the
    // user has already edited effort/hours in the panel drafts.
    onDraftChange?.(next === serverIsDone ? null : next);
  }

  if (isSaving) {
    return (
      <button
        type="button"
        disabled
        className={cn('shrink-0 flex items-center justify-center opacity-60 cursor-not-allowed')}
        title="Saving…"
      >
        <Loader2 className={cn(iconSize, 'animate-spin text-muted-foreground')} />
      </button>
    );
  }

  if (isDone) {
    const onClick = mode === 'draft' ? handleDraftClick : handleCommitReopen;
    return (
      <>
        <button
          type="button"
          onClick={onClick}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          disabled={disabled}
          className={cn(
            'shrink-0 flex items-center justify-center transition-colors',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
          title={disabled ? 'Read-only' : (mode === 'draft' ? 'Reopen (Save Changes to apply)' : 'Reopen task')}
          aria-label={disabled ? 'Task is done (read-only)' : 'Reopen task'}
        >
          {hover && !disabled ? (
            <XCircle className={cn(iconSize, 'text-rose-500')} />
          ) : (
            <CheckCircle2 className={cn(iconSize, 'text-emerald-500')} />
          )}
        </button>
        {guardError && (
          <GuardAlertDialog
            open={!!guardError}
            title="Can't complete this task"
            message={guardError.message ?? 'This task does not meet the requirements to be marked complete.'}
            onClose={() => setGuardError(null)}
          />
        )}
      </>
    );
  }

  const pct = getDisplayProgressPct(task);
  const titleSuffix = pct > 0 && pct < 100 ? ` (${Math.round(pct)}%)` : '';
  const onClick = mode === 'draft' ? handleDraftClick : handleCommitComplete;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'shrink-0 flex items-center justify-center transition-colors',
          disabled
            ? 'cursor-not-allowed opacity-50 text-muted-foreground'
            : 'cursor-pointer text-muted-foreground hover:text-emerald-500',
        )}
        title={disabled ? 'Read-only' : (mode === 'draft' ? `Mark complete (Save Changes to apply)${titleSuffix}` : `Mark complete${titleSuffix}`)}
        aria-label={disabled ? 'Mark complete (read-only)' : 'Mark complete'}
      >
        <ProgressRing progress={pct} size={size} />
      </button>
      {guardError && (
        <GuardAlertDialog
          open={!!guardError}
          title="Can't complete this task"
          message={guardError.message ?? 'This task does not meet the requirements to be marked complete.'}
          onClose={() => setGuardError(null)}
        />
      )}
    </>
  );
}
