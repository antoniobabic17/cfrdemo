import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { discoverNavProp } from '../lib/navPropDiscovery';
import type { ProjectRisk } from '../models/projectRisk.model';

const SET = ENTITY_SETS.projectRisk;

const BASE_SELECT: string[] = [
  'msdyn_projectriskid',
  'msdyn_name',
  'msdyn_subject',
  'msdyn_description',
  'msdyn_contingencyplan',
  'msdyn_mitigationplan',
  'proj_impact',
  'proj_probability',
  'proj_exposure',
  'proj_cost',
  'proj_costexposure',
  'proj_due',
  'proj_category',
  'proj_state',
  'statecode',
  'createdon',
  '_msdyn_project_value',
  '_proj_assignedto_value',
];

export interface ProjectRiskPayload {
  // msdyn_subject carries the user-visible name.
  // msdyn_name is the system-unique identifier and is NOT updated after creation.
  msdyn_subject?: string;
  msdyn_description?: string;
  msdyn_contingencyplan?: string;
  msdyn_mitigationplan?: string;
  proj_impact?: number | null;
  proj_probability?: number | null;
  proj_category?: number | null;
  proj_state?: number | null;
  proj_due?: string | null;
  proj_cost?: number | null;
  /** Lookup to systemusers - bind value like '/systemusers(<guid>)' or null to clear. */
  'proj_AssignedTo@odata.bind'?: string | null;
}

export interface ProjectRiskCreate extends ProjectRiskPayload {
  msdyn_subject: string;
  'msdyn_project@odata.bind': string; // '/msdyn_projects(id)'
}

function shortId(): string {
  // 8-char hex — short enough to stay well inside Dataverse's 100-char msdyn_name limit
  return Math.random().toString(16).slice(2, 10);
}

export async function listProjectRisks(projectId: string): Promise<ProjectRisk[]> {
  return dv.list<ProjectRisk>(SET, {
    $select: BASE_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function createProjectRisk(payload: ProjectRiskCreate): Promise<ProjectRisk> {
  const navProp = await discoverNavProp('msdyn_projectrisk', 'msdyn_project', 'msdyn_project');
  const { 'msdyn_project@odata.bind': projectBind, ...rest } = payload;

  const resolved: Record<string, unknown> = {
    ...rest,
    // Auto-generate a globally unique msdyn_name so same-subject risks can coexist across the org.
    // msdyn_subject holds the user-visible title and is never subject to the uniqueness constraint.
    msdyn_name: `RISK-${shortId()}`,
  };
  if (projectBind) resolved[`${navProp}@odata.bind`] = projectBind;
  return dv.create<ProjectRisk>(SET, resolved);
}

export async function updateProjectRisk(id: string, payload: ProjectRiskPayload): Promise<void> {
  // Never send msdyn_name on updates — it's the system key and must not change.
  return dv.update(SET, id, payload);
}

export async function deleteProjectRisk(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
