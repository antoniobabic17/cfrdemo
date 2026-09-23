/**
 * Option-C custom-source checklist items (pmo_checklist).
 *
 * On the custom task source a task's GUID lives only in pmo_task, so the PSS
 * checklist path (msdyn_projectchecklist bound to msdyn_projecttasks) 404s.
 * This reads/writes our own pmo_checklist table and normalizes back to the
 * existing ProjectChecklist shape so TaskDetailPanel needs no changes.
 *
 * Same-GUID with msdyn_projectchecklist so the mirror/ETL correlate 1:1.
 * Nav prop for the task lookup is PascalCase pmo_Task (verified on DEV).
 */

import * as dv from '../lib/dataverseClient';
import { touchProjectFromTask, touchProjectFromTaskChild } from './customProjects.api';
import type { ProjectChecklist } from '../models/projectChecklist.model';

const SET = 'pmo_checklists';

interface PmoChecklistRow {
  pmo_checklistid: string;
  pmo_name?: string | null;
  pmo_completed?: boolean | null;
  pmo_order?: number | null;
  pmo_duedate?: string | null;
  statecode?: 0 | 1;
  createdon?: string;
  _pmo_task_value?: string | null;
}

const SELECT: string[] = [
  'pmo_checklistid',
  'pmo_name',
  'pmo_completed',
  'pmo_order',
  'pmo_duedate',
  'statecode',
  'createdon',
  '_pmo_task_value',
];

/** Normalize a pmo_checklist row into the ProjectChecklist shape the app uses. */
export function normalizeCustomChecklist(row: PmoChecklistRow): ProjectChecklist {
  return {
    msdyn_projectchecklistid: row.pmo_checklistid,
    msdyn_name: row.pmo_name ?? '',
    msdyn_projectchecklistcompleted: row.pmo_completed ?? false,
    msdyn_projectchecklistorder: row.pmo_order ?? 0,
    dueDate: row.pmo_duedate ?? null,
    '_msdyn_projecttaskid_value': row._pmo_task_value ?? null,
    statecode: row.statecode ?? 0,
    createdon: row.createdon,
  };
}

/** List active checklist items for a task from pmo_checklist. */
export async function listCustomChecklistsForTask(taskId: string): Promise<ProjectChecklist[]> {
  const rows = await dv.list<PmoChecklistRow>(SET, {
    $select: SELECT,
    $filter: `_pmo_task_value eq '${taskId}' and statecode eq 0`,
    $orderby: 'pmo_order asc',
  });
  return rows.map(normalizeCustomChecklist);
}

/** Shape the create payload. Pure -- unit tested. */
export function buildCustomChecklistCreatePayload(
  taskId: string,
  name: string,
  order?: number,
  completed?: boolean,
  dueDate?: string | null,
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    pmo_name: name,
    'pmo_Task@odata.bind': `/pmo_tasks(${taskId})`,
    pmo_completed: completed ?? false,
  };
  if (order !== undefined) p.pmo_order = order;
  // DateOnly column: send YYYY-MM-DD as-is (nulls clear it).
  if (dueDate !== undefined) p.pmo_duedate = dueDate;
  return p;
}

/** Create a checklist item. Returns the new server GUID. */
export async function createCustomChecklistItem(
  taskId: string,
  name: string,
  order?: number,
  completed?: boolean,
  dueDate?: string | null,
): Promise<string> {
  const created = await dv.create<PmoChecklistRow>(
    SET,
    buildCustomChecklistCreatePayload(taskId, name, order, completed, dueDate),
  );
  void touchProjectFromTask(taskId);
  return created.pmo_checklistid;
}

/** Update name/completed on a checklist item. No-op when nothing to write. */
export async function updateCustomChecklistItem(
  checklistId: string,
  patch: { name?: string; completed?: boolean; dueDate?: string | null; order?: number },
): Promise<void> {
  const p: Record<string, unknown> = {};
  if (patch.name !== undefined) p.pmo_name = patch.name;
  if (patch.completed !== undefined) p.pmo_completed = patch.completed;
  if (patch.dueDate !== undefined) p.pmo_duedate = patch.dueDate;
  if (patch.order !== undefined) p.pmo_order = patch.order;
  if (Object.keys(p).length === 0) return;
  await dv.update(SET, checklistId, p);
  void touchProjectFromTaskChild(SET, checklistId);
}

/** Persist a new display order for a set of checklist items (drag-reorder).
 *  PATCHes only the items whose order changed; sequential (lists are small).
 *  Touches the parent project once at the end. */
export async function reorderCustomChecklistItems(
  items: Array<{ id: string; order: number }>,
): Promise<void> {
  if (items.length === 0) return;
  for (const it of items) {
    await dv.update(SET, it.id, { pmo_order: it.order });
  }
  // One project touch for the whole reorder (via the first item's task).
  void touchProjectFromTaskChild(SET, items[0].id);
}

/** Soft-delete a checklist item (statecode=1), matching the pmo_ convention. */
export async function deleteCustomChecklistItem(checklistId: string): Promise<void> {
  void touchProjectFromTaskChild(SET, checklistId);
  await dv.deactivate(SET, checklistId);
}
