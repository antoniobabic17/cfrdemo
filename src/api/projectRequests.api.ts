import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, REQUEST_STATUS, CLARIFICATION_STATE } from '../lib/constants';
import type { ProjectRequest, ProjectRequestCreate, ProjectRequestUpdate } from '../models/projectRequest.model';
import type { ODataParams } from '../models/common.model';

const SET = ENTITY_SETS.projectRequest;

const BASE_SELECT: string[] = [
  'pmo_projectrequestid',
  'pmo_name',
  'pmo_autonumber',
  'pmo_requesttype',
  'pmo_priority',
  'pmo_status',
  'pmo_requestedstartdate',
  'pmo_targetcompletiondate',
  'pmo_estimatedbudget',
  // New Resource Model: needed so conversion carries these onto the project
  // and IntakeDetailPage can display the labor-vs-financial field. Without
  // them the read is undefined and forecasted hours never propagate.
  'pmo_forecastedlaborhours',
  'pmo_resourcemetrictype',
  'pmo_sourcesystem',
  'pmo_converteddate',
  'pmo_routingconfidence',
  'pmo_lineofbusiness',
  'pmo_currentstagenumber',
  'pmo_conversiontarget',
  'statecode',
  'createdon',
  'modifiedon',
  '_createdby_value',
  '_pmo_requestedby_value',
  '_pmo_targetteam_value',
  '_pmo_convertedproject_value',
  '_pmo_convertedprojectref_value',
  '_pmo_convertedprogram_value',
  'pmo_affectedsystems',
  '_pmo_affectedsystem_value',
  '_pmo_parentrequest_value',
  '_pmo_intakeworkflowid_value',
];

export async function listProjectRequests(params?: ODataParams): Promise<ProjectRequest[]> {
  return dv.list<ProjectRequest>(SET, {
    $select: BASE_SELECT,
    $orderby: 'createdon desc',
    ...params,
  });
}

export async function getProjectRequest(id: string): Promise<ProjectRequest> {
  return dv.get<ProjectRequest>(SET, id, [
    ...BASE_SELECT,
    'pmo_description',
    'pmo_businessjustification',
    'pmo_triagecomments',
    'pmo_rejectionreason',
    'pmo_submissiontext',
    'pmo_routingrecommendation',
    'pmo_extractedfieldsjson',
    'pmo_clarificationstate',
    'pmo_clarificationquestion',
    'pmo_clarificationresponse',
    'pmo_outcomecategory',
    '_pmo_approvedby_value',
    'pmo_stagedatajson',
    'pmo_stageartifactsjson',
    'pmo_approvalchain',
    // _pmo_hpiissue_value omitted: column not yet present on
    // pmo_projectrequest in PROD. Re-add once the HPI lookup column is
    // deployed to prod (see docs/planning/old-project-migration.md).
  ]);
}

export async function createProjectRequest(payload: ProjectRequestCreate): Promise<ProjectRequest> {
  return dv.create<ProjectRequest>(SET, {
    ...payload,
    pmo_status: REQUEST_STATUS.Draft,
  });
}

export async function updateProjectRequest(id: string, payload: ProjectRequestUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

/**
 * Hard-delete a draft project request. Caller must enforce business rules
 * (only the creator may delete, only while status is Draft) — this helper
 * does not re-check them.
 */
export async function deleteProjectRequest(id: string): Promise<void> {
  return dv.remove(SET, id);
}

export async function submitRequest(id: string): Promise<void> {
  return dv.update(SET, id, { pmo_status: REQUEST_STATUS.Submitted });
}

export async function approveRequest(id: string): Promise<void> {
  // pmo_approvedby is set by the pmo_CFR_IntakeToProject flow using the modifiedby context.
  return dv.update(SET, id, { pmo_status: REQUEST_STATUS.Approved });
}

export async function rejectRequest(id: string, rejectionReason: string): Promise<void> {
  return dv.update(SET, id, {
    pmo_status: REQUEST_STATUS.Rejected,
    pmo_rejectionreason: rejectionReason,
  });
}

// Requester-initiated withdrawal of their OWN request. Kept as a SEPARATE fn
// from rejectRequest even though both set a rose "declined" status + reason:
// cancel is the requester's outcome, reject is the assigned team's. Distinct
// exports keep the two processes independently traceable/auditable.
export async function cancelRequest(id: string, cancellationReason: string): Promise<void> {
  return dv.update(SET, id, {
    pmo_status: REQUEST_STATUS.Cancelled,
    pmo_rejectionreason: cancellationReason,
  });
}

export async function moveToTriage(id: string): Promise<void> {
  return dv.update(SET, id, { pmo_status: REQUEST_STATUS.InTriage });
}

export async function routeOperational(id: string, teamId?: string): Promise<void> {
  const payload: ProjectRequestUpdate = { pmo_status: REQUEST_STATUS.RoutedOperational };
  if (teamId) payload['pmo_TargetTeam@odata.bind'] = `/teams(${teamId})`;
  return dv.update(SET, id, payload);
}

export async function redirectRequest(id: string, triageComments: string): Promise<void> {
  return dv.update(SET, id, {
    pmo_status: REQUEST_STATUS.Redirected,
    pmo_triagecomments: triageComments,
  });
}

export async function requestClarification(id: string, question: string): Promise<void> {
  return dv.update(SET, id, {
    pmo_status: REQUEST_STATUS.AwaitingClarification,
    pmo_clarificationstate: CLARIFICATION_STATE.PendingRequester,
    pmo_clarificationquestion: question,
    // Clear the prior response so the banner shows only the *current* question
    // until the requester answers. Historical Q/A pairs remain available in
    // pmo_approvalchain for the Clarification History accordion.
    pmo_clarificationresponse: null,
  });
}

export async function resolveClarification(
  id: string,
  response: string,
  approvalChainJson?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    pmo_clarificationresponse: response,
    pmo_clarificationstate: CLARIFICATION_STATE.Resolved,
    pmo_status: REQUEST_STATUS.InTriage,
  };
  if (approvalChainJson) payload.pmo_approvalchain = approvalChainJson;
  return dv.update(SET, id, payload);
}

export async function linkParentRequest(id: string, parentRequestId: string): Promise<void> {
  return dv.update(SET, id, {
    'pmo_ParentRequest@odata.bind': `/pmo_projectrequests(${parentRequestId})`,
  });
}
