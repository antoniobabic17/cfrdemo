/**
 * Project Operations Scheduling Service client.
 *
 * All msdyn_projecttask writes must go through these scheduling actions —
 * direct OData PATCH on msdyn_projecttask is blocked by the scheduling service.
 * The OperationSet pattern batches changes atomically:
 *   CreateOperationSetV1 → PssCreateV1 / PssUpdateV1 / PssDeleteV1 → ExecuteOperationSetV1
 *
 * The `executeAction` helper in dataverseClient.ts routes these through the
 * same SDK bridge used for standard CRUD, so auth and org URL are resolved
 * by the Power Apps host without any additional configuration.
 */
import { executeAction, list, deactivate, get } from './dataverseClient';
import { withTimeout } from './withTimeout';
import { toDataverseDateOnly } from './dateOnly';
import { ENTITY_SETS } from './constants';
import type { ProjectTask } from '../models/projectTask.model';
import type { TemplateTask } from './projectTemplates';

// Entity set used to resolve the Dataverse environment for all scheduling calls.
const SCHED_TABLE = 'msdyn_projects';

/** PSS-specific timeout budget. 45s (vs the generic 60s default in
 *  withTimeout) because PSS server-side hangs are more common and we
 *  want to surface them faster. See Anna/Shelina report 2026-07-16. */
const PSS_ACTION_TIMEOUT_MS = 45_000;

// ── OperationSet results ──────────────────────────────────────────────────────

export interface CreateOperationSetResult {
  OperationSetId: string;
}

export interface PssOperationResult {
  OperationSetId: string;
}

export interface ExecuteOperationSetResult {
  OperationSetId: string;
}

// ── Task create / update payload ──────────────────────────────────────────────

export interface ScheduleTaskCreate {
  projectId: string;
  bucketId?: string;
  parentTaskId?: string;
  subject: string;
  scheduledStart?: string; // ISO date string
  scheduledEnd?: string;   // ISO date string
  duration?: number;       // hours
  isMilestone?: boolean;
  // Staging mode only: the plugin's follow-up PssUpdateV1 applies these
  // inside the SAME drain OperationSet as PssCreateV1, so passing them
  // here lets a task be created + dated + prioritised atomically without
  // a second mutation. Ignored on the legacy direct-PSS path.
  priority?: number;
  description?: string;
}

export interface ScheduleTaskUpdate {
  taskId: string;
  subject?: string;
  progress?: number;        // 0–100 (optimistic cache only — PSS rejects msdyn_progress as computed)
  effortCompleted?: number; // hours — drives msdyn_progress via PSS (S3 PASS: intermediate values confirmed)
  effort?: number;          // total effort hours (S4 PASS: writable on task entity via PssUpdateV1)
  scheduledStart?: string;
  scheduledEnd?: string;
  duration?: number;
  isMilestone?: boolean;
  priority?: number;        // 0=Low,1=Med,2=High,3=Critical (S2 PASS)
  description?: string;     // notes (S1 PASS)
  bucketId?: string;        // target bucket GUID — sets msdyn_projectbucket@odata.bind
}

// ── Low-level OperationSet API wrappers ───────────────────────────────────────

// Diagnostic instrumentation — track every OperationSet open/execute so leaks are visible.
// PSS limits each user to 10 unexecuted OperationSets at a time; an opSet that errors
// between Create and Execute leaks until it expires (~5 min).
const _opSetTracker = { opened: 0, executed: 0, leaked: new Set<string>() };
function _logOpSet(action: 'open' | 'execute', id: string, description?: string) {
  if (action === 'open') {
    _opSetTracker.opened += 1;
    _opSetTracker.leaked.add(id);
    // eslint-disable-next-line no-console
    console.log(`[OpSet] OPEN  #${_opSetTracker.opened.toString().padStart(3, '0')} id=${id} :: ${description ?? ''} (in-flight: ${_opSetTracker.leaked.size})`);
  } else {
    _opSetTracker.executed += 1;
    _opSetTracker.leaked.delete(id);
    // eslint-disable-next-line no-console
    console.log(`[OpSet] EXEC  #${_opSetTracker.executed.toString().padStart(3, '0')} id=${id} (in-flight: ${_opSetTracker.leaked.size})`);
  }
}
// Expose on window for easy DevTools inspection.
if (typeof window !== 'undefined') {
  (window as unknown as { __opSetDebug: typeof _opSetTracker }).__opSetDebug = _opSetTracker;
}

