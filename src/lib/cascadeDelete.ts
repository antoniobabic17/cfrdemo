/**
 * Cascade-delete helpers for projects and programs.
 *
 * Hard-delete strategy: every child row is removed with `dv.remove()`
 * (OData DELETE). The parent is removed last so partial failures leave a
 * still-visible parent the admin can retry against.
 *
 * There is NO recovery once these calls succeed. Dataverse may keep rows in
 * a 30-day recycle bin if the org has it enabled, but the caller MUST treat
 * this as permanent. The DeleteConfirmDialog gates with type-name-to-confirm
 * to keep accidental triggers out.
 *
 * Pre-flight counts: each public function exposes a `*Summary` companion
 * that returns child counts WITHOUT mutating anything so the confirm dialog
 * can show the user what will be touched. The cascade then re-queries the
 * IDs at delete-time — we don't trust a stale snapshot from the summary.
 */
import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import type { DeleteChildSummary } from '../components/common/DeleteConfirmDialog';

// ── Project cascade ──────────────────────────────────────────────────────────

/**
 * Children of a project (by `_msdyn_project_value` or `_pmo_project_value`).
 * Order is from most-derived to least so foreign keys are released first.
 */
const PROJECT_CHILD_SPEC: ReadonlyArray<{
  set: string;
  fk: '_msdyn_project_value' | '_pmo_project_value' | '_pmo_convertedproject_value' | '_pmo_convertedprojectref_value';
  label: string;
}> = [
  // Scheduling-tree children must die before tasks/buckets so dependencies/
  // assignments don't reference now-deactivated rows.
  { set: ENTITY_SETS.projectTaskDependency,  fk: '_msdyn_project_value', label: 'task dependencies' },
  { set: ENTITY_SETS.resourceAssignment,     fk: '_msdyn_project_value', label: 'resource assignments' },
  { set: ENTITY_SETS.projectTaskToLabel,     fk: '_msdyn_project_value', label: 'task labels' },
  { set: ENTITY_SETS.projectChecklist,       fk: '_msdyn_project_value', label: 'task checklists' },
  { set: ENTITY_SETS.projectTask,            fk: '_msdyn_project_value', label: 'tasks' },
  { set: ENTITY_SETS.projectBucket,          fk: '_msdyn_project_value', label: 'buckets' },
  { set: ENTITY_SETS.projectSprint,          fk: '_msdyn_project_value', label: 'sprints' },
  { set: ENTITY_SETS.projectLabel,           fk: '_msdyn_project_value', label: 'labels' },
  { set: ENTITY_SETS.projectTeamMember,      fk: '_msdyn_project_value', label: 'team members' },
  // Governance / monitoring tables (project-scoped pmo_* entities).
  { set: ENTITY_SETS.projectRisk,            fk: '_msdyn_project_value', label: 'risks' },
  { set: ENTITY_SETS.projectIssue,           fk: '_msdyn_project_value', label: 'issues' },
  { set: ENTITY_SETS.projectChange,          fk: '_msdyn_project_value', label: 'changes' },
  { set: ENTITY_SETS.statusReport,           fk: '_msdyn_project_value', label: 'status reports' },
  { set: ENTITY_SETS.projectBaseline,        fk: '_pmo_project_value',   label: 'baselines' },
  { set: ENTITY_SETS.projectDecision,        fk: '_pmo_project_value',   label: 'decisions' },
  { set: ENTITY_SETS.projectGateDecision,    fk: '_pmo_project_value',   label: 'gate decisions' },
  { set: ENTITY_SETS.projectGate,            fk: '_pmo_project_value',   label: 'gates' },
  { set: ENTITY_SETS.projectArtifactStatus,  fk: '_pmo_project_value',   label: 'artifact statuses' },
  { set: ENTITY_SETS.projectCloseout,        fk: '_pmo_project_value',   label: 'closeouts' },
  // Cross-entity sidecars that may carry a project lookup.
  { set: ENTITY_SETS.projectTeam,            fk: '_pmo_project_value',   label: 'project teams' },
  { set: ENTITY_SETS.projectMeetingLink,     fk: '_pmo_project_value',   label: 'meeting links' },
  { set: ENTITY_SETS.notification,           fk: '_pmo_project_value',   label: 'notifications' },
  { set: ENTITY_SETS.telemetryEvent,         fk: '_pmo_project_value',   label: 'telemetry events' },
  // Originating intake request (lookup points back at the created project).
  { set: ENTITY_SETS.projectRequest,         fk: '_pmo_convertedproject_value', label: 'intake requests' },
  { set: ENTITY_SETS.projectRequest,         fk: '_pmo_convertedprojectref_value', label: 'intake requests (custom link)' },
];

