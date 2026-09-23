/**
 * Option-C custom-source read helpers for pmo_task / pmo_bucket /
 * pmo_taskdependency. See docs/pss-decoupling-c-design.md.
 *
 * Reads from our own custom tables. Normalizes back into the existing
 * `ProjectTask` shape so downstream consumers (hooks, components, tests)
 * see identical types regardless of source. This is the read-side of the
 * Phase-3 migration; writes still route through PSS during Phase 3 and
 * only flip in Phase 4.
 */

import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { ProjectTask } from '../models/projectTask.model';
import { computeDurationDays } from '../lib/taskDuration';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

/** Raw pmo_task shape as it comes out of Dataverse. Only fields we
 *  actually consume during Phase 3 reads. Kept private to this module --
 *  everything else in the app continues to see the ProjectTask type
 *  after normalizeCustomTask() runs. */
interface PmoTaskRow {
  pmo_taskid: string;
  pmo_tasknumber?: string | null;
  pmo_subject?: string | null;
  pmo_description?: string | null;
  pmo_startdate?: string | null;
  pmo_duedate?: string | null;
  pmo_duration?: number | null;
  pmo_effort?: number | null;
  pmo_effortcompleted?: number | null;
  pmo_progress?: number | null;
  pmo_outlinelevel?: number | null;
  pmo_orderinbucket?: number | null;
  pmo_ismilestone?: boolean | null;
  pmo_ismanuallyscheduled?: boolean | null;
  pmo_iscritical?: boolean | null;
  pmo_status?: number | null;
  pmo_priority?: number | null;
  pmo_priorityvalue?: number | null;
  pmo_tasklabel?: string | null;
  statecode?: 0 | 1;
  createdon?: string;
  _pmo_projectref_value?: string | null;  // NEW -> pmo_project (Tier 1 decoupling)
  _pmo_bucket_value?: string | null;
  _pmo_summarytask_value?: string | null;
  _pmo_sprint_value?: string | null;
}

const SET = 'pmo_tasks';

const BASE_SELECT: string[] = [
  'pmo_taskid',
  'pmo_tasknumber',
  'pmo_subject',
  'pmo_description',
  'pmo_startdate',
  'pmo_duedate',
  'pmo_duration',
  'pmo_effort',
  'pmo_effortcompleted',
  'pmo_progress',
  'pmo_outlinelevel',
  'pmo_orderinbucket',
  'pmo_ismilestone',
  'pmo_ismanuallyscheduled',
  'pmo_iscritical',
  'pmo_status',
  'pmo_priority',
  'pmo_priorityvalue',
  'pmo_tasklabel',
  'statecode',
  'createdon',
  '_pmo_projectref_value',
  '_pmo_bucket_value',
  '_pmo_summarytask_value',
  '_pmo_sprint_value',
];

/**
 * Normalize a raw pmo_task row into the ProjectTask shape the rest of
 * the app already consumes. The lookup values are re-labeled to the
 * msdyn_* underscore-prefixed convention used by every downstream
 * hook + renderer so nothing else has to change.
 *
 * Fields we cannot recover from pmo_task alone (msdyn_summary, msdyn_duration)
 * are left undefined -- ProjectTask marks them optional and downstream
 * code treats undefined as "no data".
 */
