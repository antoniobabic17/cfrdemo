/**
 * Custom-source (pmo_projectstatusreport) read/write for status reports. Sister
 * to customProjectRisks.api.ts. Used only when dataSource === 'custom'; the pss
 * path stays on statusReports.api.ts (msdyn_projectstatusreport).
 *
 * Native msdyn_projectstatusreport requires an msdyn_project parent, so a
 * migrated/decoupled project (pmo_project with NO shell) can't own one — creates
 * 404 with "Entity 'msdyn_project' ... Does Not Exist". This twin binds
 * pmo_project instead. Rows are normalized back into the existing StatusReport
 * model shape so StatusReportListPage / ProjectDetailPage / ProgramDetailPage
 * need no changes; the lookup FormattedValue annotations the SDK returns for
 * pmo_project / pmo_submitter are re-exposed under the msdyn_ / proj_ keys the
 * UI already reads.
 */
import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { StatusReport } from '../models/statusReport.model';
import type { StatusReportPayload, StatusReportCreate } from './statusReports.api';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_projectstatusreports';

interface PmoStatusReportRow {
  pmo_projectstatusreportid: string;
  pmo_name?: string | null;
  pmo_accomplishedactivities?: string | null;
  pmo_plannedactivities?: string | null;
  pmo_additionalcomments?: string | null;
  pmo_reportingdate?: string | null;
  statecode?: 0 | 1;
  createdon?: string;
  modifiedon?: string;
  _pmo_project_value?: string | null;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  _pmo_submitter_value?: string | null;
  '_pmo_submitter_value@OData.Community.Display.V1.FormattedValue'?: string;
  _pmo_submittedto_value?: string | null;
  '_pmo_submittedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  _createdby_value?: string | null;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const BASE_SELECT: string[] = [
  'pmo_projectstatusreportid', 'pmo_name', 'pmo_accomplishedactivities',
  'pmo_plannedactivities', 'pmo_additionalcomments', 'pmo_reportingdate',
  'statecode', 'createdon', 'modifiedon',
  '_pmo_project_value', '_pmo_submitter_value', '_pmo_submittedto_value',
  '_createdby_value',
];

export function normalizeCustomStatusReport(row: PmoStatusReportRow): StatusReport {
  return {
    msdyn_projectstatusreportid: row.pmo_projectstatusreportid,
    msdyn_name: row.pmo_name ?? '',
    msdyn_accomplishedactivities: row.pmo_accomplishedactivities ?? undefined,
    msdyn_plannedactivities: row.pmo_plannedactivities ?? undefined,
    msdyn_additionalcomments: row.pmo_additionalcomments ?? undefined,
    // pmo_reportingdate is Edm.Date (bare YYYY-MM-DD) — expand to noon-UTC so the
    // app's date renderers show the picked day, not the day before.
    proj_reportingdate: edmDateToNoonUtc(row.pmo_reportingdate) ?? undefined,
    statecode: row.statecode ?? 0,
    createdon: row.createdon,
    modifiedon: row.modifiedon,
    _msdyn_project_value: row._pmo_project_value ?? undefined,
    '_msdyn_project_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_project_value@OData.Community.Display.V1.FormattedValue'],
    _proj_submitter_value: row._pmo_submitter_value ?? undefined,
    '_proj_submitter_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_submitter_value@OData.Community.Display.V1.FormattedValue'],
    _proj_submittedto_value: row._pmo_submittedto_value ?? undefined,
    '_proj_submittedto_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_submittedto_value@OData.Community.Display.V1.FormattedValue'],
    _createdby_value: row._createdby_value ?? undefined,
    '_createdby_value@OData.Community.Display.V1.FormattedValue':
      row['_createdby_value@OData.Community.Display.V1.FormattedValue'],
  };
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isGuid(v: unknown): v is string {
  return typeof v === 'string' && GUID_RE.test(v);
}

export async function listCustomStatusReports(projectId?: string): Promise<StatusReport[]> {
  const filter = isGuid(projectId)
    ? `_pmo_project_value eq ${projectId} and statecode eq 0`
    : 'statecode eq 0';
  const rows = await dv.list<PmoStatusReportRow>(SET, {
    $select: BASE_SELECT,
    $filter: filter,
    $orderby: 'createdon desc',
  });
  return rows.map(normalizeCustomStatusReport);
}

/** Most-recent-per-project rollup for the program freshness view (custom twin). */
export async function listCustomStatusReportsByProjects(projectIds: string[]): Promise<StatusReport[]> {
  const validIds = projectIds.filter(isGuid);
  if (validIds.length === 0) return [];
  const projectFilter = validIds.map((id) => `_pmo_project_value eq ${id}`).join(' or ');
  const rows = await dv.list<PmoStatusReportRow>(SET, {
    $select: ['pmo_projectstatusreportid', '_pmo_project_value', 'pmo_reportingdate', 'createdon', 'pmo_name'],
    $filter: `(${projectFilter}) and statecode eq 0`,
    $orderby: 'createdon desc',
    $top: Math.max(validIds.length * 3, 30),
  });
  return rows.map(normalizeCustomStatusReport);
}

export async function getCustomStatusReport(id: string): Promise<StatusReport> {
  const row = await dv.get<PmoStatusReportRow>(SET, id, BASE_SELECT);
  return normalizeCustomStatusReport(row);
}

/** Map the msdyn/proj-shaped payload the dialog produces to the pmo_* columns. */
function toPmoStatusPayload(p: StatusReportPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.msdyn_name !== undefined) out.pmo_name = p.msdyn_name;
  if (p.msdyn_accomplishedactivities !== undefined) out.pmo_accomplishedactivities = p.msdyn_accomplishedactivities;
  if (p.msdyn_plannedactivities !== undefined) out.pmo_plannedactivities = p.msdyn_plannedactivities;
  if (p.msdyn_additionalcomments !== undefined) out.pmo_additionalcomments = p.msdyn_additionalcomments;
  // pmo_reportingdate is Edm.Date — send bare YYYY-MM-DD (a full ISO is rejected).
  if (p.proj_reportingdate !== undefined) {
    out.pmo_reportingdate = p.proj_reportingdate === null ? null : toEdmDate(p.proj_reportingdate);
  }
  return out;
}

export async function createCustomStatusReport(projectId: string, payload: StatusReportCreate): Promise<StatusReport> {
  const body = toPmoStatusPayload(payload);
  body['pmo_Project@odata.bind'] = `/pmo_projects(${projectId})`;
  // Carry the submitter stamp — same /systemusers(id) target, pmo_ nav property.
  const submitter = payload['proj_Submitter@odata.bind'];
  if (submitter) body['pmo_Submitter@odata.bind'] = submitter;
  const created = await dv.create<PmoStatusReportRow>(SET, body);
  void touchCustomProject(projectId);
  return normalizeCustomStatusReport(created);
}

export async function updateCustomStatusReport(id: string, payload: StatusReportPayload): Promise<void> {
  await dv.update(SET, id, toPmoStatusPayload(payload));
  void touchProjectFromChild(SET, id, '_pmo_project_value');
}

/** Soft-delete (statecode=1), matching the msdyn deactivate path. */
export async function deleteCustomStatusReport(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, '_pmo_project_value');
  await dv.deactivate(SET, id);
}
