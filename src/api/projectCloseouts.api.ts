import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE, projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectCloseout, ProjectCloseoutCreate, ProjectCloseoutUpdate } from '../models/projectCloseout.model';

const SET = ENTITY_SETS.projectCloseout;

const FIELDS: string[] = [
  'pmo_projectcloseoutid', 'pmo_name', 'pmo_checklistitem',
  'pmo_iscomplete', 'pmo_completeddate', 'pmo_notes',
  'pmo_lessonslearned', 'pmo_outcomesummary',
  'statecode', 'createdon', '_pmo_completedby_value',
  ...PROJECT_VALUE_SELECT,
];

export async function listProjectCloseouts(projectId: string): Promise<ProjectCloseout[]> {
  return dv.list<ProjectCloseout>(SET, {
    $select: FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'createdon asc',
  });
}

export async function createProjectCloseout(payload: ProjectCloseoutCreate): Promise<ProjectCloseout> {
  void touchCustomProject(projectIdFromBindPayload(payload as unknown as Record<string, unknown>) ?? '');
  return dv.create<ProjectCloseout>(SET, payload);
}

export async function updateProjectCloseout(id: string, payload: ProjectCloseoutUpdate): Promise<void> {
  await dv.update(SET, id, payload);
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
}

export async function deactivateProjectCloseout(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
  await dv.deactivate(SET, id);
}