export function normalizeCustomTask(row: PmoTaskRow): ProjectTask {
  return {
    // PK: keep the same Guid on both sides -- Phase 2 mirror
    // guarantees pmo_taskid (GUID) === msdyn_projecttaskid
    msdyn_projecttaskid: row.pmo_taskid,
    // Friendly display id (TASK-#####). On msdyn this lives in `pmo_taskid`;
    // on pmo_task the GUID PK occupies `pmo_taskid`, so the autonumber is a
    // separate column `pmo_tasknumber`. Map it into the field the UI renders
    // as the task id so the tile shows TASK-##### (not the GUID).
    pmo_taskid:          row.pmo_tasknumber ?? undefined,

    msdyn_subject:       row.pmo_subject ?? '',
    msdyn_description:   row.pmo_description ?? undefined,

    // Date fields: pmo stores a bare YYYY-MM-DD (Edm.Date). The app's date
    // renderers do `new Date(iso).toLocaleDateString()`, which parses a bare
    // date as midnight UTC and shows the PREVIOUS day west of UTC (8/4 -> 8/3).
    // Expand to noon-UTC on read so the rendered local day matches the picked
    // day. toDateInput/fromDateInput in TaskDetailPanel slice(0,10) so the
    // <input type="date"> round-trips cleanly either way.
    msdyn_scheduledstart: edmDateToNoonUtc(row.pmo_startdate),
    msdyn_scheduledend:   edmDateToNoonUtc(row.pmo_duedate),
    msdyn_finish:         edmDateToNoonUtc(row.pmo_duedate),
    msdyn_duration:       row.pmo_duration ?? undefined,

    // Effort/hours-done: bridge to BOTH the msdyn_* and pmo_* effort
    // columns so getTaskEffort() / getTaskHoursDone() helpers keep
    // working (they prefer pmo_* over msdyn_*).
    msdyn_effort:              row.pmo_effort ?? undefined,
    msdyn_effortcompleted:     row.pmo_effortcompleted ?? undefined,
    msdyn_effortremaining:     row.pmo_effort != null && row.pmo_effortcompleted != null
                                 ? Math.max(0, row.pmo_effort - row.pmo_effortcompleted)
                                 : undefined,
    pmo_taskeffort:            row.pmo_effort ?? undefined,
    pmo_taskhoursdone:         row.pmo_effortcompleted ?? undefined,
    msdyn_progress:            row.pmo_progress ?? undefined,

    // Priority: prefer the raw Planner integer (pmo_priorityvalue) which
    // matches msdyn_priority 1:1 (1=Urgent/3=Important/5=Medium/9=Low). The
    // legacy 3-value pmo_priority picklist is ignored (lossy, superseded).
    msdyn_priority:            row.pmo_priorityvalue ?? undefined,
    msdyn_iscritical:          row.pmo_iscritical ?? undefined,
    msdyn_ismilestone:         row.pmo_ismilestone ?? undefined,
    // Manual-schedule flag — surfaced so the FS cascade can pin a manual task's
    // own dates while still propagating the shift to its successors.
    msdyn_ismanual:            row.pmo_ismanuallyscheduled ?? undefined,
    msdyn_outlinelevel:        row.pmo_outlinelevel ?? undefined,
    msdyn_displaysequence:     row.pmo_orderinbucket ?? undefined,
    // Custom-source task labels (freeform "name:#color;..."). Passthrough;
    // parsed by lib/taskLabelText in the UI. Undefined on the PSS source.
    pmo_tasklabel:             row.pmo_tasklabel ?? undefined,
    statecode:                 row.statecode ?? 0,
    createdon:                 row.createdon,

    _msdyn_project_value:       row._pmo_projectref_value ?? undefined,
    _msdyn_projectbucket_value: row._pmo_bucket_value ?? undefined,
    _msdyn_parenttask_value:    row._pmo_summarytask_value ?? undefined,
    _msdyn_projectsprint_value: row._pmo_sprint_value ?? undefined,
  };
}

/** Fetch all pmo_task rows for a project. Only active rows -- soft-deleted
 *  (statecode=1) rows are hidden by default, matching the msdyn read behavior
 *  (both sides exclude Inactive from the default list). */
export async function listCustomTasks(projectId: string): Promise<ProjectTask[]> {
  const rows = await dv.list<PmoTaskRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_projectref_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'pmo_orderinbucket asc',
  });
  return rows.map(normalizeCustomTask);
}

/**
 * Client-side summary-flag derivation. In msdyn_projecttask, `msdyn_summary`
 * is a boolean populated by PSS. We don't mirror that flag onto pmo_task
 * -- pmo instead expresses parenthood via `_pmo_summarytask_value` on the
 * children. So a task is a "summary task" iff at least one other task
 * has it as its pmo_summarytask.
 *
 * Given a list of ProjectTask rows (from either source), this returns
 * the same list with each row's msdyn_summary populated:
 *   - true  when some other row points at it via _msdyn_parenttask_value
 *   - false otherwise (leaf task)
 *
 * Idempotent: if msdyn_summary is already set (msdyn source), it stays.
 * Only derives when the field is undefined (custom source).
 */
