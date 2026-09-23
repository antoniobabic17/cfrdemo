/**
 * Option-C custom-source resource assignments (pmo_taskassignment).
 *
 * Sister to customTasks/customBuckets. When `pmo.task_source === 'custom'` the
 * app can't route assignments through PSS (`msdyn_resourceassignment` -> PSS
 * `msdyn_PssCreateV1`) because the task lives only in pmo_task, not
 * msdyn_projecttask, so PSS throws AV-0006. Instead we read/write our own
 * `pmo_taskassignment` table, which mirrors the fields the app actually uses:
 *   pmo_task (-> pmo_task)   ~ msdyn_taskid
 *   pmo_projectteam          ~ msdyn_projectteamid
 *   pmo_project              ~ msdyn_projectid
 *   pmo_name                 ~ msdyn_name
 *
 * Everything normalizes back to the existing `ResourceAssignment` shape so the
 * assignment map in ProjectDetailPage and the TaskRow chips need no changes.
 * Same-GUID with msdyn_resourceassignment so the mirror/ETL correlate 1:1.
 *
 * Nav-property names for @odata.bind are PascalCase
 * (ReferencingEntityNavigationPropertyName), confirmed against DEV metadata:
 * pmo_Task / pmo_ProjectTeam / pmo_Project.
 */

import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { ResourceAssignment } from '../models/resourceAssignment.model';

const SET = 'pmo_taskassignments';

interface PmoAssignmentRow {
  pmo_taskassignmentid: string;
  pmo_name?: string | null;
  statecode?: number;
  _pmo_task_value?: string | null;
  _pmo_projectteam_value?: string | null;
  '_pmo_projectteam_value@OData.Community.Display.V1.FormattedValue'?: string;
  _pmo_projectref_value?: string | null;  // NEW -> pmo_project (Tier 1 decoupling)
  _pmo_user_value?: string | null;
  '_pmo_user_value@OData.Community.Display.V1.FormattedValue'?: string;
  /** New Resource Model: this assignee's contributed hours on the task. */
  pmo_contributedhours?: number | null;
}

const BASE_SELECT: string[] = [
  'pmo_taskassignmentid',
  'pmo_name',
  'statecode',
  '_pmo_task_value',
  '_pmo_projectteam_value',
  '_pmo_projectref_value',
  '_pmo_user_value',
  'pmo_contributedhours',
];

/** Normalize a pmo_taskassignment row into the ResourceAssignment shape the
 *  rest of the app already consumes (re-label pmo_* lookups to msdyn_*).
 *  Also surfaces the pmo_user systemuser identity (assigneeUserId/Name) which
 *  the custom-source display resolver prefers over the projectteam/BR chain. */
export function normalizeCustomAssignment(row: PmoAssignmentRow): ResourceAssignment {
  return {
    msdyn_resourceassignmentid: row.pmo_taskassignmentid,
    '_msdyn_taskid_value': row._pmo_task_value ?? null,
    '_msdyn_projectteamid_value': row._pmo_projectteam_value ?? null,
    '_msdyn_projectid_value': row._pmo_projectref_value ?? null,
    '_msdyn_projectteamid_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_projectteam_value@OData.Community.Display.V1.FormattedValue'],
    msdyn_name: row.pmo_name ?? undefined,
    statecode: row.statecode ?? 0,
    assigneeUserId: row._pmo_user_value ?? null,
    assigneeUserName: row['_pmo_user_value@OData.Community.Display.V1.FormattedValue'],
    contributedHours: row.pmo_contributedhours ?? undefined,
  };
}

/** List active assignments for a project from pmo_taskassignment. */
export async function listCustomAssignments(projectId: string): Promise<ResourceAssignment[]> {
  const rows = await dv.list<PmoAssignmentRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_projectref_value eq '${projectId}' and statecode eq 0`,
    $top: 1000,
  });
  return rows.map(normalizeCustomAssignment);
}

/**
 * Shape the pmo_taskassignment create payload. Pure -- unit tested.
 *
 * The assignee is identified by systemuserid (userId) -- the same identity the
 * app's edit-access model and assignee picker use, so ANY project-scoped user
 * can be assigned regardless of P4W bookable-resource provisioning.
 *
 * teamMemberId (a msdyn_projectteam row) is OPTIONAL: bound only when the person
 * already has a projectteam roster row (BR-backed), which lets the reverse-ETL
 * create the corresponding msdyn_resourceassignment for P4W visibility. When
 * absent, the assignment is app-only (P4W can't represent a BR-less assignee).
 */
export function buildCustomAssignmentCreatePayload(
  projectId: string,
  taskId: string,
  userId: string,
  name: string,
  teamMemberId?: string | null,
  initialHours?: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    'pmo_Task@odata.bind': `/pmo_tasks(${taskId})`,
    'pmo_User@odata.bind': `/systemusers(${userId})`,
    'pmo_ProjectRef@odata.bind': `/pmo_projects(${projectId})`,
    pmo_name: name,
  };
  if (teamMemberId) {
    payload['pmo_ProjectTeam@odata.bind'] = `/msdyn_projectteams(${teamMemberId})`;
  }
  if (typeof initialHours === 'number') {
    payload.pmo_contributedhours = initialHours;
  }
  return payload;
}

/** Create an assignment in pmo_taskassignment. Returns the new server GUID.
 *  Assignee is keyed by systemuserid; teamMemberId is optional (bound only when
 *  a projectteam roster row exists, for P4W reverse-ETL). */
export async function createCustomAssignment(
  projectId: string,
  taskId: string,
  userId: string,
  name: string,
  teamMemberId?: string | null,
  initialHours?: number,
): Promise<string> {
  const created = await dv.create<PmoAssignmentRow>(
    SET,
    buildCustomAssignmentCreatePayload(projectId, taskId, userId, name, teamMemberId, initialHours),
  );
  // New Resource Model: recompute pmo_currentcompletedhours so it reflects the
  // newly-created assignee's contributed hours immediately. projectId is already
  // a param so no extra read is needed — same pattern as createCustomTask.
  void touchCustomProject(projectId);
  return created.pmo_taskassignmentid;
}

/** Soft-delete an assignment (statecode=1), matching the pmo_ soft-delete
 *  convention so audit history + reconciliation stay symmetric. */
export async function deleteCustomAssignment(assignmentId: string): Promise<void> {
  // Resolve project BEFORE deactivating so the row's _pmo_projectref_value is
  // still readable. Fire-and-forget so a rollup failure can't fail the delete.
  void touchProjectFromChild(SET, assignmentId, '_pmo_projectref_value');
  await dv.deactivate(SET, assignmentId);
}

/**
 * Update the contributed hours on an existing pmo_taskassignment row.
 * Pass null to clear (sets the column to null, not zero).
 * New Resource Model only — the caller is responsible for checking the toggle.
 */
export async function updateCustomAssignmentHours(
  assignmentId: string,
  hours: number | null,
): Promise<void> {
  await dv.update(SET, assignmentId, { pmo_contributedhours: hours });
  // New Resource Model: recompute pmo_currentcompletedhours so the Overview
  // "Current Completed Hours" card reflects the change immediately.
  void touchProjectFromChild(SET, assignmentId, '_pmo_projectref_value');
}
