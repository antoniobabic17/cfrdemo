import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectCollaborator, ProjectCollaboratorCreate } from '../models/projectCollaborator.model';
import { projectBind, projectMatch } from '../lib/projectLookupRef';
import type { DataSource } from '../lib/taskSource';

const SET = ENTITY_SETS.projectCollaborator;

// NOTE: @OData.Community.Display.V1.FormattedValue annotation fields must NOT
// be included in $select — Dataverse appends them automatically for lookup
// fields in the response; requesting them explicitly causes a 400 error.
const BASE_SELECT: string[] = [
  'pmo_projectcollaboratorid',
  'pmo_name',
  'statecode',
  'createdon',
  '_pmo_project_value',
  '_pmo_projectref_value',
  '_pmo_user_value',
  '_pmo_viateam_value',
];

export async function listProjectCollaborators(projectId: string): Promise<ProjectCollaborator[]> {
  return dv.list<ProjectCollaborator>(SET, {
    $select: BASE_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'createdon asc',
  });
}

export async function createProjectCollaborator(
  projectId: string,
  userId: string,
  viaTeamId: string | null,
  dataSource: DataSource,
): Promise<ProjectCollaborator> {
  const payload: ProjectCollaboratorCreate = {
    ...projectBind(projectId, dataSource),
    'pmo_User@odata.bind': `/systemusers(${userId})`,
    ...(viaTeamId ? { 'pmo_ViaTeam@odata.bind': `/teams(${viaTeamId})` } : {}),
  };
  return dv.create<ProjectCollaborator>(SET, payload as Record<string, unknown>);
}

export async function removeProjectCollaborator(collaboratorId: string): Promise<void> {
  // Soft-delete via statecode deactivate, matching the pattern used for other CFR tables.
  await dv.update(SET, collaboratorId, { statecode: 1, statuscode: 2 });
}
