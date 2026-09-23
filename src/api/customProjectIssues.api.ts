/**
 * Custom-source (pmo_projectissue) read/write for the Monitor tab. Used only when
 * dataSource === 'custom'; the pss path stays on projectIssues.api.ts. Normalizes
 * pmo_* rows into the ProjectIssue model shape + synthesizes picklist labels.
 */
import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { ProjectIssue } from '../models/projectIssue.model';
import type { ProjectIssuePayload, ProjectIssueCreate } from './projectIssues.api';
import { ISSUE_CATEGORY_LABELS, PRIORITY_LABELS, STATE_LABELS, labelFor } from './monitorOptionLabels';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_projectissues';

interface PmoIssueRow {
  pmo_projectissueid: string;
  pmo_subject?: string | null;
  pmo_description?: string | null;
  pmo_resolution?: string | null;
  pmo_duedate?: string | null;
  pmo_issuecategory?: number | null;
  pmo_priority?: number | null;
  pmo_state?: number | null;
  statecode?: 0 | 1;
  createdon?: string;
  _pmo_project_value?: string | null;
  _pmo_assignedto_value?: string | null;
  '_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const BASE_SELECT: string[] = [
  'pmo_projectissueid', 'pmo_subject', 'pmo_description', 'pmo_resolution',
  'pmo_duedate', 'pmo_issuecategory', 'pmo_priority', 'pmo_state', 'statecode',
  'createdon', '_pmo_project_value', '_pmo_assignedto_value',
];

export function normalizeCustomIssue(row: PmoIssueRow): ProjectIssue {
  return {
    msdyn_projectissueid: row.pmo_projectissueid,
    msdyn_name: row.pmo_subject ?? '',
    msdyn_description: row.pmo_description ?? undefined,
    msdyn_resolution: row.pmo_resolution ?? undefined,
    // pmo_duedate is an Edm.Date column — expand to noon-UTC for display.
    proj_duedate: edmDateToNoonUtc(row.pmo_duedate),
    proj_issuecategory: row.pmo_issuecategory ?? undefined,
    'proj_issuecategory@OData.Community.Display.V1.FormattedValue': labelFor(ISSUE_CATEGORY_LABELS, row.pmo_issuecategory),
    proj_priority: row.pmo_priority ?? undefined,
    'proj_priority@OData.Community.Display.V1.FormattedValue': labelFor(PRIORITY_LABELS, row.pmo_priority),
    proj_state: row.pmo_state ?? undefined,
    'proj_state@OData.Community.Display.V1.FormattedValue': labelFor(STATE_LABELS, row.pmo_state),
    statecode: row.statecode ?? 0,
    createdon: row.createdon,
    _msdyn_project_value: row._pmo_project_value ?? undefined,
    _proj_assignedto_value: row._pmo_assignedto_value ?? undefined,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'],
  };
}

export async function listCustomIssues(projectId: string): Promise<ProjectIssue[]> {
  const rows = await dv.list<PmoIssueRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
  return rows.map(normalizeCustomIssue);
}

export function toPmoIssuePayload(p: ProjectIssuePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // The msdyn dialog uses msdyn_name as the visible title; map to pmo_subject.
  if (p.msdyn_name !== undefined) out.pmo_subject = p.msdyn_name;
  if (p.msdyn_description !== undefined) out.pmo_description = p.msdyn_description;
  if (p.msdyn_resolution !== undefined) out.pmo_resolution = p.msdyn_resolution;
  // pmo_duedate is Edm.Date — send bare YYYY-MM-DD (a full ISO is rejected).
  if (p.proj_duedate !== undefined) out.pmo_duedate = p.proj_duedate === null ? null : toEdmDate(p.proj_duedate);
  if (p.proj_issuecategory !== undefined) out.pmo_issuecategory = p.proj_issuecategory;
  if (p.proj_priority !== undefined) out.pmo_priority = p.proj_priority;
  if (p.proj_state !== undefined) out.pmo_state = p.proj_state;
  const owner = p['proj_AssignedTo@odata.bind'];
  if (owner !== undefined) out['pmo_AssignedTo@odata.bind'] = owner;
  return out;
}

export async function createCustomIssue(projectId: string, payload: ProjectIssueCreate): Promise<ProjectIssue> {
  const body = toPmoIssuePayload(payload);
  body['pmo_Project@odata.bind'] = `/pmo_projects(${projectId})`;
  const created = await dv.create<PmoIssueRow>(SET, body);
  void touchCustomProject(projectId);
  return normalizeCustomIssue(created);
}

export async function updateCustomIssue(id: string, payload: ProjectIssuePayload): Promise<void> {
  await dv.update(SET, id, toPmoIssuePayload(payload));
  void touchProjectFromChild(SET, id, '_pmo_project_value');
}

export async function deleteCustomIssue(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, '_pmo_project_value');
  await dv.deactivate(SET, id);
}
