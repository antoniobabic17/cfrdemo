/**
 * UAT requirement service.
 *
 * Project filtering goes through lib/projectLookupRef.ts's projectMatch, which matches
 * EITHER half of the dual project reference. Filtering on _pmo_project_value alone
 * would silently return nothing for custom-source projects, which have no
 * msdyn_project row at all — see progress.md finding 15.
 */
import * as dv from '../lib/dataverseClient';
import { projectMatch } from '../lib/projectLookupRef';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import type { ODataParams } from '../models/common.model';
import type {
  UatRequirement,
  UatRequirementCreate,
  UatRequirementUpdate,
} from '../models/uatRequirement.model';

const SET = UAT_ENTITY_SETS.requirement;

const LIST_SELECT: string[] = [
  'pmo_uatrequirementid',
  'pmo_name',
  'pmo_title',
  'pmo_type',
  'pmo_status',
  'pmo_priority',
  'pmo_rank',
  'pmo_storypoints',
  '_pmo_parent_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'pmo_externalsystem',
  'pmo_externalkey',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

// pmo_description (rich text) and pmo_acceptancecriteria are the narrative columns.
const DETAIL_SELECT: string[] = [
  ...LIST_SELECT,
  'pmo_description',
  'pmo_acceptancecriteria',
  'pmo_externalid',
  'pmo_externalurl',
  'pmo_externalstatus',
  'pmo_externalsyncedon',
];

export async function listUatRequirements(params?: ODataParams): Promise<UatRequirement[]> {
  return dv.list<UatRequirement>(SET, {
    $select: LIST_SELECT,
    $orderby: 'pmo_rank asc',
    ...params,
  });
}

/** Every requirement on one project, ordered for a backlog view. */
export async function listUatRequirementsByProject(projectId: string): Promise<UatRequirement[]> {
  return dv.list<UatRequirement>(SET, {
    $select: LIST_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_rank asc',
  });
}

/** Direct children of one requirement — the epic to story hop. */
export async function listUatRequirementChildren(parentId: string): Promise<UatRequirement[]> {
  return dv.list<UatRequirement>(SET, {
    $select: LIST_SELECT,
    $filter: `_pmo_parent_value eq '${parentId}' and statecode eq 0`,
    $orderby: 'pmo_rank asc',
  });
}

export async function getUatRequirement(id: string): Promise<UatRequirement> {
  return dv.get<UatRequirement>(SET, id, DETAIL_SELECT);
}

export async function createUatRequirement(payload: UatRequirementCreate): Promise<UatRequirement> {
  // pmo_name is an autonumber. Sending it would either be rejected or overwrite the
  // platform's sequence, so it is absent from the Create type by design.
  return dv.create<UatRequirement>(SET, payload);
}

export async function updateUatRequirement(id: string, payload: UatRequirementUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function deleteUatRequirement(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
