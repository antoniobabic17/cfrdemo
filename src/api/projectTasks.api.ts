import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectTask } from '../models/projectTask.model';

const SET = ENTITY_SETS.projectTask;

const BASE_SELECT: string[] = [
  'msdyn_projecttaskid',
  'pmo_taskid',
  'msdyn_subject',
  'msdyn_description',
  'msdyn_scheduledstart',
  'msdyn_scheduledend',
  'msdyn_finish',
  'msdyn_duration',
  'msdyn_effort',
  'msdyn_effortcompleted',
  'msdyn_effortremaining',
  'msdyn_progress',
  'pmo_taskeffort',
  'pmo_taskhoursdone',
  'msdyn_priority',
  'msdyn_iscritical',
  'msdyn_ismilestone',
  'msdyn_summary',
  'msdyn_outlinelevel',
  'msdyn_displaysequence',
  'statecode',
  'createdon',
  '_msdyn_project_value',
  '_msdyn_projectbucket_value',
  '_msdyn_parenttask_value',
  '_msdyn_projectsprint_value',
];

/** Fetch all tasks (open and closed) for a project. */
export async function listProjectTasks(projectId: string): Promise<ProjectTask[]> {
  return dv.list<ProjectTask>(SET, {
    $select: BASE_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}'`,
    $orderby: 'msdyn_displaysequence asc',
  });
}

/**
 * Update the CVS-owned effort columns on a task. Direct OData PATCH --
 * no PSS, no OperationSet. Only touches custom pmo_* columns so the
 * Dataverse "cannot directly update msdyn_projecttask" gate (which fires
 * on PSS-managed columns like msdyn_scheduledstart) does not apply.
 */
export async function updateTaskCustomFields(
  taskId: string,
  patch: { pmo_taskeffort?: number | null; pmo_taskhoursdone?: number | null },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.pmo_taskeffort !== undefined)    body.pmo_taskeffort = patch.pmo_taskeffort;
  if (patch.pmo_taskhoursdone !== undefined) body.pmo_taskhoursdone = patch.pmo_taskhoursdone;
  if (Object.keys(body).length === 0) return;
  await dv.update(SET, taskId, body);
}
