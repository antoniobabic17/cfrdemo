import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectSprint } from '../models/projectSprint.model';

export async function listSprintsForProject(projectId: string): Promise<ProjectSprint[]> {
  return dv.list<ProjectSprint>(ENTITY_SETS.projectSprint, {
    $filter: `_msdyn_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'msdyn_start asc',
  });
}
