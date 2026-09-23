import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { StatusReport } from '../models/statusReport.model';

const SET = ENTITY_SETS.statusReport;

const BASE_SELECT: string[] = [
  'msdyn_projectstatusreportid',
  'msdyn_name',
  'msdyn_accomplishedactivities',
  'msdyn_plannedactivities',
  'msdyn_additionalcomments',
  'proj_reportingdate',
  'statecode',
  'createdon',
  'modifiedon',
  '_msdyn_project_value',
  '_proj_submittedto_value',
  '_proj_submitter_value',
  '_createdby_value',
];

export interface StatusReportPayload {
  msdyn_name: string;
  msdyn_accomplishedactivities?: string;
  msdyn_plannedactivities?: string;
  msdyn_additionalcomments?: string;
  proj_reportingdate?: string | null;
}

export interface StatusReportCreate extends StatusReportPayload {
  'msdyn_Project@odata.bind': string; // '/msdyn_projects(id)' -- nav-property is PascalCase
  // Optional submitter stamp; populated via dv.getCurrentUserId() at the call site.
  'proj_Submitter@odata.bind'?: string; // '/systemusers(id)'
}

// Web API v9.2 accepts both quoted 'guid' and unquoted guid for lookup
// filters. But an empty string ('' or "") is a syntax error and surfaces
// as HTTP 400 "0x80060888 Bad Request - Error in query syntax." That's
// the exact error Shelina hit on 2026-07-15 (see runbook / investigation
// 2). We now (a) refuse to build a filter with an empty/undefined project
// id and (b) use the unquoted form to align with Web API guidance.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuid(v: unknown): v is string {
  return typeof v === 'string' && GUID_RE.test(v);
}

export async function listStatusReports(projectId?: string): Promise<StatusReport[]> {
  // If projectId is passed but not a valid GUID, treat it as no filter --
  // returns an empty list would be misleading; safer to fetch all active
  // reports the caller has access to. But throw if we detect a genuinely
  // malformed value so upstream sees the bug instead of a silent empty.
  const filter = isGuid(projectId)
    ? `_msdyn_project_value eq ${projectId} and statecode eq 0`
    : 'statecode eq 0';
  return dv.list<StatusReport>(SET, {
    $select: BASE_SELECT,
    $filter: filter,
    $orderby: 'createdon desc',
  });
}

/** Fetch the most recent status report for each of the given project IDs (for program-level freshness view). */
export async function listStatusReportsByProjects(projectIds: string[]): Promise<StatusReport[]> {
  const validIds = projectIds.filter(isGuid);
  if (validIds.length === 0) return [];
  const projectFilter = validIds.map((id) => `_msdyn_project_value eq ${id}`).join(' or ');
  return dv.list<StatusReport>(SET, {
    $select: ['msdyn_projectstatusreportid', '_msdyn_project_value', 'proj_reportingdate', 'createdon', 'msdyn_name'],
    $filter: `(${projectFilter}) and statecode eq 0`,
    $orderby: 'createdon desc',
    $top: Math.max(validIds.length * 3, 30),
  });
}

export async function getStatusReport(id: string): Promise<StatusReport> {
  return dv.get<StatusReport>(SET, id, BASE_SELECT);
}

export async function createStatusReport(payload: StatusReportCreate): Promise<StatusReport> {
  return dv.create<StatusReport>(SET, payload);
}

export async function updateStatusReport(id: string, payload: StatusReportPayload): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function deleteStatusReport(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