export function annotateSummaryFlags(rows: ProjectTask[]): ProjectTask[] {
  const parentIds = new Set<string>();
  for (const r of rows) {
    const parent = r._msdyn_parenttask_value;
    if (parent) parentIds.add(parent);
  }
  return rows.map((r) => {
    if (r.msdyn_summary !== undefined) return r;
    return { ...r, msdyn_summary: parentIds.has(r.msdyn_projecttaskid) };
  });
}

/**
 * Multi-project variant of listCustomTasks. Matches the shape of
 * programTasks.api.listTasksForProjects so it's a drop-in for portfolio
 * rollups (ByTeamPage, AnalyticsHubPage, useAllProjectTasks,
 * useProgramTasks). Applies the same portfolio filter the msdyn side
 * uses: outline level > 0 AND non-summary (client-derived here since
 * the summary flag doesn't exist as a column on pmo_task).
 */
export async function listCustomTasksForProjects(projectIds: string[]): Promise<ProjectTask[]> {
  if (projectIds.length === 0) return [];
  const filter = projectIds
    .map((id) => `_pmo_projectref_value eq '${id}'`)
    .join(' or ');
  const rows = await dv.list<PmoTaskRow>(SET, {
    $select: BASE_SELECT,
    $filter: `(${filter}) and statecode eq 0`,
    $top: 5000,
  });
  const normalized = rows.map(normalizeCustomTask);
  const annotated = annotateSummaryFlags(normalized);
  // Portfolio filter: exclude summary rows + outlinelevel-0 rows (root
  // pseudo-tasks). Matches useAllProjectTasks' server-side filter.
  return annotated.filter(
    (r) => (r.msdyn_outlinelevel ?? 0) > 0 && !r.msdyn_summary,
  );
}

// ── Option-C Phase 4 write path (direct OData on pmo_task, no PSS) ─────────
//
// Inverse of normalizeCustomTask above. When pmo.task_source === 'custom'
// the task mutation hooks call these instead of the PSS/staging path. Plain
// CRUD: dv.create returns the real GUID synchronously (no optimistic-id
// window), dv.deactivate soft-deletes. msdyn_projecttask (P4W) goes stale
// until the reverse ETL lands -- accepted on DEV during Phase 4.
//
// `duration` is intentionally dropped: pmo_task has no duration column (the
// read normalizer leaves msdyn_duration undefined), and `progress` is a
// PSS-computed value we store directly as pmo_progress.

export interface CustomTaskCreateInput {
  projectId: string;
  subject: string;
  bucketId?: string;
  parentTaskId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  isMilestone?: boolean;
  priority?: number;
  description?: string;
}

/** Shape the pmo_task create payload. Pure -- unit tested. Lookups bound via
 *  @odata.bind navigation props (pmo_Project/pmo_Bucket/pmo_SummaryTask --
 *  PascalCase ReferencingEntityNavigationPropertyName, case-sensitive). */
