import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectLabel } from '../models/projectLabel.model';
import type { ProjectTaskToLabel } from '../models/projectLabel.model';

const LABEL_SELECT: string[] = [
  'msdyn_projectlabelid',
  'msdyn_projectlabeltext',
  'msdyn_colorindex',
  '_msdyn_projectid_value',
  'statecode',
];

const TASK_LABEL_SELECT: string[] = [
  'msdyn_projecttasktolabelid',
  'msdyn_name',
  '_msdyn_projectlabelid_value',
  '_msdyn_projecttaskid_value',
  'statecode',
];

export async function listLabelsForProject(projectId: string): Promise<ProjectLabel[]> {
  return dv.list<ProjectLabel>(ENTITY_SETS.projectLabel, {
    $select: LABEL_SELECT,
    $filter: `_msdyn_projectid_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'msdyn_colorindex asc',
  });
}

export async function listTaskLabels(_projectId: string): Promise<ProjectTaskToLabel[]> {
  return dv.list<ProjectTaskToLabel>(ENTITY_SETS.projectTaskToLabel, {
    $select: TASK_LABEL_SELECT,
    $filter: `statecode eq 0`,
    $top: 5000,
  });
}