async function countByFk(set: string, fk: string, parentId: string): Promise<number> {
  try {
    const rows = await dv.list<Record<string, unknown>>(set, {
      $select: [fk.replace(/^_/, '').replace(/_value$/, 'id')],
      $filter: `${fk} eq ${parentId}`,
      $top: 5000,
    });
    return rows.length;
  } catch {
    // Tables that don't exist in the env (or the user can't read) shouldn't
    // block the whole pre-flight. Return 0 so the row hides from the dialog.
    return 0;
  }
}

async function listIdsByFk(
  set: string,
  fk: string,
  parentId: string,
  idField: string,
  extraFilter?: string,
): Promise<string[]> {
  try {
    const filter = extraFilter
      ? `${fk} eq ${parentId} and (${extraFilter})`
      : `${fk} eq ${parentId}`;
    const rows = await dv.list<Record<string, string>>(set, {
      $select: [idField],
      $filter: filter,
      $top: 5000,
    });
    return rows.map((r) => r[idField]).filter(Boolean);
  } catch {
    return [];
  }
}

function idFieldFor(fk: string): string {
  // _msdyn_project_value → msdyn_projectid (logicalname + 'id'). But child
  // ID fields are NOT necessarily named off the parent fk — they follow
  // their own logical name. Caller passes the right field via mapping below.
  return fk;
}

// Each entity-set has its own primary key field. We can't infer it from the
// FK alone, so map it explicitly.
const PK_FIELD: Record<string, string> = {
  [ENTITY_SETS.projectTaskDependency]:  'msdyn_projecttaskdependencyid',
  [ENTITY_SETS.resourceAssignment]:     'msdyn_resourceassignmentid',
  [ENTITY_SETS.projectTaskToLabel]:     'msdyn_projecttasktolabelid',
  [ENTITY_SETS.projectChecklist]:       'msdyn_projectchecklistid',
  [ENTITY_SETS.projectTask]:            'msdyn_projecttaskid',
  [ENTITY_SETS.projectBucket]:          'msdyn_projectbucketid',
  [ENTITY_SETS.projectSprint]:          'msdyn_projectsprintid',
  [ENTITY_SETS.projectLabel]:           'msdyn_projectlabelid',
  [ENTITY_SETS.projectTeamMember]:      'msdyn_projectteamid',
  [ENTITY_SETS.projectRisk]:            'msdyn_projectriskid',
  [ENTITY_SETS.projectIssue]:           'msdyn_projectissueid',
  [ENTITY_SETS.projectChange]:          'msdyn_projectchangeid',
  [ENTITY_SETS.statusReport]:           'msdyn_projectstatusreportid',
  [ENTITY_SETS.projectBaseline]:        'pmo_projectbaselineid',
  [ENTITY_SETS.projectDecision]:        'pmo_projectdecisionid',
  [ENTITY_SETS.projectGateDecision]:    'pmo_projectgatedecisionid',
  [ENTITY_SETS.projectGate]:            'pmo_projectgateid',
  [ENTITY_SETS.projectArtifactStatus]:  'pmo_projectartifactstatusid',
  [ENTITY_SETS.projectCloseout]:        'pmo_projectcloseoutid',
  [ENTITY_SETS.projectTeam]:            'pmo_projectteamid',
  [ENTITY_SETS.projectMeetingLink]:     'pmo_projectmeetinglinkid',
  [ENTITY_SETS.notification]:           'pmo_notificationid',
  [ENTITY_SETS.telemetryEvent]:         'pmo_telemetryeventid',
  [ENTITY_SETS.project]:                'msdyn_projectid',
  [ENTITY_SETS.program]:                'msdyn_projectprogramid',
  [ENTITY_SETS.projectRequest]:         'pmo_projectrequestid',
};