export function buildCustomTaskCreatePayload(input: CustomTaskCreateInput): Record<string, unknown> {
  const p: Record<string, unknown> = {
    pmo_subject: input.subject,
    'pmo_ProjectRef@odata.bind': `/pmo_projects(${input.projectId})`,
    pmo_outlinelevel: 1,
  };
  if (input.bucketId) p['pmo_Bucket@odata.bind'] = `/pmo_buckets(${input.bucketId})`;
  if (input.parentTaskId) p['pmo_SummaryTask@odata.bind'] = `/pmo_tasks(${input.parentTaskId})`;
  // pmo_startdate/pmo_duedate are Edm.Date (DateOnly behavior) — they REQUIRE a
  // bare YYYY-MM-DD and REJECT any T..Z suffix. (This differs from the PSS
  // path's msdyn_scheduledstart, a DateTime column, which takes noon-UTC.) The
  // 8/4->8/3 display shift is fixed on the READ side via edmDateToNoonUtc in
  // normalizeCustomTask, not by mangling the stored value here.
  if (input.scheduledStart !== undefined) p.pmo_startdate = toEdmDate(input.scheduledStart);
  if (input.scheduledEnd !== undefined) p.pmo_duedate = toEdmDate(input.scheduledEnd);
  if (input.isMilestone !== undefined) p.pmo_ismilestone = input.isMilestone;
  if (input.priority !== undefined) p.pmo_priorityvalue = input.priority;
  if (input.description !== undefined) p.pmo_description = input.description;
  // Store duration exactly as PSS would (weekdays inclusive, in DAYS) so the
  // overnight pmo_ -> msdyn ETL stays 1:1. Only when both endpoints exist.
  const dur = computeDurationDays(input.scheduledStart, input.scheduledEnd);
  if (dur !== undefined) {
    p.pmo_duration = dur;
    // Seed effort the way PSS auto-computes it on create: duration(days) x 8h
    // (its 1-resource / 8h-day assumption). The user can override via Hours in
    // the detail panel afterward. Keeps new custom tasks showing an effort
    // value that matches what PROD/PSS would have populated.
    p.pmo_effort = dur * 8;
  }
  return p;
}

export interface CustomTaskUpdateInput {
  subject?: string;
  progress?: number;
  effortCompleted?: number;
  effort?: number;
  scheduledStart?: string;
  scheduledEnd?: string;
  isMilestone?: boolean;
  priority?: number;
  description?: string;
  bucketId?: string;
}

/** Shape a pmo_task PATCH payload from an update input. Pure -- unit tested.
 *  Only defined fields are written (partial PATCH). Returns undefined when
 *  nothing to write so callers can short-circuit an empty PATCH. */
export function buildCustomTaskUpdatePayload(input: CustomTaskUpdateInput): Record<string, unknown> | undefined {
  const p: Record<string, unknown> = {};
  if (input.subject !== undefined) p.pmo_subject = input.subject;
  if (input.description !== undefined) p.pmo_description = input.description;
  // pmo_progress is a 0-1 FRACTION (Decimal, range 0..1). Callers are
  // inconsistent about the incoming scale: the completion path sends 0-100
  // (percent, e.g. 100) while some callers already send 0-1 (e.g. 0.5). Mirror
  // getDisplayProgressPct's own rule — a value >1 is a percent, so divide by 100;
  // <=1 is already a fraction. Clamp to [0,1] so Dataverse never sees an
  // out-of-range value (writing raw 100 was rejected with a 400).
  if (input.progress !== undefined) {
    const raw = input.progress;
    const frac = raw > 1 ? raw / 100 : raw;
    p.pmo_progress = Math.max(0, Math.min(1, frac));
  }
  if (input.effort !== undefined) p.pmo_effort = input.effort;
  if (input.effortCompleted !== undefined) p.pmo_effortcompleted = input.effortCompleted;
  // Edm.Date columns need a bare YYYY-MM-DD (see create-payload note above).
  if (input.scheduledStart !== undefined) p.pmo_startdate = toEdmDate(input.scheduledStart);
  if (input.scheduledEnd !== undefined) p.pmo_duedate = toEdmDate(input.scheduledEnd);
  if (input.isMilestone !== undefined) p.pmo_ismilestone = input.isMilestone;
  if (input.priority !== undefined) p.pmo_priorityvalue = input.priority;
  if (input.bucketId !== undefined) p['pmo_Bucket@odata.bind'] = `/pmo_buckets(${input.bucketId})`;
  // Recompute duration whenever the window changes. Callers (TaskDetailPanel)
  // pin BOTH endpoints on any date edit, so both are present here when either
  // moved -- keeping pmo_duration coherent for the ETL, PSS-identical math.
  if (input.scheduledStart !== undefined && input.scheduledEnd !== undefined) {
    const dur = computeDurationDays(input.scheduledStart, input.scheduledEnd);
    if (dur !== undefined) p.pmo_duration = dur;
  }
  return Object.keys(p).length > 0 ? p : undefined;
}

