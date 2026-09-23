import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE, projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { RequiredArtifact, RequiredArtifactCreate, ProjectArtifactStatus, ProjectArtifactStatusCreate, ProjectArtifactStatusUpdate } from '../models/requiredArtifact.model';

const ART_SET = ENTITY_SETS.requiredArtifact;
const STATUS_SET = ENTITY_SETS.projectArtifactStatus;

const ART_FIELDS: (keyof RequiredArtifact)[] = [
  'pmo_requiredartifactid', 'pmo_name', 'pmo_artifacttype',
  'pmo_cfrcategory', 'pmo_isrequired', 'pmo_description', 'statecode',
];

const STATUS_FIELDS: string[] = [
  'pmo_projectartifactstatusid', 'pmo_name', 'pmo_status',
  'pmo_completeddate', 'pmo_notes', 'statecode',
  '_pmo_requiredartifact_value', '_pmo_documentlink_value',
  ...PROJECT_VALUE_SELECT,
];

export async function listRequiredArtifacts(): Promise<RequiredArtifact[]> {
  return dv.list<RequiredArtifact>(ART_SET, {
    $select: ART_FIELDS,
    $filter: 'statecode eq 0',
    $orderby: 'pmo_name asc',
  });
}

export async function createRequiredArtifact(payload: RequiredArtifactCreate): Promise<RequiredArtifact> {
  return dv.create<RequiredArtifact>(ART_SET, payload);
}

export async function updateRequiredArtifact(id: string, payload: Partial<RequiredArtifactCreate>): Promise<void> {
  return dv.update(ART_SET, id, payload);
}

export async function deactivateRequiredArtifact(id: string): Promise<void> {
  return dv.deactivate(ART_SET, id);
}

export async function countProjectsUsingArtifact(artifactId: string): Promise<number> {
  const statuses = await dv.list<{ pmo_projectartifactstatusid: string }>(STATUS_SET, {
    $select: ['pmo_projectartifactstatusid'],
    $filter: `_pmo_requiredartifact_value eq '${artifactId}' and statecode eq 0`,
  });
  return statuses.length;
}

export async function listProjectArtifactStatuses(projectId: string): Promise<ProjectArtifactStatus[]> {
  return dv.list<ProjectArtifactStatus>(STATUS_SET, {
    $select: STATUS_FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
  });
}

export async function createProjectArtifactStatus(payload: ProjectArtifactStatusCreate): Promise<ProjectArtifactStatus> {
  const created = await dv.create<ProjectArtifactStatus>(STATUS_SET, payload);
  void touchCustomProject(projectIdFromBindPayload(payload as unknown as Record<string, unknown>) ?? '');
  return created;
}

export async function updateProjectArtifactStatus(id: string, payload: ProjectArtifactStatusUpdate): Promise<void> {
  await dv.update(STATUS_SET, id, payload);
  void touchProjectFromChild(STATUS_SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
}