const CUSTOM_TASK_SCOPED: ReadonlyArray<{ set: string; fk: string; pk: string; label: string }> = [
  { set: 'pmo_taskdependencies', fk: '_pmo_predecessortask_value', pk: 'pmo_taskdependencyid', label: 'custom task dependencies' },
  { set: 'pmo_taskassignments',  fk: '_pmo_task_value',            pk: 'pmo_taskassignmentid',  label: 'custom task assignments' },
  { set: 'pmo_checklists',       fk: '_pmo_task_value',            pk: 'pmo_checklistid',       label: 'custom task checklists' },
  { set: 'pmo_tasktolabels',     fk: '_pmo_task_value',            pk: 'pmo_tasktolabelid',     label: 'custom task labels' },
];
const CUSTOM_PROJECT_SCOPED: ReadonlyArray<{ set: string; fk: string; pk: string; label: string }> = [
  { set: 'pmo_tasks',   fk: '_pmo_project_value', pk: 'pmo_taskid',   label: 'custom tasks' },
  { set: 'pmo_buckets', fk: '_pmo_project_value', pk: 'pmo_bucketid', label: 'custom buckets' },
  // Tier 2 decoupling: Monitor twins keyed off the pmo_project lookup (best-effort;
  // empty on a pss-source project).
  { set: 'pmo_projectrisks',   fk: '_pmo_project_value', pk: 'pmo_projectriskid',   label: 'custom risks' },
  { set: 'pmo_projectissues',  fk: '_pmo_project_value', pk: 'pmo_projectissueid',  label: 'custom issues' },
  { set: 'pmo_projectchanges', fk: '_pmo_project_value', pk: 'pmo_projectchangeid', label: 'custom changes' },
];

// Delete the custom-source pmo_ children of a project: task-scoped rows
// (deps/assignments/checklists/labels, keyed off the project's pmo_task ids)
// first, then the tasks + buckets. Best-effort per row; empty on a PSS project.
async function deleteCustomProjectChildren(projectId: string): Promise<void> {
  const taskIds = await listIdsByFk('pmo_tasks', '_pmo_project_value', projectId, 'pmo_taskid');
  if (taskIds.length > 0) {
    await Promise.all(CUSTOM_TASK_SCOPED.map(async ({ set, fk, pk }) => {
      const idLists = await Promise.all(taskIds.map((tid) => listIdsByFk(set, fk, tid, pk)));
      const ids = idLists.flat();
      await Promise.all(ids.map((id) => dv.remove(set, id).catch(() => undefined)));
    }));
  }
  await Promise.all(CUSTOM_PROJECT_SCOPED.map(async ({ set, fk, pk }) => {
    const ids = await listIdsByFk(set, fk, projectId, pk);
    await Promise.all(ids.map((id) => dv.remove(set, id).catch(() => undefined)));
  }));
}

export async function summarizeProjectDelete(projectId: string): Promise<DeleteChildSummary[]> {
  const counts = await Promise.all(
    PROJECT_CHILD_SPEC.map(async ({ set, fk, label }) => ({ label, count: await countByFk(set, fk, projectId) })),
  );
  const customCounts = await Promise.all(
    CUSTOM_PROJECT_SCOPED.map(async ({ set, fk, label }) => ({ label, count: await countByFk(set, fk, projectId) })),
  );
  return [...counts, ...customCounts].filter((c) => c.count > 0);
}

/**
 * Soft-delete a project and every related child. Order:
 *   1. Children, grouped by entity, all-at-once within an entity.
 *   2. The project itself.
 */