/** Public accessor for the in-flight OperationSet count. Feeds the
 *  Admin > Error Log diagnostic tile so operators can spot the
 *  10-opSet-per-user PSS ceiling before users hit it. */
export function getOpSetDebug(): { opened: number; executed: number; leaked: number } {
  return {
    opened: _opSetTracker.opened,
    executed: _opSetTracker.executed,
    leaked: _opSetTracker.leaked.size,
  };
}

export async function createOperationSet(
  projectId: string,
  description: string,
): Promise<string> {
  const result = await executeAction<
    { ProjectId: string; Description: string },
    CreateOperationSetResult
  >(SCHED_TABLE, 'msdyn_CreateOperationSetV1', { ProjectId: projectId, Description: description });
  _logOpSet('open', result.OperationSetId, description);
  return result.OperationSetId;
}

export async function pssCreateTask(
  params: ScheduleTaskCreate,
  operationSetId: string,
): Promise<PssOperationResult> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_subject: params.subject,
    'msdyn_project@odata.bind': `/msdyn_projects(${params.projectId})`,
  };
  if (params.bucketId) {
    entity['msdyn_projectbucket@odata.bind'] = `/msdyn_projectbuckets(${params.bucketId})`;
  }
  if (params.parentTaskId) {
    entity['msdyn_parenttask@odata.bind'] = `/msdyn_projecttasks(${params.parentTaskId})`;
  }
  // msdyn_scheduledstart / msdyn_scheduledend are NOT allowed on create — PSS returns
  // E_NOTEDITABLE ("Field is readonly"). They are writable on update via pssUpdateTask.
  if (params.duration !== undefined) entity.msdyn_duration = params.duration;
  // msdyn_ismilestone is NOT allowed on create (ScheduleAPI-AV-0001). Set via update after creation.

  return executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
    SCHED_TABLE,
    'msdyn_PssCreateV1',
    { Entity: entity, OperationSetId: operationSetId },
  );
}

export async function pssUpdateTask(
  params: ScheduleTaskUpdate,
  operationSetId: string,
): Promise<PssOperationResult> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_projecttaskid: params.taskId,
  };
  if (params.subject !== undefined) entity.msdyn_subject = params.subject;
  // msdyn_progress is NOT sent via PSS — the scheduling engine's percentComplete validator
  // rejects it regardless of scale. Use updateTaskProgress() for progress updates instead.
  // effortCompleted: still used internally by the scheduling engine.
  if (params.effortCompleted !== undefined) entity.msdyn_effortcompleted = params.effortCompleted;
  if (params.effort !== undefined) entity.msdyn_effort = params.effort;           // S4 PASS
  if (params.scheduledStart !== undefined) entity.msdyn_scheduledstart = toDataverseDateOnly(params.scheduledStart);
  if (params.scheduledEnd !== undefined) entity.msdyn_scheduledend = toDataverseDateOnly(params.scheduledEnd);
  if (params.duration !== undefined) entity.msdyn_duration = params.duration;
  // msdyn_ismilestone is NOT allowed on update (ScheduleAPI-AV-0002) — omitted.
  if (params.priority !== undefined) entity.msdyn_priority = params.priority;     // S2 PASS
  if (params.description !== undefined) entity.msdyn_description = params.description; // S1 PASS
  if (params.bucketId !== undefined) {
    entity['msdyn_projectbucket@odata.bind'] = `/msdyn_projectbuckets(${params.bucketId})`;
  }

  return executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
    SCHED_TABLE,
    'msdyn_PssUpdateV1',
    { Entity: entity, OperationSetId: operationSetId },
  );
}

export async function pssDeleteTask(
  taskId: string,
  operationSetId: string,
): Promise<PssOperationResult> {
  return executeAction<
    { RecordId: string; EntityLogicalName: string; OperationSetId: string },
    PssOperationResult
  >(SCHED_TABLE, 'msdyn_PssDeleteV1', {
    RecordId: taskId,
    EntityLogicalName: 'msdyn_projecttask',
    OperationSetId: operationSetId,
  });
}

