/**
 * msdyn_projectteam — P4W native resource records (people assigned to the project).
 * Entity set: msdyn_projectteams  (NOT pmo_projectteams — that's the CFR org-team junction).
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectTeamMember } from '../models/projectTeamMember.model';

const SET = ENTITY_SETS.projectTeamMember;

const BASE_SELECT: string[] = [
  'msdyn_projectteamid',
  'msdyn_name',
  'msdyn_effort',
  'msdyn_effortcompleted',
  'msdyn_effortremaining',
  'msdyn_hours',
  'msdyn_requiredhours',
  'msdyn_hardbookedhours',
  'msdyn_softbookedhours',
  'msdyn_percentage',
  'msdyn_start',
  'msdyn_finish',
  'msdyn_projectapprover',
  'statecode',
  '_msdyn_project_value',
  '_msdyn_bookableresourceid_value',
  '_msdyn_resourcecategory_value',
];

export async function listProjectTeamMembers(projectId: string): Promise<ProjectTeamMember[]> {
  return dv.list<ProjectTeamMember>(SET, {
    $select: BASE_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: '_msdyn_bookableresourceid_value asc',
  });
}
