/**
 * Option-C custom-source task-label associations (pmo_tasktolabel).
 *
 * The label definitions themselves stay in msdyn_projectlabel (project-scoped,
 * unchanged) -- only the task<->label ASSOCIATION breaks on the custom source,
 * because msdyn_projecttasktolabel binds to msdyn_projecttask via PSS. This
 * reads/writes pmo_tasktolabel (task -> pmo_task, label -> msdyn_projectlabel)
 * and normalizes to the existing ProjectTaskToLabel shape so the UI is unchanged.
 *
 * Same-GUID with msdyn_projecttasktolabel so mirror/ETL correlate 1:1.
 * Nav props are PascalCase pmo_Task / pmo_ProjectLabel (verified on DEV).
 */

import * as dv from '../lib/dataverseClient';
import { touchProjectFromTask, touchProjectFromTaskChild } from './customProjects.api';
import type { ProjectTaskToLabel } from '../models/projectLabel.model';

const SET = 'pmo_tasktolabels';

interface PmoTaskToLabelRow {
  pmo_tasktolabelid: string;
  statecode?: 0 | 1;
  _pmo_task_value?: string | null;
  _pmo_projectlabel_value?: string | null;
}

const SELECT: string[] = [
  'pmo_tasktolabelid',
  'statecode',
  '_pmo_task_value',
  '_pmo_projectlabel_value',
];

/** Normalize a pmo_tasktolabel row into the ProjectTaskToLabel shape. */
export function normalizeCustomTaskLabel(row: PmoTaskToLabelRow): ProjectTaskToLabel {
  return {
    msdyn_projecttasktolabelid: row.pmo_tasktolabelid,
    // Real association rows always have both lookups populated (same as the
    // PSS msdyn_projecttasktolabel path); coerce to '' to satisfy the model.
    '_msdyn_projectlabelid_value': row._pmo_projectlabel_value ?? '',
    '_msdyn_projecttaskid_value': row._pmo_task_value ?? '',
    statecode: row.statecode ?? 0,
  };
}

/** List active task-label associations for ONE project, matching the PSS
 *  listTaskLabels(projectId) scope. Filtering by the parent project (via the
 *  pmo_task lookup's own project) avoids fetching every junction in the org
 *  ($top 5000, unfiltered) on each invalidate — that unfiltered read was the
 *  ~5s lag after assigning a label (operator report 2026-07-30). projectId is
 *  optional so an omitted call still works (falls back to the wide read). */
export async function listCustomTaskLabels(projectId?: string): Promise<ProjectTaskToLabel[]> {
  const filter = projectId
    ? `statecode eq 0 and pmo_Task/_pmo_project_value eq ${projectId}`
    : `statecode eq 0`;
  const rows = await dv.list<PmoTaskToLabelRow>(SET, {
    $select: SELECT,
    $filter: filter,
    $top: 5000,
  });
  return rows.map(normalizeCustomTaskLabel);
}

/** Shape the create payload. Pure -- unit tested. */
export function buildCustomTaskLabelCreatePayload(taskId: string, labelId: string): Record<string, unknown> {
  return {
    'pmo_Task@odata.bind': `/pmo_tasks(${taskId})`,
    'pmo_ProjectLabel@odata.bind': `/msdyn_projectlabels(${labelId})`,
  };
}

/** Assign a label to a task. Returns the new association GUID. */
export async function assignCustomLabel(taskId: string, labelId: string): Promise<string> {
  const created = await dv.create<PmoTaskToLabelRow>(SET, buildCustomTaskLabelCreatePayload(taskId, labelId));
  void touchProjectFromTask(taskId);
  return created.pmo_tasktolabelid;
}

/** Soft-delete a task-label association. */
export async function removeCustomLabel(taskToLabelId: string): Promise<void> {
  void touchProjectFromTaskChild(SET, taskToLabelId);
  await dv.deactivate(SET, taskToLabelId);
}
