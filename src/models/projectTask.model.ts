/**
 * msdyn_projecttask — P4W task record.
 * Reads via OData. Writes via Project Operations scheduling actions
 * (msdyn_PssCreateV1, msdyn_PssUpdateV1, msdyn_PssDeleteV1 inside an OperationSet).
 * Direct OData PATCH is blocked by the scheduling service.
 */
export interface ProjectTask {
  msdyn_projecttaskid: string;
  // Auto-number (Dataverse-populated on Create via PSS). Format: TASK-{SEQNUM:00000}.
  // Existing tasks pre-dating the column add are NULL — PSS blocks direct PATCH so
  // they cannot be backfilled. New tasks created after 2026-06-30 auto-populate.
  pmo_taskid?: string;
  msdyn_subject: string;
  msdyn_description?: string;
  msdyn_scheduledstart?: string;
  msdyn_scheduledend?: string;          // tasks DO have scheduledend (unlike msdyn_project)
  msdyn_finish?: string;
  msdyn_duration?: number;
  msdyn_effort?: number;
  msdyn_effortcompleted?: number;
  msdyn_effortremaining?: number;
  msdyn_progress?: number;              // 0–100

  // CVS-owned effort tracking, decoupled from PSS's scheduling triangle.
  // Written via direct OData PATCH (custom columns on msdyn_projecttask are
  // NOT gated by the "cannot directly update" platform block that fires on
  // PSS-managed fields). Reports prefer these over msdyn_effort /
  // msdyn_effortcompleted; helpers below fall back to msdyn_* when null.
  pmo_taskeffort?: number;
  pmo_taskhoursdone?: number;
  /** Custom-source task labels as "name:#color;name:#color" (pmo_task.pmo_tasklabel).
   *  Parsed via lib/taskLabelText. Undefined on the PSS source. */
  pmo_tasklabel?: string;
  msdyn_priority?: number;
  msdyn_iscritical?: boolean;
  msdyn_ismilestone?: boolean;
  /** Manually-scheduled flag. On the custom source this is pmo_ismanuallyscheduled;
   *  the FS cascade pins a manual task's own dates but still propagates past it. */
  msdyn_ismanual?: boolean;
  msdyn_summary?: boolean;             // is a summary/parent task
  msdyn_outlinelevel?: number;
  msdyn_displaysequence?: number;       // sort order within bucket
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;
  '_msdyn_projectbucket_value'?: string;
  '_msdyn_projectbucket_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_msdyn_parenttask_value'?: string;
  '_msdyn_projectsprint_value'?: string;

  /** Transient UI flag — true while an optimistic write is in-flight. Never persisted. */
  _saving?: boolean;
}

/**
 * Display-progress helper. Returns a 0-100 percentage.
 *
 * Why this exists: PSS's stored msdyn_progress can drift out of sync with
 * the hours fields (effortcompleted / effort). E.g. an old slider-era write
 * left the percentage at one value while a later write changed effort but
 * PSS preserved the old percentage and back-solved completed. To the user
 * the bar visually disagrees with '4h done / 6h total'.
 *
 * Stage 7 contract: hours are the source of truth. If both effort and
 * effortcompleted are present and effort > 0, derive the percentage from
 * them. Otherwise fall back to msdyn_progress (e.g. summary tasks, which
 * roll up child progress and have no direct hours).
 */
/**
 * Resolve effective task effort. Prefer the CVS-owned pmo_taskeffort column
 * (writable via direct OData PATCH, never touched by PSS). Fall back to
 * msdyn_effort for tasks created before the pmo_* columns landed, or before
 * the user ever touched Hours on the task.
 */
export function getTaskEffort(task: ProjectTask): number | undefined {
  return task.pmo_taskeffort ?? task.msdyn_effort;
}

/**
 * Resolve effective hours-done. Prefer pmo_taskhoursdone; fall back to
 * msdyn_effortcompleted.
 */
export function getTaskHoursDone(task: ProjectTask): number | undefined {
  return task.pmo_taskhoursdone ?? task.msdyn_effortcompleted;
}

export function getDisplayProgressPct(task: ProjectTask): number {
  if (task.statecode === 1) return 100;
  const effort = getTaskEffort(task);
  const completed = getTaskHoursDone(task);
  if (effort !== undefined && effort > 0 && completed !== undefined) {
    return Math.min(100, Math.max(0, (completed / effort) * 100));
  }
  const raw = task.msdyn_progress ?? 0;
  // PSS stores progress as 0-1 sometimes, 0-100 other times.
  return raw > 0 && raw <= 1 ? raw * 100 : raw;
}

/** Fields editable via inline task editing or the create dialog. */
export interface TaskFormValues {
  subject: string;
  scheduledStart: string;
  scheduledEnd: string;
  isMilestone: boolean;
  progress: number;
  bucketId: string;
  parentTaskId?: string;
}
