import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectChecklist } from '../models/projectChecklist.model';

const SET = ENTITY_SETS.projectChecklist;

const SELECT: string[] = [
  'msdyn_projectchecklistid',
  'msdyn_name',
  'msdyn_projectchecklistcompleted',
  'msdyn_projectchecklistorder',
  '_msdyn_projecttaskid_value',
  'statecode',
  'createdon',
];

export async function listChecklistsForTask(taskId: string): Promise<ProjectChecklist[]> {
  return dv.list<ProjectChecklist>(SET, {
    $select: SELECT,
    $filter: `_msdyn_projecttaskid_value eq '${taskId}' and statecode eq 0`,
    $orderby: 'msdyn_projectchecklistorder asc',
  });
}
