/**
 * Pure helper that shapes the payloads for the "mark complete" action
 * on both entry points into completion:
 *
 *   - TaskCompletionCheckbox commit-mode (tile / list / people cards)
 *   - TaskDetailPanel draft-mode (used to build the draft state at
 *     click time)
 *
 * The invariant this helper enforces: EFFORT IS USER-OWNED. If the
 * task has no effort estimate at click time we do NOT invent one, we
 * only bump hoursdone to a non-zero value so the derived status
 * flips to done. Prior behavior wrote pmo_taskeffort = 1 on every
 * blank-estimate task the moment the user clicked Complete -- see
 * the 2026-07-27 bug report ("effort=20/hoursdone=10 became
 * effort=1/hoursdone=1 on Complete").
 *
 * The task-detail-panel path piggybacks on this helper by seeding
 * only the hours-done draft input; effort draft is untouched. See
 * TaskDetailPanel.tsx around onDraftChange for the panel-side use.
 */
import type { ProjectTask } from '../models/projectTask.model';
import { getTaskEffort } from '../models/projectTask.model';

/** Fallback non-zero hoursdone target when the task has no effort
 *  estimate. deriveTaskStatus flips to done as soon as hoursdone >
 *  0 given no effort context, so 1 is a safe sentinel. This is NOT
 *  written to pmo_taskeffort. */
export const DEFAULT_HOURSDONE_TARGET = 1;

/** PSS (msdyn_*) side of a complete write. Fields are the domain
 *  keys used by useUpdateProjectTask -- the hook maps them to
 *  msdyn_effort / msdyn_effortcompleted internally. */
export interface CompletePssPatch {
  effortCompleted: number;
  effort?: number;
  /** Explicit 100%% completion signal. PSS ignores msdyn_progress (computes
   *  its own), but the CUSTOM path stores it as pmo_progress so deriveTaskStatus
   *  reads 'done' even when the task has no effort estimate (hoursdone-only).
   *  Without this a no-effort custom task never flips to done. */
  progress: number;
}

/** CVS-owned custom-column side of a complete write. Written via
 *  direct OData PATCH by useUpdateTaskCustomFields. */
export interface CompleteCvsPatch {
  pmo_taskhoursdone: number;
  pmo_taskeffort?: number;
}

export interface CompletePayload {
  /** True iff the task had a non-null, > 0 effort estimate. Callers
   *  use this to decide whether to also seed the effort input in
   *  the detail panel (they don't). */
  hasEffort: boolean;
  /** The hoursdone value that gets written to both sides. */
  hoursDoneTarget: number;
  pss: CompletePssPatch;
  cvs: CompleteCvsPatch;
}

/**
 * Shape the two-sided complete write for a given task.
 *
 * Rules:
 *   - hasEffort  -> hoursDoneTarget = effort. Write both effort +
 *     hoursdone on both sides. This is the "user has effort=20,
 *     hoursdone=10, marks complete" case: effort stays 20,
 *     hoursdone becomes 20, %% resolves to 100.
 *   - !hasEffort -> hoursDoneTarget = DEFAULT_HOURSDONE_TARGET.
 *     Write ONLY hoursdone on both sides. Effort stays whatever
 *     it was (null / undefined) so the user's blank estimate is
 *     preserved. Task still flips to done via the hoursdone > 0
 *     signal.
 */
export function buildCompletePayload(task: ProjectTask): CompletePayload {
  const effort = getTaskEffort(task);
  const hasEffort = effort !== undefined && effort > 0;
  const hoursDoneTarget = hasEffort ? effort : DEFAULT_HOURSDONE_TARGET;

  const pss: CompletePssPatch = { effortCompleted: hoursDoneTarget, progress: 100 };
  const cvs: CompleteCvsPatch = { pmo_taskhoursdone: hoursDoneTarget };
  if (hasEffort) {
    pss.effort = effort;
    cvs.pmo_taskeffort = effort;
  }
  return { hasEffort, hoursDoneTarget, pss, cvs };
}


// ─── New Resource Model completion guard ─────────────────────────────────────

export interface CompletionGuardResult {
  ok: boolean;
  /** Populated when ok=false — drives the pop-up message. */
  reason?: 'no_effort' | 'hours_mismatch';
  message?: string;
}

/**
 * Pre-completion guard for the New Resource Model.
 * Runs BEFORE buildCompletePayload / captureCompletionSnapshot / any mutation.
 *
 * Rules (exact per operator spec):
 *   1. Task must have Effort set (> 0).
 *   2. At least one assignee must be present AND the sum of their contributed
 *      hours must equal the task's effort exactly (== not >=).
 *
 * Returns { ok: true } when:
 *   - useNewResourceModel is false/undefined (old model — no restriction).
 *   - Both conditions pass.
 *
 * Returns { ok: false, reason, message } when either condition fails.
 */
export function checkNewModelCompletionGuard(
  task: ProjectTask,
  assignees: ReadonlyArray<{ contributedHours?: number | null }>,
  useNewResourceModel: boolean | undefined,
): CompletionGuardResult {
  if (!useNewResourceModel) return { ok: true };

  const effort = getTaskEffort(task);
  if (effort === undefined || effort <= 0) {
    return {
      ok: false,
      reason: 'no_effort',
      message: 'This task has no Effort set. Set an Effort value before marking it complete.',
    };
  }

  const totalAssigneeHours = assignees.reduce(
    (sum, a) => sum + (a.contributedHours ?? 0),
    0,
  );

  if (assignees.length === 0) {
    return {
      ok: false,
      reason: 'hours_mismatch',
      message: `This task has no one assigned. Assign at least one person and log hours totaling ${effort}h before marking it complete.`,
    };
  }

  if (totalAssigneeHours !== effort) {
    return {
      ok: false,
      reason: 'hours_mismatch',
      message: `Assignee hours (${totalAssigneeHours}h) don't add up to this task's Effort (${effort}h). Adjust assignee hours so they total exactly ${effort}h before marking it complete.`,
    };
  }

  return { ok: true };
}
