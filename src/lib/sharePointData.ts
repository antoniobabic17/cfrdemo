/**
 * SharePoint general-data backend registry.
 *
 * When `pmo.data_source = 'sharepoint'`, every custom `pmo_*` entity set in this
 * registry is backed by a SharePoint list instead of Dataverse OData. The registry
 * is the SINGLE SOURCE OF TRUTH for:
 *   1. Which entity sets are SP-backed vs. must stay on Dataverse.
 *   2. The column schema used at runtime (row translation) and by the seeding
 *      script (scripts/seed-sharepoint-data-lists.py) to create the SP lists.
 *
 * Column type mapping (flat, no SP Lookup columns):
 *   Choices / option-sets  → 'Text'   (stored as the integer code, as text)
 *   Lookup GUIDs (_*_value) → 'Text'   (plain GUID string, isLookupGuid: true)
 *   @odata.bind             → strip on write → bare _*_value 'Text' column
 *   Long text / HTML        → 'Note'   (SP multi-line text)
 *   Money / decimal         → 'Number' (Currency columns not used — simpler)
 *   Integer                 → 'Number'
 *   Boolean                 → 'Boolean'
 *   DateTime / Edm.DateTimeOffset → 'DateTime'
 *   Edm.Date                → 'Text'   (stored as YYYY-MM-DD string)
 *   statecode / statuscode  → 'Number'
 *
 * Cross-record joins are GUID-based in SP exactly as they are in Dataverse
 * (the app already reads `_pmo_*_value` as a plain GUID string on the custom path).
 *
 * Non-SP-backed sets (always Dataverse):
 *   pmo_appsettings   — bootstrap; the flag itself lives here (circular dep)
 *   pmo_taskstagings  — PSS staging, always Dataverse
 *   annotations       — Dataverse annotations / file attachments
 *   systemusers, teams, roles, organizations
 *   msdyn_*           — PSS tables, never SP-backed
 *   cr87a_*, rcm_*    — tenant-specific tables not in the custom-table model
 *   pmo_telemetryevents — write-only telemetry; no SP benefit
 */

import { getCachedDataSource } from './taskSource';

// ─── Type definitions ─────────────────────────────────────────────────────────

export type SpFieldType = 'Text' | 'Note' | 'Number' | 'Currency' | 'DateTime' | 'Boolean';

export interface SpFieldDef {
  /** Dataverse column logical name — also the SP internal column name. */
  key: string;
  /** Flat SP column type. Choices/lookups degrade to Text; GUIDs are Text. */
  type: SpFieldType;
  /**
   * True for `_pmo_*_value` / `_msdyn_*_value` style lookup columns that
   * are stored as plain GUID strings (no SP Lookup column relationship).
   */
  isLookupGuid?: boolean;
}

