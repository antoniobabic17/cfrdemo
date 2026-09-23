import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ResourceAssignment } from '../models/resourceAssignment.model';

const BASE_SELECT: string[] = [
  'msdyn_resourceassignmentid',
  '_msdyn_taskid_value',
  '_msdyn_projectteamid_value',
  '_msdyn_projectid_value',
  'msdyn_name',
  'statecode',
];

export async function listResourceAssignments(projectId: string): Promise<ResourceAssignment[]> {
  return dv.list<ResourceAssignment>(ENTITY_SETS.resourceAssignment, {
    $select: BASE_SELECT,
    $filter: `_msdyn_projectid_value eq '${projectId}' and statecode eq 0`,
    $top: 1000,
  });
}
