/** pmo_projectrequest — Universal intake/request table */
export interface ProjectRequest {
  pmo_projectrequestid: string;
  pmo_name: string;
  pmo_autonumber?: string;                  // REQ-YYYY-NNNN (read-only)
  pmo_description?: string;
  pmo_businessjustification?: string;
  pmo_requesttype?: number;                 // Choice: REQUEST_TYPE
  'pmo_requesttype@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_priority?: number;                    // Choice: REQUEST_PRIORITY
  'pmo_priority@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_status?: number;                      // Choice: REQUEST_STATUS
  'pmo_status@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_sourcesystem?: number;                // Choice: SOURCE_SYSTEM
  'pmo_sourcesystem@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_requestedstartdate?: string;
  pmo_targetcompletiondate?: string;
  pmo_estimatedbudget?: number;
  pmo_forecastedlaborhours?: number;
  // Labor vs Financial tracking (RESOURCE_METRIC_TYPE). Null treated as Labor.
  pmo_resourcemetrictype?: number;
  'pmo_resourcemetrictype@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_triagecomments?: string;
  pmo_rejectionreason?: string;
  pmo_converteddate?: string;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;

  // System fields
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: systemuser (requested by)
  '_pmo_requestedby_value'?: string;
  '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: team (target team)
  '_pmo_targetteam_value'?: string;
  '_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: msdyn_project (set on conversion)
  '_pmo_convertedproject_value'?: string;
  '_pmo_convertedproject_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_convertedprojectref_value'?: string;
  '_pmo_convertedprojectref_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: systemuser (approved by)
  '_pmo_approvedby_value'?: string;
  '_pmo_approvedby_value@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Phase 1 intake enrichment fields ──────────────────────────────────────
  pmo_submissiontext?: string;
  pmo_routingconfidence?: number;
  pmo_routingrecommendation?: string;
  pmo_extractedfieldsjson?: string;
  pmo_clarificationstate?: number;
  'pmo_clarificationstate@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_clarificationquestion?: string;
  pmo_clarificationresponse?: string;
  pmo_outcomecategory?: number;
  'pmo_outcomecategory@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_lineofbusiness?: number;
  'pmo_lineofbusiness@OData.Community.Display.V1.FormattedValue'?: string;

  // Affected Systems — standardized multi-select Choice (pmo_affectedsystems).
  // Round-trips as a comma-joined string of option values; FormattedValue gives
  // the comma-joined labels. Replaces the legacy single cr87a_System lookup below.
  pmo_affectedsystems?: string;
  'pmo_affectedsystems@OData.Community.Display.V1.FormattedValue'?: string;

  // LEGACY lookup: cr87a_System. Retained read-only for back-compat display of
  // pre-migration rows; no longer written by the app.
  '_pmo_affectedsystem_value'?: string;
  '_pmo_affectedsystem_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: pmo_projectrequest (self-referential — duplicate / related request)
  '_pmo_parentrequest_value'?: string;
  '_pmo_parentrequest_value@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Governed intake workflow fields ───────────────────────────────────────
  '_pmo_intakeworkflowid_value'?: string;
  '_pmo_intakeworkflowid_value@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_currentstagenumber?: number;
  pmo_stagedatajson?: string;
  pmo_stageartifactsjson?: string;
  pmo_approvalchain?: string;
  pmo_conversiontarget?: number;
  'pmo_conversiontarget@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: msdyn_projectprogram (set on program conversion)
  '_pmo_convertedprogram_value'?: string;
  '_pmo_convertedprogram_value@OData.Community.Display.V1.FormattedValue'?: string;
}

/** Payload for creating a new intake request */
export type ProjectRequestCreate = Pick<
  ProjectRequest,
  | 'pmo_name'
  | 'pmo_description'
  | 'pmo_businessjustification'
  | 'pmo_requesttype'
  | 'pmo_priority'
  | 'pmo_requestedstartdate'
  | 'pmo_targetcompletiondate'
  | 'pmo_estimatedbudget'
  | 'pmo_forecastedlaborhours'
  | 'pmo_resourcemetrictype'
  | 'pmo_submissiontext'
  | 'pmo_routingconfidence'
  | 'pmo_routingrecommendation'
  | 'pmo_extractedfieldsjson'
  | 'pmo_lineofbusiness'
  | 'pmo_currentstagenumber'
  | 'pmo_stagedatajson'
  | 'pmo_stageartifactsjson'
  | 'pmo_approvalchain'
  | 'pmo_conversiontarget'
  | 'pmo_sourcesystem'
  | 'pmo_affectedsystems'
> & {
  'pmo_RequestedBy@odata.bind'?: string;
  'pmo_TargetTeam@odata.bind'?: string;
  'pmo_IntakeWorkflowId@odata.bind'?: string;
};

/** Payload for updating an intake request (all fields optional) */
export type ProjectRequestUpdate = Partial<
  Pick<
    ProjectRequest,
    | 'pmo_name'
    | 'pmo_description'
    | 'pmo_businessjustification'
    | 'pmo_requesttype'
    | 'pmo_priority'
    | 'pmo_status'
    | 'pmo_requestedstartdate'
    | 'pmo_targetcompletiondate'
    | 'pmo_estimatedbudget'
    | 'pmo_forecastedlaborhours'
    | 'pmo_resourcemetrictype'
    | 'pmo_triagecomments'
    | 'pmo_rejectionreason'
    | 'pmo_routingconfidence'
    | 'pmo_routingrecommendation'
    | 'pmo_extractedfieldsjson'
    | 'pmo_clarificationstate'
    | 'pmo_clarificationquestion'
    | 'pmo_clarificationresponse'
    | 'pmo_outcomecategory'
    | 'pmo_lineofbusiness'
    | 'pmo_currentstagenumber'
    | 'pmo_stagedatajson'
    | 'pmo_stageartifactsjson'
    | 'pmo_approvalchain'
    | 'pmo_conversiontarget'
    | 'pmo_affectedsystems'
  >
> & {
  'pmo_TargetTeam@odata.bind'?: string;
  'pmo_ApprovedBy@odata.bind'?: string;
  'pmo_ConvertedProject@odata.bind'?: string;
  'pmo_ConvertedProjectRef@odata.bind'?: string;
  'pmo_ConvertedProgram@odata.bind'?: string;
  'pmo_ParentRequest@odata.bind'?: string;
  'pmo_IntakeWorkflowId@odata.bind'?: string;
};