export interface SpListDef {
  /** Dataverse entity set name, e.g. 'pmo_projects'. */
  entitySet: string;
  /** Human-readable SP list name, e.g. 'PMO Projects'. */
  listName: string;
  /** Primary key column logical name, e.g. 'pmo_projectid'. */
  primaryKey: string;
  /** All columns the app reads/writes. 'Title' (SP required) maps to the PK. */
  fields: SpFieldDef[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const T = (key: string): SpFieldDef => ({ key, type: 'Text' });
const N = (key: string): SpFieldDef => ({ key, type: 'Number' });
const D = (key: string): SpFieldDef => ({ key, type: 'DateTime' });
const B = (key: string): SpFieldDef => ({ key, type: 'Boolean' });
const M = (key: string): SpFieldDef => ({ key, type: 'Note' });
/** Lookup GUID stored as plain text. */
const L = (key: string): SpFieldDef => ({ key, type: 'Text', isLookupGuid: true });
/** Edm.Date stored as YYYY-MM-DD text. */
const Dt = (key: string): SpFieldDef => ({ key, type: 'Text' });

// Shared statecode/statuscode/createdon/modifiedon present on nearly every entity.
const SYS: SpFieldDef[] = [N('statecode'), N('statuscode'), D('createdon'), D('modifiedon')];
const SYS_NO_MOD: SpFieldDef[] = [N('statecode'), D('createdon')];
// Audit columns — lookup GUIDs to systemusers.
const AUDIT = (): SpFieldDef[] => [L('_createdby_value'), L('_modifiedby_value')];
// Both project-lookup columns (custom + PSS) so cross-source filters work.
const PROJ_LOOKUP: SpFieldDef[] = [L('_pmo_project_value'), L('_pmo_projectref_value')];

// ─── Registry ────────────────────────────────────────────────────────────────

export const SP_LIST_REGISTRY: SpListDef[] = [
  // ── pmo_project ────────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projects',
    listName: 'PMO Projects',
    primaryKey: 'pmo_projectid',
    fields: [
      T('pmo_projectid'), T('pmo_projectnumber'), T('pmo_subject'),
      M('pmo_description'), M('pmo_businesscase'), M('pmo_valuestatement'), M('pmo_comments'),
      Dt('pmo_scheduledstart'), Dt('pmo_finish'), Dt('pmo_scheduledcompletion'), Dt('pmo_actualfinishdate'),
      N('pmo_stage'), N('pmo_state'), N('pmo_priority'), N('pmo_projecttype'),
      N('pmo_businessunit'), N('pmo_fundingsource'),
      B('pmo_fundingavailable'), B('pmo_needsstaffing'),
      N('pmo_overallhealth'), N('pmo_efforthealth'), N('pmo_financialhealth'),
      N('pmo_schedulehealth'), N('pmo_issuehealth'),
      N('pmo_budget'), N('pmo_actualcost'), N('pmo_forecast'), N('pmo_benefits'),
      N('pmo_remainingbudget'), N('pmo_budgetvariance'), N('pmo_roi'),
      N('pmo_prioritizationscore'), N('pmo_strategicalignment'), N('pmo_strategicalignmentscore'),
      B('pmo_improveemployeeretention'), N('pmo_improveemployeeretentionscore'),
      B('pmo_lowercost'), N('pmo_lowercostscore'),
      N('pmo_risk'), N('pmo_riskscore'),
      N('pmo_hoursperday'), N('pmo_hoursperweek'), N('pmo_dayspermonth'),
      N('pmo_cfrcategory'), N('pmo_complexity'), N('pmo_strategicpriority'),
      T('pmo_legacyprojectid'), T('pmo_affectedsystems'),
      M('pmo_executivesummary'), T('pmo_projectstatus'),
      N('pmo_forecastedlaborhours'), N('pmo_currenttotalhours'), N('pmo_currentcompletedhours'),
      B('pmo_usenewresourcemodel'), N('pmo_resourcemetrictype'),
      L('_pmo_projectmanager_value'), L('_pmo_program_value'), L('_pmo_executivesponsor_value'),
      L('_pmo_manager_value'), L('_pmo_primaryteam_value'), L('_pmo_requestsource_value'),
      L('_pmo_payerinitiatives_hpiissue_value'), L('_pmo_payerinitiatives_strategicaccountexecutive_value'),
      T('pmo_payerinitiatives_saeaadobjectid'), T('pmo_payerinitiatives_saedisplayname'),
      T('pmo_payerinitiatives_saeemail'),
      ...AUDIT(), ...SYS,
    ],
  },

  // ── pmo_program ────────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_programs',
    listName: 'PMO Programs',
    primaryKey: 'pmo_programid',
    fields: [
      T('pmo_programid'), T('pmo_programnumber'), T('pmo_name'),
      M('pmo_description'), M('pmo_businesscase'), M('pmo_programgoals'),
      N('pmo_benefit'), N('pmo_budget'), N('pmo_roi'),
      Dt('pmo_programstart'), Dt('pmo_programdue'),
      N('pmo_state'), N('pmo_priority'), N('pmo_programtype'), N('pmo_businessunit'),
      N('pmo_overallhealth'), N('pmo_efforthealth'), N('pmo_financialhealth'), N('pmo_schedulehealth'),
      L('_pmo_manager_value'),
      ...AUDIT(), ...SYS,
    ],
  },