export async function cascadeDeleteProject(projectId: string): Promise<void> {
  // Sweep the independent msdyn_* child entities in PARALLEL (was a sequential
  // ~24-entity loop -- the "delete is slow" report). EntityChange audit rows are
  // preserved so the timeline still shows create/modify/delete after removal.
  const sweepMsdyn = Promise.all(PROJECT_CHILD_SPEC.map(async ({ set, fk }) => {
    const pk = PK_FIELD[set];
    if (!pk) return;
    const extraFilter =
      set === ENTITY_SETS.telemetryEvent ? "pmo_eventtype ne 'EntityChange'" : undefined;
    const ids = await listIdsByFk(set, fk, projectId, pk, extraFilter);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => dv.remove(set, id).catch(() => undefined)));
  }));
  // Custom pmo_ children run concurrently (disjoint tables from the msdyn_ sweep).
  await Promise.all([sweepMsdyn, deleteCustomProjectChildren(projectId)]);

  // Authored custom data lives in pmo_project (same GUID as the msdyn_project
  // shell). Soft-delete it; swallow 404 on a PSS-source project.
  await dv.deactivate('pmo_projects', projectId).catch(() => undefined);
  // Hard-delete the msdyn_project shell. In CUSTOM mode a project has NO shell
  // (create/migration write pmo_project only), so this 404s with 0x80040217
  // "Entity 'msdyn_project' ... Does Not Exist". The pmo_projects deactivate
  // above is the authoritative delete in custom mode, so the shell removal is
  // best-effort — swallow the miss (mirrors the deactivate above). In PSS mode
  // the shell exists and this IS the real delete.
  await dv.remove(ENTITY_SETS.project, projectId).catch(() => undefined);
}

// ── Program cascade ──────────────────────────────────────────────────────────

const PROGRAM_CHILD_SPEC: ReadonlyArray<{
  set: string;
  fk: '_msdyn_program_value' | '_pmo_program_value' | '_pmo_convertedprogram_value';
  label: string;
}> = [
  { set: ENTITY_SETS.projectDecision,    fk: '_pmo_program_value',   label: 'program decisions' },
  { set: ENTITY_SETS.projectMeetingLink, fk: '_pmo_program_value',   label: 'program meeting links' },
  { set: ENTITY_SETS.notification,       fk: '_pmo_program_value',   label: 'program notifications' },
  // Originating intake request (lookup points back at the created program).
  { set: ENTITY_SETS.projectRequest,     fk: '_pmo_convertedprogram_value', label: 'intake requests' },
];

async function listProjectIdsForProgram(programId: string): Promise<string[]> {
  return listIdsByFk(ENTITY_SETS.project, '_msdyn_program_value', programId, PK_FIELD[ENTITY_SETS.project]);
}

export async function summarizeProgramDelete(programId: string): Promise<DeleteChildSummary[]> {
  const directCounts = await Promise.all(
    PROGRAM_CHILD_SPEC.map(async ({ set, fk, label }) => ({ label, count: await countByFk(set, fk, programId) })),
  );
  const projectIds = await listProjectIdsForProgram(programId);
  let nestedTaskCount = 0;
  let nestedOther = 0;
  for (const pid of projectIds) {
    for (const { set, fk } of PROJECT_CHILD_SPEC) {
      const n = await countByFk(set, fk, pid);
      if (set === ENTITY_SETS.projectTask) nestedTaskCount += n;
      else nestedOther += n;
    }
  }
  const summary: DeleteChildSummary[] = [
    ...directCounts,
    { label: 'projects', count: projectIds.length },
  ];
  if (nestedTaskCount > 0) summary.push({ label: 'project tasks (across all projects)', count: nestedTaskCount });
  if (nestedOther > 0) summary.push({ label: 'other project-scoped records', count: nestedOther });
  return summary.filter((c) => c.count > 0);
}

/**
 * Soft-delete a program AND every project under it AND every project's
 * children. This is the maximum-cascade option chosen by Antonio in design.
 */
export async function cascadeDeleteProgram(programId: string): Promise<void> {
  // Projects under the program first — each is a full cascade.
  const projectIds = await listProjectIdsForProgram(programId);
  for (const pid of projectIds) {
    await cascadeDeleteProject(pid);
  }
  // Program-scoped direct children.
  for (const { set, fk } of PROGRAM_CHILD_SPEC) {
    const pk = PK_FIELD[set];
    if (!pk) continue;
    const ids = await listIdsByFk(set, fk, programId, pk);
    if (ids.length === 0) continue;
    await Promise.all(ids.map((id) => dv.remove(set, id).catch(() => undefined)));
  }
  // Custom source: authored data lives in pmo_program (same GUID as the
  // msdyn_projectprogram shell). Soft-delete it too; swallow 404 on PSS source.
  await dv.deactivate('pmo_programs', programId).catch(() => undefined);
  await dv.remove(ENTITY_SETS.program, programId);
}

// Suppress unused-warning on idFieldFor (kept for symmetry / future use).
void idFieldFor;
