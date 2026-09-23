import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { discoverNavProp } from '../lib/navPropDiscovery';
import type { ProjectIssue } from '../models/projectIssue.model';

const SET = ENTITY_SETS.projectIssue;

const BASE_SELECT: string[] = [
  'msdyn_projectissueid',
  'msdyn_name',
  'msdyn_description',
  'msdyn_resolution',
  'proj_duedate',
  'proj_issuecategory',
  'proj_priority',
  'proj_state',
  'statecode',
  'createdon',
  '_msdyn_project_value',
  '_proj_assignedto_value',
  '_proj_requestor_value',
];

export interface ProjectIssuePayload {
  msdyn_name: string;
  msdyn_description?: string;
  msdyn_resolution?: string;
  proj_duedate?: string | null;
  proj_issuecategory?: number | null;
  proj_priority?: number | null;
  proj_state?: number | null;
  /** Lookup to systemusers - bind value like '/systemusers(<guid>)' or null to clear. */
  'proj_AssignedTo@odata.bind'?: string | null;
}

export interface ProjectIssueCreate extends ProjectIssuePayload {
  'msdyn_project@odata.bind': string; // '/msdyn_projects(id)'
}

function shortId(): string {
  // 8-char hex — short enough to stay well inside Dataverse's 100-char msdyn_name limit
  return Math.random().toString(16).slice(2, 10);
}

export async function listProjectIssues(projectId: string): Promise<ProjectIssue[]> {
  return dv.list<ProjectIssue>(SET, {
    $select: BASE_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function createProjectIssue(payload: ProjectIssueCreate): Promise<ProjectIssue> {
  const navProp = await discoverNavProp('msdyn_projectissue', 'msdyn_project', 'msdyn_project');
  const { 'msdyn_project@odata.bind': projectBind, ...rest } = payload;

  const resolved: Record<string, unknown> = {
    ...rest,
    // Auto-generate a globally unique msdyn_name so same-title issues can coexist across the org.
    msdyn_name: `ISSUE-${shortId()}`,
  };
  if (projectBind) resolved[`${navProp}@odata.bind`] = projectBind;
  return dv.create<ProjectIssue>(SET, resolved);
}

export async function updateProjectIssue(id: string, payload: ProjectIssuePayload): Promise<void> {
  // Never send msdyn_name on updates — it's the system key and must not change.
  return dv.update(SET, id, payload);
}

export async function deleteProjectIssue(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