  // ── pmo_task ───────────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_tasks',
    listName: 'PMO Tasks',
    primaryKey: 'pmo_taskid',
    fields: [
      T('pmo_taskid'), T('pmo_tasknumber'), T('pmo_subject'),
      M('pmo_description'),
      Dt('pmo_startdate'), Dt('pmo_duedate'),
      N('pmo_duration'), N('pmo_effort'), N('pmo_effortcompleted'),
      N('pmo_progress'), N('pmo_outlinelevel'), N('pmo_orderinbucket'),
      B('pmo_ismilestone'), B('pmo_ismanuallyscheduled'), B('pmo_iscritical'),
      N('pmo_status'), N('pmo_priority'), N('pmo_priorityvalue'),
      T('pmo_tasklabel'),
      L('_pmo_projectref_value'), L('_pmo_bucket_value'),
      L('_pmo_summarytask_value'), L('_pmo_sprint_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_bucket ─────────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_buckets',
    listName: 'PMO Buckets',
    primaryKey: 'pmo_bucketid',
    fields: [
      T('pmo_bucketid'), T('pmo_name'),
      N('pmo_orderinproject'),
      L('_pmo_projectref_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_taskassignment ─────────────────────────────────────────────────────
  {
    entitySet: 'pmo_taskassignments',
    listName: 'PMO Task Assignments',
    primaryKey: 'pmo_taskassignmentid',
    fields: [
      T('pmo_taskassignmentid'), T('pmo_name'),
      N('pmo_contributedhours'),
      L('_pmo_task_value'), L('_pmo_projectteam_value'),
      L('_pmo_projectref_value'), L('_pmo_user_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_taskdependency ─────────────────────────────────────────────────────
  {
    entitySet: 'pmo_taskdependencies',
    listName: 'PMO Task Dependencies',
    primaryKey: 'pmo_taskdependencyid',
    fields: [
      T('pmo_taskdependencyid'),
      N('pmo_linktype'),
      L('_pmo_predecessortask_value'), L('_pmo_successortask_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectrisk ────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectrisks',
    listName: 'PMO Project Risks',
    primaryKey: 'pmo_projectriskid',
    fields: [
      T('pmo_projectriskid'), T('pmo_subject'),
      M('pmo_description'), M('pmo_contingencyplan'), M('pmo_mitigationplan'),
      N('pmo_impact'), N('pmo_probability'), N('pmo_exposure'),
      N('pmo_cost'), N('pmo_costexposure'),
      Dt('pmo_due'), N('pmo_category'), N('pmo_state'),
      ...PROJ_LOOKUP,
      L('_pmo_assignedto_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectissue ───────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectissues',
    listName: 'PMO Project Issues',
    primaryKey: 'pmo_projectissueid',
    fields: [
      T('pmo_projectissueid'), T('pmo_subject'),
      M('pmo_description'), M('pmo_resolution'),
      Dt('pmo_duedate'), N('pmo_issuecategory'), N('pmo_priority'), N('pmo_state'),
      ...PROJ_LOOKUP,
      L('_pmo_assignedto_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectchange ──────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectchanges',
    listName: 'PMO Project Changes',
    primaryKey: 'pmo_projectchangeid',
    fields: [
      T('pmo_projectchangeid'), T('pmo_subject'),
      M('pmo_description'), M('pmo_additionalcomments'),
      M('pmo_changebenefits'), M('pmo_changeplan'),
      N('pmo_costimpact'),
      Dt('pmo_plannedstartdate'), Dt('pmo_plannedduedate'), Dt('pmo_requesteddate'),
      N('pmo_changetype'), N('pmo_changeimpact'), N('pmo_changerisk'),
      N('pmo_priority'), N('pmo_approval'), N('pmo_state'),
      ...PROJ_LOOKUP,
      L('_pmo_assignedto_value'), L('_pmo_requestedby_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectstatusreport ────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectstatusreports',
    listName: 'PMO Status Reports',
    primaryKey: 'pmo_projectstatusreportid',
    fields: [
      T('pmo_projectstatusreportid'), T('pmo_name'),
      M('pmo_accomplishedactivities'), M('pmo_plannedactivities'), M('pmo_additionalcomments'),
      Dt('pmo_reportingdate'),
      L('_pmo_project_value'), L('_pmo_submitter_value'), L('_pmo_submittedto_value'),
      L('_createdby_value'),
      ...SYS,
    ],
  },

  // ── pmo_projectrequest (intake) ────────────────────────────────────────────
  {
    entitySet: 'pmo_projectrequests',
    listName: 'PMO Project Requests',
    primaryKey: 'pmo_projectrequestid',
    fields: [
      T('pmo_projectrequestid'), T('pmo_name'), T('pmo_autonumber'),
      N('pmo_requesttype'), N('pmo_priority'), N('pmo_status'),
      Dt('pmo_requestedstartdate'), Dt('pmo_targetcompletiondate'),
      N('pmo_estimatedbudget'), N('pmo_forecastedlaborhours'), N('pmo_resourcemetrictype'),
      T('pmo_sourcesystem'), Dt('pmo_converteddate'),
      N('pmo_routingconfidence'), N('pmo_lineofbusiness'),
      N('pmo_currentstagenumber'), N('pmo_conversiontarget'),
      T('pmo_affectedsystems'),
      M('pmo_description'), M('pmo_businessjustification'), M('pmo_triagecomments'),
      M('pmo_rejectionreason'), M('pmo_submissiontext'), M('pmo_routingrecommendation'),
      L('_createdby_value'), L('_pmo_requestedby_value'), L('_pmo_targetteam_value'),
      L('_pmo_convertedproject_value'), L('_pmo_convertedprojectref_value'),
      L('_pmo_convertedprogram_value'), L('_pmo_affectedsystem_value'),
      L('_pmo_parentrequest_value'), L('_pmo_intakeworkflowid_value'),
      ...SYS,
    ],
  },

  // ── pmo_checklist ──────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_checklists',
    listName: 'PMO Checklists',
    primaryKey: 'pmo_checklistid',
    fields: [
      T('pmo_checklistid'), T('pmo_name'),
      B('pmo_completed'), N('pmo_order'),
      Dt('pmo_duedate'),
      L('_pmo_task_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_tasktolabel ────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_tasktolabels',
    listName: 'PMO Task Labels',
    primaryKey: 'pmo_tasktolabelid',
    fields: [
      T('pmo_tasktolabelid'),
      L('_pmo_task_value'), L('_pmo_projectlabel_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectdecision ────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectdecisions',
    listName: 'PMO Project Decisions',
    primaryKey: 'pmo_projectdecisionid',
    fields: [
      T('pmo_projectdecisionid'), T('pmo_name'),
      M('pmo_description'), Dt('pmo_decisiondate'),
      N('pmo_status'), N('pmo_impact'),
      ...PROJ_LOOKUP,
      L('_pmo_decisionowner_value'), L('_pmo_program_value'), L('_pmo_meetinglink_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectmeetinglink ─────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectmeetinglinks',
    listName: 'PMO Meeting Links',
    primaryKey: 'pmo_projectmeetinglinkid',
    fields: [
      T('pmo_projectmeetinglinkid'), T('pmo_name'),
      T('pmo_meetingsubject'), D('pmo_meetingdatetime'),
      T('pmo_meetingurl'), M('pmo_notes'),
      ...PROJ_LOOKUP,
      L('_pmo_program_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectbaseline ────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectbaselines',
    listName: 'PMO Project Baselines',
    primaryKey: 'pmo_projectbaselineid',
    fields: [
      T('pmo_projectbaselineid'), T('pmo_name'),
      Dt('pmo_captureddate'), Dt('pmo_baselinestart'), Dt('pmo_finish'),
      N('pmo_budget'), N('pmo_baselineeffort'),
      M('pmo_snapshotjson'), M('pmo_notes'),
      ...PROJ_LOOKUP,
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectgate ────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectgates',
    listName: 'PMO Project Gates',
    primaryKey: 'pmo_projectgateid',
    fields: [
      T('pmo_projectgateid'), T('pmo_name'),
      N('pmo_gatetype'), N('pmo_gateorder'), N('pmo_status'),
      Dt('pmo_targetdate'), Dt('pmo_completeddate'),
      M('pmo_notes'),
      ...PROJ_LOOKUP,
      L('_pmo_owner_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectgatedecision ────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectgatedecisions',
    listName: 'PMO Gate Decisions',
    primaryKey: 'pmo_projectgatedecisionid',
    fields: [
      T('pmo_projectgatedecisionid'), T('pmo_name'),
      N('pmo_decision'), Dt('pmo_decisiondate'), M('pmo_notes'),
      L('_pmo_gate_value'), L('_pmo_decidedby_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_requiredartifact ───────────────────────────────────────────────────
  {
    entitySet: 'pmo_requiredartifacts',
    listName: 'PMO Required Artifacts',
    primaryKey: 'pmo_requiredartifactid',
    fields: [
      T('pmo_requiredartifactid'), T('pmo_name'),
      N('pmo_artifacttype'), N('pmo_cfrcategory'),
      B('pmo_isrequired'), M('pmo_description'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectartifactstatus ──────────────────────────────────────────────
  {
    entitySet: 'pmo_projectartifactstatuses',
    listName: 'PMO Artifact Statuses',
    primaryKey: 'pmo_projectartifactstatusid',
    fields: [
      T('pmo_projectartifactstatusid'), T('pmo_name'),
      N('pmo_status'), Dt('pmo_completeddate'), M('pmo_notes'),
      ...PROJ_LOOKUP,
      L('_pmo_requiredartifact_value'), L('_pmo_documentlink_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectcloseout ────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectcloseouts',
    listName: 'PMO Project Closeouts',
    primaryKey: 'pmo_projectcloseoutid',
    fields: [
      T('pmo_projectcloseoutid'), T('pmo_name'),
      T('pmo_checklistitem'), B('pmo_iscomplete'),
      Dt('pmo_completeddate'), M('pmo_notes'),
      M('pmo_lessonslearned'), M('pmo_outcomesummary'),
      ...PROJ_LOOKUP,
      L('_pmo_completedby_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projectteam ────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projectteams',
    listName: 'PMO Project Teams',
    primaryKey: 'pmo_projectteamid',
    fields: [
      T('pmo_projectteamid'), T('pmo_name'),
      N('pmo_role'), Dt('pmo_joineddate'), M('pmo_notes'),
      L('_pmo_project_value'), L('_pmo_team_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_projecttemplate ────────────────────────────────────────────────────
  {
    entitySet: 'pmo_projecttemplates',
    listName: 'PMO Project Templates',
    primaryKey: 'pmo_projecttemplateid',
    fields: [
      T('pmo_projecttemplateid'), T('pmo_name'),
      M('pmo_description'), N('pmo_cfrcategory'),
      M('pmo_taskpayload'), B('pmo_issystemdefault'),
      ...SYS,
    ],
  },

  // ── pmo_tasktemplate ───────────────────────────────────────────────────────
  {
    entitySet: 'pmo_tasktemplates',
    listName: 'PMO Task Templates',
    primaryKey: 'pmo_tasktemplateid',
    fields: [
      T('pmo_tasktemplateid'), T('pmo_name'),
      M('pmo_taskpayload'), T('pmo_scope'),
      B('pmo_issystemdefault'), N('pmo_category'),
      L('_pmo_user_value'), L('_pmo_team_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_userview ───────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_userviews',
    listName: 'PMO User Views',
    primaryKey: 'pmo_userviewid',
    fields: [
      T('pmo_userviewid'), T('pmo_name'), T('pmo_tablekey'),
      M('pmo_config'), B('pmo_isdefault'), T('pmo_scope'),
      L('_pmo_user_value'), L('_pmo_team_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_notification ───────────────────────────────────────────────────────
  {
    entitySet: 'pmo_notifications',
    listName: 'PMO Notifications',
    primaryKey: 'pmo_notificationid',
    fields: [
      T('pmo_notificationid'), T('pmo_title'), M('pmo_body'),
      N('pmo_category'), B('pmo_isread'), T('pmo_actionurl'),
      L('_pmo_targetuser_value'), L('_pmo_project_value'), L('_pmo_program_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_userfeedback ───────────────────────────────────────────────────────
  {
    entitySet: 'pmo_userfeedbacks',
    listName: 'PMO User Feedback',
    primaryKey: 'pmo_userfeedbackid',
    fields: [
      T('pmo_userfeedbackid'), T('pmo_title'),
      M('pmo_description'), N('pmo_feedbacktype'),
      N('pmo_status'), N('pmo_priority'),
      M('pmo_responsecomments'), T('pmo_sourcecontext'), Dt('pmo_dateresolved'),
      L('_createdby_value'), L('_ownerid_value'), L('_pmo_assignedto_value'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_gatesettemplate ────────────────────────────────────────────────────
  {
    entitySet: 'pmo_gatesettemplates',
    listName: 'PMO Gate Set Templates',
    primaryKey: 'pmo_gatesettemplateid',
    fields: [
      T('pmo_gatesettemplateid'), T('pmo_name'),
      M('pmo_description'), N('pmo_cfrcategory'),
      B('pmo_isdefault'), N('pmo_workflowscope'), N('pmo_targetentitytype'),
      M('pmo_conversionrulesjson'),
      ...SYS_NO_MOD,
    ],
  },

  // ── pmo_gatesetitem ────────────────────────────────────────────────────────
  {
    entitySet: 'pmo_gatesetitems',
    listName: 'PMO Gate Set Items',
    primaryKey: 'pmo_gatesetitemid',
    fields: [
      T('pmo_gatesetitemid'), T('pmo_name'),
      N('pmo_gatetype'), N('pmo_gateorder'),
      M('pmo_conditionsjson'), M('pmo_requiredfieldsjson'),
      M('pmo_requiredartifacttypesjson'), B('pmo_requiresapproval'),
      T('pmo_approvergroupid'), T('pmo_stagelabel'),
      L('_pmo_gateset_value'),
      ...SYS_NO_MOD,
    ],
  },
];

// ─── Derived lookups ─────────────────────────────────────────────────────────

/** Set of entity set names that are backed by SharePoint lists in the registry. */
export const SP_BACKED_ENTITY_SETS: ReadonlySet<string> = new Set(
  SP_LIST_REGISTRY.map((d) => d.entitySet),
);

/** Look up the SpListDef for an entity set, or undefined if not SP-backed. */
export function getSpListDef(entitySet: string): SpListDef | undefined {
  return SP_LIST_REGISTRY.find((d) => d.entitySet === entitySet);
}

/**
 * True when the current data source is 'sharepoint' AND the entity set has a
 * registered SP list. The dataverseClient.ts short-circuit calls this to decide
 * whether to route a call to the SP connector instead of Dataverse OData.
 *
 * Deliberately excludes `pmo_appsettings` (the flag lives there — circular dep)
 * even if someone were to add it to the registry by accident; the entity set
 * is simply not in SP_BACKED_ENTITY_SETS so it will never match.
 */
export function isSharePointDataActive(entitySet: string): boolean {
  return getCachedDataSource() === 'sharepoint' && SP_BACKED_ENTITY_SETS.has(entitySet);
}
