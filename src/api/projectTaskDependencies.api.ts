import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectTaskDependency } from '../models/projectTaskDependency.model';

const DEP_SELECT = [
  'msdyn_projecttaskdependencyid',
  'msdyn_linktype',
  '_msdyn_successortask_value',
  '_msdyn_predecessortask_value',
  '_msdyn_project_value',
];

export async function listProjectTaskDependencies(projectId: string): Promise<ProjectTaskDependency[]> {
  return dv.list<ProjectTaskDependency>(ENTITY_SETS.projectTaskDependency, {
    $select: DEP_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}'`,
  });
}
