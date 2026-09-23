/**
 * Custom-source (pmo_projectchange) read/write for the Monitor tab. Used only when
 * dataSource === 'custom'; the pss path stays on projectChanges.api.ts. Normalizes
 * pmo_* rows into the ProjectChange model shape + synthesizes picklist labels.
 */
import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { ProjectChange } from '../models/projectChange.model';
import type { ProjectChangePayload, ProjectChangeCreate } from './projectChanges.api';
import {
  CHANGE_TYPE_LABELS, CHANGE_IMPACT_LABELS, CHANGE_RISK_LABELS, PRIORITY_LABELS,
  CHANGE_APPROVAL_LABELS, STATE_LABELS, labelFor,
} from './monitorOptionLabels';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_projectchanges';

interface PmoChangeRow {
  pmo_projectchangeid: string;
  pmo_subject?: string | null;
  pmo_description?: string | null;
  pmo_additionalcomments?: string | null;
  pmo_changebenefits?: string | null;
  pmo_changeplan?: string | null;
  pmo_costimpact?: number | null;
  pmo_plannedstartdate?: string | null;
  pmo_plannedduedate?: string | null;
  pmo_requesteddate?: string | null;
  pmo_changetype?: number | null;
  pmo_changeimpact?: number | null;
  pmo_changerisk?: number | null;
  pmo_priority?: number | null;
  pmo_approval?: number | null;
  pmo_state?: number | null;
  statecode?: 0 | 1;
  createdon?: string;
  _pmo_project_value?: string | null;
  _pmo_assignedto_value?: string | null;
  '_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  _pmo_requestedby_value?: string | null;
  '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const BASE_SELECT: string[] = [
  'pmo_projectchangeid', 'pmo_subject', 'pmo_description', 'pmo_additionalcomments',
  'pmo_changebenefits', 'pmo_changeplan', 'pmo_costimpact', 'pmo_plannedstartdate',
  'pmo_plannedduedate', 'pmo_requesteddate', 'pmo_changetype', 'pmo_changeimpact',
  'pmo_changerisk', 'pmo_priority', 'pmo_approval', 'pmo_state', 'statecode',
  'createdon', '_pmo_project_value', '_pmo_assignedto_value', '_pmo_requestedby_value',
];

export function normalizeCustomChange(row: PmoChangeRow): ProjectChange {
  return {
    msdyn_projectchangeid: row.pmo_projectchangeid,
    msdyn_name: row.pmo_subject ?? '',
    msdyn_description: row.pmo_description ?? undefined,
    msdyn_additionalcomments: row.pmo_additionalcomments ?? undefined,
    proj_changetype: row.pmo_changetype ?? undefined,
    'proj_changetype@OData.Community.Display.V1.FormattedValue': labelFor(CHANGE_TYPE_LABELS, row.pmo_changetype),
    proj_changeimpact: row.pmo_changeimpact ?? undefined,
    'proj_changeimpact@OData.Community.Display.V1.FormattedValue': labelFor(CHANGE_IMPACT_LABELS, row.pmo_changeimpact),
    proj_changerisk: row.pmo_changerisk ?? undefined,
    'proj_changerisk@OData.Community.Display.V1.FormattedValue': labelFor(CHANGE_RISK_LABELS, row.pmo_changerisk),
    proj_priority: row.pmo_priority ?? undefined,
    'proj_priority@OData.Community.Display.V1.FormattedValue': labelFor(PRIORITY_LABELS, row.pmo_priority),
    proj_approval: row.pmo_approval ?? undefined,
    'proj_approval@OData.Community.Display.V1.FormattedValue': labelFor(CHANGE_APPROVAL_LABELS, row.pmo_approval),
    proj_state: row.pmo_state ?? undefined,
    'proj_state@OData.Community.Display.V1.FormattedValue': labelFor(STATE_LABELS, row.pmo_state),
    proj_costimpact: row.pmo_costimpact ?? undefined,
    // All three are Edm.Date columns — expand to noon-UTC for display.
    proj_plannedstartdate: edmDateToNoonUtc(row.pmo_plannedstartdate),
    proj_plannedduedate: edmDateToNoonUtc(row.pmo_plannedduedate),
    proj_requesteddate: edmDateToNoonUtc(row.pmo_requesteddate),
    proj_changebenefits: row.pmo_changebenefits ?? undefined,
    proj_changeplan: row.pmo_changeplan ?? undefined,
    statecode: row.statecode ?? 0,
    createdon: row.createdon,
    _msdyn_project_value: row._pmo_project_value ?? undefined,
    _proj_assignedto_value: row._pmo_assignedto_value ?? undefined,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'],
    _proj_requestedby_value: row._pmo_requestedby_value ?? undefined,
    '_proj_requestedby_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue'],
  };
}

export async function listCustomChanges(projectId: string): Promise<ProjectChange[]> {
  const rows = await dv.list<PmoChangeRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
  return rows.map(normalizeCustomChange);
}

export function toPmoChangePayload(p: ProjectChangePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.msdyn_name !== undefined) out.pmo_subject = p.msdyn_name;
  if (p.msdyn_description !== undefined) out.pmo_description = p.msdyn_description;
  if (p.msdyn_additionalcomments !== undefined) out.pmo_additionalcomments = p.msdyn_additionalcomments;
  if (p.proj_changebenefits !== undefined) out.pmo_changebenefits = p.proj_changebenefits;
  if (p.proj_changeplan !== undefined) out.pmo_changeplan = p.proj_changeplan;
  if (p.proj_costimpact !== undefined) out.pmo_costimpact = p.proj_costimpact;
  // All three are Edm.Date — send bare YYYY-MM-DD (a full ISO is rejected).
  if (p.proj_plannedstartdate !== undefined) out.pmo_plannedstartdate = p.proj_plannedstartdate === null ? null : toEdmDate(p.proj_plannedstartdate);
  if (p.proj_plannedduedate !== undefined) out.pmo_plannedduedate = p.proj_plannedduedate === null ? null : toEdmDate(p.proj_plannedduedate);
  if (p.proj_requesteddate !== undefined) out.pmo_requesteddate = p.proj_requesteddate === null ? null : toEdmDate(p.proj_requesteddate);
  if (p.proj_changetype !== undefined) out.pmo_changetype = p.proj_changetype;
  if (p.proj_changeimpact !== undefined) out.pmo_changeimpact = p.proj_changeimpact;
  if (p.proj_changerisk !== undefined) out.pmo_changerisk = p.proj_changerisk;
  if (p.proj_priority !== undefined) out.pmo_priority = p.proj_priority;
  if (p.proj_approval !== undefined) out.pmo_approval = p.proj_approval;
  if (p.proj_state !== undefined) out.pmo_state = p.proj_state;
  const owner = p['proj_AssignedTo@odata.bind'];
  if (owner !== undefined) out['pmo_AssignedTo@odata.bind'] = owner;
  return out;
}

export async function createCustomChange(projectId: string, payload: ProjectChangeCreate): Promise<ProjectChange> {
  const body = toPmoChangePayload(payload);
  body['pmo_Project@odata.bind'] = `/pmo_projects(${projectId})`;
  const created = await dv.create<PmoChangeRow>(SET, body);
  void touchCustomProject(projectId);
  return normalizeCustomChange(created);
}

export async function updateCustomChange(id: string, payload: ProjectChangePayload): Promise<void> {
  await dv.update(SET, id, toPmoChangePayload(payload));
  void touchProjectFromChild(SET, id, '_pmo_project_value');
}

export async function deleteCustomChange(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, '_pmo_project_value');
  await dv.deactivate(SET, id);
}