export async function executeOperationSet(
  operationSetId: string,
): Promise<ExecuteOperationSetResult> {
  try {
    const result = await executeAction<{ OperationSetId: string }, ExecuteOperationSetResult>(
      SCHED_TABLE,
      'msdyn_ExecuteOperationSetV1',
      { OperationSetId: operationSetId },
    );
    _logOpSet('execute', operationSetId);
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[OpSet] EXEC FAILED id=${operationSetId} (still in-flight: ${_opSetTracker.leaked.size})`, err);
    throw err;
  }
}

/**
 * Run a body that adds operations to an OperationSet, then ALWAYS execute the opSet
 * — even on partial failure. PSS limits each user to 10 unexecuted opSets at a time;
 * any opSet that errors between Create and Execute leaks until it expires (~5 min).
 * Wrapping the body in try/finally and calling Execute in finally{} releases the slot
 * immediately. PSS treats Execute on a partially-populated or empty opSet as a no-op.
 *
 * If both the body AND the cleanup execute throw, the body's error wins (more useful
 * to the caller — they want to know why their write failed, not why the cleanup did).
 */
export async function withOperationSet<T>(
  projectId: string,
  description: string,
  body: (opSetId: string) => Promise<T>,
): Promise<T> {
  // Wrap each phase in withTimeout so a hung PSS response (server not
  // responding, user over 10-opSet quota, or session stuck in
  // materialization) rejects cleanly instead of spinning the caller's
  // promise forever. The SubmitStep runner in submitProgressStore
  // treats the rejection as a step failure, surfaces the toast, and
  // moves on rather than hanging the "Saving X changes" bar.
  const opSetId = await withTimeout(
    createOperationSet(projectId, description),
    `createOperationSet(${description})`,
    PSS_ACTION_TIMEOUT_MS,
  );
  let result: T;
  try {
    result = await withTimeout(body(opSetId), `opSetBody(${description})`, PSS_ACTION_TIMEOUT_MS);
  } catch (bodyErr) {
    // Body failed — run cleanup but don't let its error mask bodyErr.
    try {
      await withTimeout(executeOperationSet(opSetId), `executeOperationSet(cleanup ${opSetId})`, PSS_ACTION_TIMEOUT_MS);
    } catch (cleanupErr) {
      // eslint-disable-next-line no-console
      console.warn(`[OpSet] cleanup execute failed for ${opSetId}; body error already thrown:`, cleanupErr);
    }
    throw bodyErr;
  }
  // Body succeeded — cleanup error must propagate to the caller.
  await withTimeout(executeOperationSet(opSetId), `executeOperationSet(${opSetId})`, PSS_ACTION_TIMEOUT_MS);
  return result;
}

// ── Bucket PSS wrappers ───────────────────────────────────────────────────────

export interface ScheduleBucketCreate {
  projectId: string;
  name: string;
  displayOrder?: number;
}

export interface ScheduleBucketUpdate {
  bucketId: string;
  name: string;
}

export async function pssCreateBucket(
  params: ScheduleBucketCreate,
  operationSetId: string,
): Promise<PssOperationResult> {
  // msdyn_displayorder is not allowed on bucket create via PSS — the scheduling service assigns it.
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket',
    msdyn_name: params.name,
    'msdyn_project@odata.bind': `/msdyn_projects(${params.projectId})`,
  };
  return executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
    SCHED_TABLE,
    'msdyn_PssCreateV1',
    { Entity: entity, OperationSetId: operationSetId },
  );
}

export async function pssUpdateBucket(
  params: ScheduleBucketUpdate,
  operationSetId: string,
): Promise<PssOperationResult> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectbucket',
    msdyn_projectbucketid: params.bucketId,
    msdyn_name: params.name,
  };
  return executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
    SCHED_TABLE,
    'msdyn_PssUpdateV1',
    { Entity: entity, OperationSetId: operationSetId },
  );
}

export async function pssDeleteBucket(
  bucketId: string,
  operationSetId: string,
): Promise<PssOperationResult> {
  return executeAction<
    { RecordId: string; EntityLogicalName: string; OperationSetId: string },
    PssOperationResult
  >(SCHED_TABLE, 'msdyn_PssDeleteV1', {
    RecordId: bucketId,
    EntityLogicalName: 'msdyn_projectbucket',
    OperationSetId: operationSetId,
  });
}

// ── High-level bucket lifecycle ───────────────────────────────────────────────

export async function createScheduledBucket(params: ScheduleBucketCreate): Promise<void> {
  await withOperationSet(params.projectId, `Create bucket: ${params.name}`, (opSetId) =>
    pssCreateBucket(params, opSetId),
  );
}

export async function updateScheduledBucket(projectId: string, params: ScheduleBucketUpdate): Promise<void> {
  await withOperationSet(projectId, `Rename bucket: ${params.bucketId}`, (opSetId) =>
    pssUpdateBucket(params, opSetId),
  );
}

export async function deleteScheduledBucket(projectId: string, bucketId: string): Promise<void> {
  await withOperationSet(projectId, `Delete bucket: ${bucketId}`, (opSetId) =>
    pssDeleteBucket(bucketId, opSetId),
  );
}

// ── High-level task lifecycle ─────────────────────────────────────────────────

/** Create a single task via OperationSet (single-op batch). */
export async function createProjectTask(params: ScheduleTaskCreate): Promise<void> {
  await withOperationSet(params.projectId, `Create task: ${params.subject}`, (opSetId) =>
    pssCreateTask(params, opSetId),
  );
}

/** Update a single task via OperationSet (single-op batch). */
export async function updateProjectTask(params: ScheduleTaskUpdate, projectId: string): Promise<void> {
  await withOperationSet(projectId, `Update task: ${params.taskId}`, (opSetId) =>
    pssUpdateTask(params, opSetId),
  );
}

/** Delete a single task via OperationSet (single-op batch).
 *
 * Stage 7 fix: PSS PssDeleteV1 compares the task's _msdyn_project_value
 * against the OperationSet's ProjectId and errors with
 *   "The referenced project with id 00000000-... does not match the
 *    project id <opset> of the operation set"
 * when they differ. Root cause we've seen: the task's project lookup is
 * stale/null in the local cache, but in Dataverse it's populated. We
 * re-fetch the canonical lookup from Dataverse right before delete and
 * use it as the OperationSet's ProjectId so they always agree.
 */
export async function deleteProjectTask(taskId: string, projectId: string): Promise<void> {
  // Re-fetch the task's actual project lookup from Dataverse.
  let resolvedProjectId = projectId;
  try {
    const task = await get<{ _msdyn_project_value?: string }>(
      'msdyn_projecttasks',
      taskId,
      ['_msdyn_project_value'],
    );
    if (task?._msdyn_project_value) resolvedProjectId = task._msdyn_project_value;
  } catch {
    // If the lookup fails (e.g. task already gone), fall through and let the
    // OperationSet create with the route projectId; PSS will surface the real
    // error if the task truly doesn't exist.
  }
  await withOperationSet(resolvedProjectId, `Delete task: ${taskId}`, (opSetId) =>
    pssDeleteTask(taskId, opSetId),
  );
}

// ── Project schedule update (dates via PSS) ─────────────────────────────────

// Per MS docs, msdyn_project Update via PSS does NOT support: Finish, Duration,
// Effort, EffortCompleted, EffortRemaining, Progress, StateCode, TaskEarliestStart.
// msdyn_scheduledstart IS supported.
export interface ScheduleProjectUpdate {
  projectId: string;
  scheduledStart?: string;
}

export async function updateProjectSchedule(params: ScheduleProjectUpdate): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_project',
    msdyn_projectid: params.projectId,
  };
  if (params.scheduledStart !== undefined) entity.msdyn_scheduledstart = toDataverseDateOnly(params.scheduledStart);

  await withOperationSet(params.projectId, 'Update project start date', (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE,
      'msdyn_PssUpdateV1',
      { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

// ── Task dependency lifecycle ─────────────────────────────────────────────────

/** Dependency link type codes. 0=FS, 1=FF, 2=SS, 3=SF (as stored in msdyn_linktype). */
export const LINK_TYPE = { FS: 0, FF: 1, SS: 2, SF: 3 } as const;

/** Create a task dependency between two tasks via OperationSet.
 *  linkType defaults to 0 (Finish-to-Start). */
export async function createProjectTaskDependency(
  projectId: string,
  successorTaskId: string,
  predecessorTaskId: string,
  linkType: number = LINK_TYPE.FS,
): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttaskdependency',
    'msdyn_project@odata.bind': `/msdyn_projects(${projectId})`,
    'msdyn_successortask@odata.bind': `/msdyn_projecttasks(${successorTaskId})`,
    'msdyn_predecessortask@odata.bind': `/msdyn_projecttasks(${predecessorTaskId})`,
    msdyn_linktype: linkType,
  };
  await withOperationSet(projectId, `Create dependency: ${predecessorTaskId} → ${successorTaskId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE,
      'msdyn_PssCreateV1',
      { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

/** Delete a task dependency via OperationSet. */
export async function deleteProjectTaskDependency(
  projectId: string,
  dependencyId: string,
): Promise<void> {
  await withOperationSet(projectId, `Delete dependency: ${dependencyId}`, (opSetId) =>
    executeAction<{ RecordId: string; EntityLogicalName: string; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE,
      'msdyn_PssDeleteV1',
      { RecordId: dependencyId, EntityLogicalName: 'msdyn_projecttaskdependency', OperationSetId: opSetId },
    ),
  );
}

// ── Resource assignment (msdyn_projectteam) ───────────────────────────────────

// msdyn_projectteam is NOT supported by PssCreateV1 or PssDeleteV1.
// msdyn_CreateTeamMemberV1 is a standalone scheduling action (no OperationSet needed).
// Delete uses direct OData — no scheduling API for team member removal.
export async function createProjectTeamMember(
  projectId: string,
  bookableResourceId: string,
): Promise<void> {
  await executeAction<{ TeamMember: object }, { TeamMemberId: string }>(
    SCHED_TABLE,
    'msdyn_CreateTeamMemberV1',
    {
      TeamMember: {
        '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectteam',
        'msdyn_project@odata.bind': `/msdyn_projects(${projectId})`,
        'msdyn_bookableresourceid@odata.bind': `/bookableresources(${bookableResourceId})`,
        msdyn_allocationmethod: 192350000, // None — adds member without booking hours
      },
    },
  );
}

export async function deleteProjectTeamMember(
  _projectId: string,
  teamMemberId: string,
): Promise<void> {
  // Hard DELETE is blocked on msdyn_projectteam — deactivate (statecode=1) instead.
  await deactivate('msdyn_projectteams', teamMemberId);
}

// ── Resource assignment lifecycle ─────────────────────────────────────────────

export async function createResourceAssignment(
  projectId: string,
  taskId: string,
  teamMemberId: string,
  name: string,
): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_resourceassignment',
    'msdyn_taskid@odata.bind': `/msdyn_projecttasks(${taskId})`,
    'msdyn_projectteamid@odata.bind': `/msdyn_projectteams(${teamMemberId})`,
    'msdyn_projectid@odata.bind': `/msdyn_projects(${projectId})`,
    msdyn_name: name,
  };
  await withOperationSet(projectId, `Assign resource: ${teamMemberId} → ${taskId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE,
      'msdyn_PssCreateV1',
      { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

export async function deleteResourceAssignment(
  projectId: string,
  assignmentId: string,
): Promise<void> {
  await withOperationSet(projectId, `Remove assignment: ${assignmentId}`, (opSetId) =>
    executeAction<{ RecordId: string; EntityLogicalName: string; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE,
      'msdyn_PssDeleteV1',
      { RecordId: assignmentId, EntityLogicalName: 'msdyn_resourceassignment', OperationSetId: opSetId },
    ),
  );
}

// ── Task progress update (separate from pssUpdateTask) ───────────────────────
// PSS's percentComplete validator rejects msdyn_progress regardless of scale.
// Planner sets % complete via a direct Dataverse path, not PSS.
// Strategy: try direct OData PATCH first; fall back to effortCompleted via PSS.

export async function updateTaskProgress(params: {
  taskId: string;
  projectId: string;
  pct: number;    // 0–100 integer
  effort?: number; // msdyn_effort in hours (from task record)
}): Promise<void> {
  // Direct OData PATCH is silently rolled back by the scheduling service (returns 200 but
  // discards the change). PSS via msdyn_effortcompleted is the only supported write path.
  // Spike S3 confirmed: intermediate effortCompleted values persist in P4W.
  //
  // Guard: if the task has no effort set (null or 0), provide a default of 8h so that
  // effortCompleted is non-zero and progress > 0%. Also set msdyn_effort in that case
  // so the engine has a denominator for computing msdyn_progress.
  const effort = (params.effort && params.effort > 0) ? params.effort : 8;
  const effortCompleted = params.pct >= 100
    ? effort
    : Math.round((params.pct / 100) * effort * 10) / 10;

  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_projecttaskid: params.taskId,
    msdyn_effortcompleted: effortCompleted,
  };
  // If the task had no effort set, provide the default so effortCompleted is meaningful.
  if (!params.effort || params.effort === 0) {
    entity.msdyn_effort = effort;
  }
  await withOperationSet(params.projectId, `Progress ${params.pct}%: ${params.taskId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssUpdateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

// ── Label assignment lifecycle ────────────────────────────────────────────────
// msdyn_projecttasktolabel — junction between task and label.
// Nav property names are discovered at runtime via RelationshipDefinitions
// (same approach as S6c for checklists). Cached after first call.

let _labelNavProps: { task: string; label: string } | null = null;

async function discoverLabelNavProps(): Promise<{ task: string; label: string }> {
  if (_labelNavProps) return _labelNavProps;
  const { list: dvList } = await import('./dataverseClient');

  // Same fallback strategy as S6c — try multiple param combinations
  let allRels: Record<string, unknown>[] = [];
  for (const params of [
    { $select: ['SchemaName', 'ReferencingEntity', 'ReferencedEntity', 'ReferencingEntityNavigationPropertyName'], $top: 500 },
    { $top: 200 },
    {},
  ]) {
    try {
      allRels = await dvList<Record<string, unknown>>('RelationshipDefinitions' as never, params as never);
      if (allRels.length > 0) break;
    } catch { /* try next param set */ }
  }

  const rels = allRels.filter((r) =>
    String(r.ReferencingEntity ?? '').includes('projecttasktolabel') ||
    String(r.ReferencedEntity ?? '').includes('projecttasktolabel'),
  );
  const taskRel = rels.find((r) =>
    String(r.ReferencingEntity ?? '') === 'msdyn_projecttasktolabel' &&
    String(r.ReferencedEntity ?? '') === 'msdyn_projecttask',
  );
  const labelRel = rels.find((r) =>
    String(r.ReferencingEntity ?? '') === 'msdyn_projecttasktolabel' &&
    String(r.ReferencedEntity ?? '') === 'msdyn_projectlabel',
  );
  _labelNavProps = {
    task: String(taskRel?.ReferencingEntityNavigationPropertyName ?? 'msdyn_ProjectTaskId'),
    label: String(labelRel?.ReferencingEntityNavigationPropertyName ?? 'msdyn_ProjectLabelId'),
  };
  return _labelNavProps;
}

export async function assignLabelToTask(
  projectId: string,
  taskId: string,
  labelId: string,
): Promise<void> {
  const nav = await discoverLabelNavProps();
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttasktolabel',
    [`${nav.task}@odata.bind`]: `/msdyn_projecttasks(${taskId})`,
    [`${nav.label}@odata.bind`]: `/msdyn_projectlabels(${labelId})`,
  };
  await withOperationSet(projectId, `Label assign: ${labelId} → ${taskId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssCreateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

export async function renameLabel(
  projectId: string,
  labelId: string,
  newName: string,
): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectlabel',
    msdyn_projectlabelid: labelId,
    msdyn_projectlabeltext: newName,
  };
  await withOperationSet(projectId, `Rename label: ${labelId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssUpdateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

export async function removeLabelFromTask(
  projectId: string,
  taskToLabelId: string,
): Promise<void> {
  await withOperationSet(projectId, `Label remove: ${taskToLabelId}`, (opSetId) =>
    executeAction<{ RecordId: string; EntityLogicalName: string; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssDeleteV1',
      { RecordId: taskToLabelId, EntityLogicalName: 'msdyn_projecttasktolabel', OperationSetId: opSetId },
    ),
  );
}

// ── Sprint assignment on task ────────────────────────────────────────────────
// Uses PssUpdateV1 on msdyn_projecttask with msdyn_projectsprint@odata.bind.
// Sprint binding follows the same lowercase pattern as msdyn_project, msdyn_projectbucket,
// msdyn_parenttask (all bindings ON the task entity use lowercase).

export async function setTaskSprint(
  taskId: string,
  projectId: string,
  sprintId: string | null,
): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
    msdyn_projecttaskid: taskId,
  };
  if (sprintId) {
    entity['msdyn_projectsprint@odata.bind'] = `/msdyn_projectsprints(${sprintId})`;
  }
  await withOperationSet(projectId, `Sprint assign: ${taskId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssUpdateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

// ── Checklist item lifecycle ──────────────────────────────────────────────────
// msdyn_projectchecklist — task-scoped checklist items (S6 PASS)
// FK: msdyn_projecttaskid@odata.bind → /msdyn_projecttasks({taskId})

export interface ScheduleChecklistCreate {
  projectId: string;
  taskId: string;
  name: string;
  order?: number;
  /** Optional initial completion state. Defaults to false. */
  completed?: boolean;
  /** Optional due date (DateOnly, YYYY-MM-DD). Custom source only. */
  dueDate?: string | null;
}

export interface ScheduleChecklistUpdate {
  projectId: string;
  checklistId: string;
  name?: string;
  completed?: boolean;
  /** Custom source only. */
  dueDate?: string | null;
  order?: number;
}

export async function createChecklistItem(params: ScheduleChecklistCreate): Promise<void> {
  // Neither 'msdyn_projecttaskid@odata.bind' nor 'msdyn_projecttask@odata.bind' is a valid
  // OData navigation property name on msdyn_projectchecklist (both return "undeclared property").
  // PSS with raw GUID field instead of @odata.bind — PSS serializes its own payload so it
  // may not require the OData navigation property name format.
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectchecklist',
    msdyn_name: params.name,
    'msdyn_ProjectTaskId@odata.bind': `/msdyn_projecttasks(${params.taskId})`, // confirmed: ReferencingEntityNavigationPropertyName from S6c spike 2026-04-18
    msdyn_projectchecklistcompleted: params.completed ?? false,
  };
  if (params.order !== undefined) entity.msdyn_projectchecklistorder = params.order;
  await withOperationSet(params.projectId, `Create checklist: ${params.name}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssCreateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

export async function updateChecklistItem(params: ScheduleChecklistUpdate): Promise<void> {
  const entity: Record<string, unknown> = {
    '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projectchecklist',
    msdyn_projectchecklistid: params.checklistId,
  };
  if (params.name !== undefined) entity.msdyn_name = params.name;
  if (params.completed !== undefined) entity.msdyn_projectchecklistcompleted = params.completed;
  await withOperationSet(params.projectId, `Update checklist: ${params.checklistId}`, (opSetId) =>
    executeAction<{ Entity: object; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssUpdateV1', { Entity: entity, OperationSetId: opSetId },
    ),
  );
}

export async function deleteChecklistItem(projectId: string, checklistId: string): Promise<void> {
  await withOperationSet(projectId, `Delete checklist: ${checklistId}`, (opSetId) =>
    executeAction<{ RecordId: string; EntityLogicalName: string; OperationSetId: string }, PssOperationResult>(
      SCHED_TABLE, 'msdyn_PssDeleteV1',
      { RecordId: checklistId, EntityLogicalName: 'msdyn_projectchecklist', OperationSetId: opSetId },
    ),
  );
}

// ── Project template apply ────────────────────────────────────────────────────

/**
 * Apply a WBS template to a project in a single OperationSet batch.
 * All tasks are created as flat leaf tasks (unassigned bucket) in one shot.
 * Callers should wait SCHEDULING_PERSIST_DELAY_MS before invalidating the task query.
 */
export async function applyProjectTemplate(
  projectId: string,
  templateTasks: TemplateTask[],
): Promise<void> {
  if (templateTasks.length === 0) return;
  await withOperationSet(projectId, 'Apply WBS template', async (opSetId) => {
    for (const t of templateTasks) {
      await pssCreateTask(
        {
          projectId,
          subject: t.subject,
          isMilestone: t.isMilestone,
          duration: t.duration,
        },
        opSetId,
      );
    }
  });
}

// ── Phase 0 Spike validation helper ──────────────────────────────────────────

export interface SpikeStepResult {
  name: string;
  durationMs: number;
  result?: unknown;
  error?: string;
}

export interface SpikeValidationResult {
  success: boolean;
  steps: SpikeStepResult[];
  totalMs: number;
  persistenceLatencyMs?: number;
  createdTaskId?: string;
}

/**
 * Runs the Phase 0 validation sequence:
 * CreateOperationSet → PssCreateV1 → ExecuteOperationSet → poll until task appears.
 * Reports timing for each step to calibrate optimistic UI refresh delay in Phase 1.
 */
export async function runPhase0Spike(
  projectId: string,
  bucketId: string | undefined,
): Promise<SpikeValidationResult> {
  const steps: SpikeStepResult[] = [];
  const totalStart = performance.now();
  const taskName = `PMO-Spike-${Date.now()}`;
  let operationSetId: string | undefined;

  // Step 1: CreateOperationSet
  try {
    const t0 = performance.now();
    const opResult = await executeAction<
      { ProjectId: string; Description: string },
      CreateOperationSetResult
    >(SCHED_TABLE, 'msdyn_CreateOperationSetV1', {
      ProjectId: projectId,
      Description: 'Phase 0 validation spike',
    });
    operationSetId = opResult.OperationSetId;
    steps.push({ name: 'CreateOperationSetV1', durationMs: Math.round(performance.now() - t0), result: opResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    steps.push({ name: 'CreateOperationSetV1', durationMs: 0, error: msg });
    return { success: false, steps, totalMs: Math.round(performance.now() - totalStart) };
  }

  // Step 2: PssCreateV1
  try {
    const entity: Record<string, unknown> = {
      '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
      msdyn_subject: taskName,
      'msdyn_project@odata.bind': `/msdyn_projects(${projectId})`,
    };
    if (bucketId) {
      entity['msdyn_projectbucket@odata.bind'] = `/msdyn_projectbuckets(${bucketId})`;
    }
    const t0 = performance.now();
    const pssResult = await executeAction<
      { Entity: object; OperationSetId: string },
      PssOperationResult
    >(SCHED_TABLE, 'msdyn_PssCreateV1', { Entity: entity, OperationSetId: operationSetId! });
    steps.push({ name: 'PssCreateV1', durationMs: Math.round(performance.now() - t0), result: pssResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    steps.push({ name: 'PssCreateV1', durationMs: 0, error: msg });
    return { success: false, steps, totalMs: Math.round(performance.now() - totalStart) };
  }

  // Step 3: ExecuteOperationSet
  const executeStart = performance.now();
  try {
    const t0 = performance.now();
    const execResult = await executeAction<
      { OperationSetId: string },
      ExecuteOperationSetResult
    >(SCHED_TABLE, 'msdyn_ExecuteOperationSetV1', { OperationSetId: operationSetId! });
    steps.push({ name: 'ExecuteOperationSetV1', durationMs: Math.round(performance.now() - t0), result: execResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    steps.push({ name: 'ExecuteOperationSetV1', durationMs: 0, error: msg });
    return { success: false, steps, totalMs: Math.round(performance.now() - totalStart) };
  }

  // Step 4: Poll until task appears (max 30s, 1s interval)
  let createdTaskId: string | undefined;
  let persistenceLatencyMs: number | undefined;
  const pollStart = performance.now();
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const tasks = await list<ProjectTask>(ENTITY_SETS.projectTask, {
        $select: ['msdyn_projecttaskid', 'msdyn_subject'],
        $filter: `_msdyn_project_value eq '${projectId}' and msdyn_subject eq '${taskName}' and statecode eq 0`,
      });
      if (tasks.length > 0) {
        createdTaskId = tasks[0].msdyn_projecttaskid;
        persistenceLatencyMs = Math.round(performance.now() - pollStart);
        break;
      }
    } catch {
      // Poll failure is non-fatal — keep trying
    }
  }

  steps.push({
    name: 'Poll for persisted task',
    durationMs: Math.round(performance.now() - executeStart),
    result: createdTaskId ? `Found: ${createdTaskId}` : 'Not found within 30s',
  });

  return {
    success: !!createdTaskId,
    steps,
    totalMs: Math.round(performance.now() - totalStart),
    persistenceLatencyMs,
    createdTaskId,
  };
}