/**
 * Create a task in pmo_task. Returns the new server GUID plus the friendly
 * auto-number (TASK-#####) so the caller can show it on the tile immediately.
 *
 * The autonumber is populated server-side on insert; the create response may
 * not echo it, so we do one cheap read-back of `pmo_tasknumber` by GUID. Best
 * effort — if the read fails the GUID still returns and the number surfaces on
 * the next list refetch.
 */
export async function createCustomTask(
  input: CustomTaskCreateInput,
): Promise<{ taskId: string; taskNumber?: string }> {
  const created = await dv.create<PmoTaskRow>(SET, buildCustomTaskCreatePayload(input));
  const taskId = created.pmo_taskid;
  void touchCustomProject(input.projectId);
  let taskNumber = created.pmo_tasknumber ?? undefined;
  if (!taskNumber) {
    try {
      const row = await dv.get<PmoTaskRow>(SET, taskId, ['pmo_tasknumber']);
      taskNumber = row.pmo_tasknumber ?? undefined;
    } catch {
      /* best effort — number will appear on the next list refetch */
    }
  }
  return { taskId, taskNumber };
}

/** Update a task in pmo_task. No-op when the payload is empty. */
export async function updateCustomTask(taskId: string, input: CustomTaskUpdateInput): Promise<void> {
  const payload = buildCustomTaskUpdatePayload(input);
  if (!payload) return;
  await dv.update(SET, taskId, payload);
  void touchProjectFromChild(SET, taskId, '_pmo_projectref_value');
}

/** Update only the CVS-owned effort columns (pmo_effort / pmo_effortcompleted).
 *  Mirrors useUpdateTaskCustomFields' pmo_taskeffort/pmo_taskhoursdone patch
 *  but targets the unified pmo_task columns. */
export async function updateCustomTaskEffort(
  taskId: string,
  patch: { effort?: number | null; effortCompleted?: number | null },
) : Promise<void> {
  const p: Record<string, unknown> = {};
  if (patch.effort !== undefined) p.pmo_effort = patch.effort;
  if (patch.effortCompleted !== undefined) p.pmo_effortcompleted = patch.effortCompleted;
  if (Object.keys(p).length === 0) return;
  await dv.update(SET, taskId, p);
  void touchProjectFromChild(SET, taskId, '_pmo_projectref_value');
}

/**
 * Set (or clear) the sprint a task belongs to on the custom source.
 *
 * The PSS path routes msdyn_projectsprint through PssUpdateV1; on the custom
 * source the task lives in pmo_task (PSS would AV-0006), so we PATCH the
 * pmo_Sprint lookup directly. Bind via the PascalCase nav prop when a sprint
 * is chosen; set the bind to null to disassociate (Web API single-valued
 * navigation-property unbind on PATCH). The read normalizer already maps
 * _pmo_sprint_value -> _msdyn_projectsprint_value so the board is unaffected.
 */
export function buildSprintUpdatePayload(sprintId: string | null): Record<string, unknown> {
  return { 'pmo_Sprint@odata.bind': sprintId ? `/msdyn_projectsprints(${sprintId})` : null };
}

export async function updateCustomTaskSprint(taskId: string, sprintId: string | null): Promise<void> {
  await dv.update(SET, taskId, buildSprintUpdatePayload(sprintId));
  void touchProjectFromChild(SET, taskId, '_pmo_projectref_value');
}

/**
 * Write the freeform task-label text (pmo_tasklabel) — "name:#color;name:#color".
 * Direct OData PATCH on pmo_task (customizable table, no PSS gate). The caller
 * composes the text via lib/taskLabelText (add/remove/rename). Pass '' to clear.
 */
export async function updateCustomTaskLabels(taskId: string, labelText: string): Promise<void> {
  await dv.update(SET, taskId, { pmo_tasklabel: labelText ?? '' });
  void touchProjectFromChild(SET, taskId, '_pmo_projectref_value');
}

/** Soft-delete a task (statecode=1), matching the mirror plugin convention. */
export async function deleteCustomTask(taskId: string): Promise<void> {
  void touchProjectFromChild(SET, taskId, '_pmo_projectref_value');
  await dv.deactivate(SET, taskId);
}
