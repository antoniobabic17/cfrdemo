// OWNERSHIP [HIGH-RISK]: Split — Platform Domain Owner controls ENTITY_SETS and SETTING_* keys; Application Domain Contributor controls option-set blocks.
// See CONTRIBUTING.md §Shared Files for coordination rules.

/** Entity set names for Dataverse OData API calls */
export const ENTITY_SETS = {
  // CFR custom tables
  projectRequest:    'pmo_projectrequests',         // pmo_projectrequest
  projectTeam:       'pmo_projectteams',            // pmo_projectteam (CFR junction: project ↔ team)
  projectCollaborator: 'pmo_projectcollaborators',  // pmo_projectcollaborator (individual-mode grants)
  // P4W + Accelerator tables
  project:           'msdyn_projects',              // msdyn_project
  program:           'msdyn_projectprograms',       // msdyn_projectprogram
  statusReport:      'msdyn_projectstatusreports',  // msdyn_projectstatusreport
  projectTask:           'msdyn_projecttasks',              // msdyn_projecttask
  projectTaskDependency: 'msdyn_projecttaskdependencies',   // msdyn_projecttaskdependency
  resourceAssignment:    'msdyn_resourceassignments',       // msdyn_resourceassignment
  bookableResource:      'bookableresources',               // bookableresource
  projectBucket:         'msdyn_projectbuckets',            // msdyn_projectbucket
  projectTeamMember: 'msdyn_projectteams',          // msdyn_projectteam (P4W native resource records)
  projectRisk:       'msdyn_projectrisks',          // msdyn_projectrisk
  projectIssue:      'msdyn_projectissues',         // msdyn_projectissue
  projectChange:     'msdyn_projectchanges',        // msdyn_projectchange
  // P4W scheduling entities (spike-validated 2026-04-18)
  projectChecklist:      'msdyn_projectchecklists',     // msdyn_projectchecklist (S6 PASS)
  projectLabel:          'msdyn_projectlabels',         // msdyn_projectlabel (S5 PASS)
  projectTaskToLabel:    'msdyn_projecttasktolabels',   // msdyn_projecttasktolabel (S5b PASS)
  projectSprint:         'msdyn_projectsprints',        // msdyn_projectsprint (S8 accessible)
  // System tables
  organization:      'organizations',
  systemUser:        'systemusers',
  team:              'teams',
  documentHeader:    'msdyn_documentheaders',
  // Reference / master-data tables
  crSystem:          'cr87a_systems',           // central system catalog (cr87a_System)
  hpiIssue:          'rcm_payerdeckissues',     // rcm_payerdeckissue — Payer Issue Number Mapping (HPI). Surface lives in the payer-initiatives feature pack at app/src/features/teams/payer-initiatives/.
  payerIssue:        'cr87a_payerissues',       // cr87a_payerissue — full Payer Issue catalog (separate from HPI). Surface also in payer-initiatives feature pack.
  annotation:        'annotations',             // Dataverse notes / file attachments
  appSetting:        'pmo_appsettings',         // pmo_AppSetting — administrator key-value config
  projectTemplate:   'pmo_projecttemplates',    // pmo_ProjectTemplate — project template definitions
  projectGate:       'pmo_projectgates',        // pmo_ProjectGate — lifecycle governance gates
  projectGateDecision: 'pmo_projectgatedecisions', // pmo_ProjectGateDecision — gate approval decisions
  requiredArtifact:  'pmo_requiredartifacts',   // pmo_RequiredArtifact — artifact definitions
  projectArtifactStatus: 'pmo_projectartifactstatuses', // pmo_ProjectArtifactStatus — per-project artifact tracking
  projectCloseout:   'pmo_projectcloseouts',    // pmo_ProjectCloseout — closeout checklist
  notification:      'pmo_notifications',       // pmo_Notification — durable in-app notifications
  userView:          'pmo_userviews',           // pmo_UserView — per-user saved list views (columns/widths)
  taskTemplate:      'pmo_tasktemplates',        // pmo_TaskTemplate — user/team task-list templates (views-style scope)
  telemetryEvent:    'pmo_telemetryevents',     // pmo_TelemetryEvent — telemetry persistence
  taskStaging:       'pmo_taskstagings',        // pmo_TaskStaging — staging table for PSS-bound writes (see docs/staging-architecture.md)
  projectDecision:   'pmo_projectdecisions',    // pmo_ProjectDecision — decision log
  projectMeetingLink: 'pmo_projectmeetinglinks', // pmo_ProjectMeetingLink — meeting ↔ project linkage
  projectBaseline:   'pmo_projectbaselines',    // pmo_ProjectBaseline — schedule/financial baseline snapshots
  gateSetTemplate:   'pmo_gatesettemplates',    // pmo_GateSetTemplate — admin gate set definitions
  gateSetItem:       'pmo_gatesetitems',        // pmo_GateSetItem — items within a gate set
  role:              'roles',                   // Dataverse security role — queried via systemuserroles_association
} as const;

/** Default stale time for TanStack Query (5 minutes) */
export const QUERY_STALE_TIME = 5 * 60 * 1000;

/**
 * msdyn_projecttask.msdyn_priority — Planner Premium / P4W priority values.
 * These are the actual integer option-set values stored in Dataverse.
 * Confirmed from spike S2 (2026-04-18): value 3 → "Important" in Planner.
 * Confirmed from live data: most tasks default to 5 → "Medium" in Planner.
 * Source: Microsoft Planner priority scale (same values used by Graph plannerTask.priority
 * snap-points: 1=Urgent, 3=Important, 5=Medium, 9=Low).
 */
export const TASK_PRIORITY = {
  Urgent:    1,
  Important: 3,
  Medium:    5,  // default when a task is created in Planner without explicit priority
  Low:       9,
} as const;

export type TaskPriorityValue = typeof TASK_PRIORITY[keyof typeof TASK_PRIORITY];

export interface TaskPriorityMeta { label: string; cls: string }

export const TASK_PRIORITY_META: Record<number, TaskPriorityMeta> = {
  [TASK_PRIORITY.Urgent]:    { label: 'Urgent',    cls: 'bg-rose-100 text-rose-700' },
  [TASK_PRIORITY.Important]: { label: 'Important', cls: 'bg-amber-100 text-amber-700' },
  [TASK_PRIORITY.Medium]:    { label: 'Medium',    cls: 'bg-blue-100 text-blue-600' },
  [TASK_PRIORITY.Low]:       { label: 'Low',       cls: 'bg-slate-100 text-slate-500' },
};

/** Ordered list for selects and filter chips, highest to lowest. */
export const TASK_PRIORITY_OPTIONS = [
  { value: TASK_PRIORITY.Urgent,    ...TASK_PRIORITY_META[TASK_PRIORITY.Urgent] },
  { value: TASK_PRIORITY.Important, ...TASK_PRIORITY_META[TASK_PRIORITY.Important] },
  { value: TASK_PRIORITY.Medium,    ...TASK_PRIORITY_META[TASK_PRIORITY.Medium] },
  { value: TASK_PRIORITY.Low,       ...TASK_PRIORITY_META[TASK_PRIORITY.Low] },
] as const;

// ─── pmo_project.pmo_projectstatus choices (Payer Initiatives migration) ──────
// 5-value status on the custom project table. Newly approved projects start at
// New; the migrator collapses the legacy 11-value cr87a status into these
// (see docs/deployment-runbook.md status mapping).
export const PROJECT_STATUS = {
  New:        508640000,
  InProgress: 508640001,
  OnHold:     508640003,
  Complete:   508640004,
  Cancelled:  508640005,
} as const;

export const PROJECT_STATUS_LABELS: Record<number, string> = {
  [PROJECT_STATUS.New]:        "New",
  [PROJECT_STATUS.InProgress]: "In-Progress",
  [PROJECT_STATUS.OnHold]:     "On-Hold",
  [PROJECT_STATUS.Complete]:   "Complete",
  [PROJECT_STATUS.Cancelled]:  "Cancelled",
};

export const PROJECT_STATUS_OPTIONS = [
  { value: String(PROJECT_STATUS.New),        label: "New" },
  { value: String(PROJECT_STATUS.InProgress), label: "In-Progress" },
  { value: String(PROJECT_STATUS.OnHold),     label: "On-Hold" },
  { value: String(PROJECT_STATUS.Complete),   label: "Complete" },
  { value: String(PROJECT_STATUS.Cancelled),  label: "Cancelled" },
] as const;

// ─── pmo_projectrequest choices ───────────────────────────────────────────────

export const REQUEST_TYPE = {
  NewProject: 893460000,
  ChangeRequest: 893460001,
  Enhancement: 893460002,
  Support: 893460003,
  NewProgram: 893460004,
} as const;

// Resource Metric Type — how a project/request is tracked. Labor projects use
// Forecasted Labor Hours + the New Resource Model; Financial projects use the
// budget/forecast/benefits fields. Null on a record is treated as Labor by the
// app (business default: every project starts labor-based).
export const RESOURCE_METRIC_TYPE = {
  Labor: 893460000,
  Financial: 893460001,
} as const;

export const REQUEST_PRIORITY = {
  Critical: 893460010,
  High: 893460011,
  Medium: 893460012,
  Low: 893460013,
} as const;

export const REQUEST_STATUS = {
  Draft: 893460020,
  Submitted: 893460021,
  InTriage: 893460022,
  Approved: 893460023,
  Rejected: 893460024,
  Converted: 893460025,
  AwaitingClarification: 893460026,
  RoutedOperational: 893460027,
  Redirected: 893460028,
  // Requester withdrew their own request. Distinct from Rejected (the assigned
  // team's outcome). Reuses pmo_rejectionreason for the cancellation reason.
  // Added 2026-08-31 via scripts/add-cancelled-status-on-projectrequest.py —
  // the option value MUST exist in the target env BEFORE a build that writes it
  // ships there (same deploy-order rule as the feedback Draft/OnHold adds).
  Cancelled: 893460029,
} as const;

export const FEEDBACK_TYPE = {
  BugReport: 153480000,
  Enhancement: 153480001,
} as const;

export const FEEDBACK_STATUS = {
  New: 153480000,
  InReview: 153480001,
  Accepted: 153480002,
  Resolved: 153480003,
  /**
   * Author has saved but not submitted. Added 2026-08-04 so bug reports and
   * enhancements support "Save as Draft" like projects/programs/intake requests
   * (which have their own REQUEST_STATUS.Draft).
   *
   * Schema: scripts/add-draft-status-on-userfeedback.py inserts this value into
   * the LOCAL option set new_pmo_userfeedback_pmo_status. It MUST exist in the
   * target environment before a build that writes it ships there.
   *
   * Label drift warning (pre-existing, not introduced here): Dataverse stores
   * 153480001 as "In Progress" and 153480002 as "Rejected", while the names
   * above and the admin UI say InReview / Accepted. The VALUES agree, only the
   * display text differs.
   */
  Draft: 153480004,
  /** Added 2026-08-20 (scripts/add-onhold-status-on-userfeedback.py). Local
   *  option value on new_pmo_userfeedback_pmo_status. Must exist in the target
   *  env before a build that writes it ships there. */
  OnHold: 153480005,
} as const;

export const FEEDBACK_PRIORITY = {
  Critical: 153480000,
  High: 153480001,
  Medium: 153480002,
  Low: 153480003,
} as const;

export const CLARIFICATION_STATE = {
  None: 0,
  PendingRequester: 1,
  PendingPMO: 2,
  Resolved: 3,
} as const;

export const OUTCOME_CATEGORY = {
  Project: 0,
  Operational: 1,
  Redirect: 2,
  Declined: 3,
} as const;

// Line-of-business choice values on pmo_projectrequest.pmo_lineofbusiness.
// Originally had four options (Enteral, Infusion - Epic, Infusion - MediAR,
// All / Not Applicable). Per May 2026 simplification we collapse to three:
//   893460100 -> Enteral (unchanged)
//   893460101 -> Infusion         (was 'Infusion – Epic'; relabeled
//                                   in optionset metadata; rows untouched)
//   893460102 -> Infusion (legacy MediAR; HIDDEN in optionset; legacy rows
//                          remain readable, see LINE_OF_BUSINESS_LABELS)
//   893460103 -> Both             (was 'All / Not Applicable'; relabeled)
// New picker UI exposes Enteral / Infusion / Both only.
export const LINE_OF_BUSINESS = {
  Enteral:  893460100,
  Infusion: 893460101,
  Both:     893460103,
} as const;

/** Legacy MediAR option value, kept for read-back of historical rows. New
 *  records should never select this. The optionset hides it; the constant
 *  exists only so display code can format old rows correctly. */
export const LINE_OF_BUSINESS_LEGACY_MEDIAR = 893460102;

/** Display labels keyed by raw option value. Collapses legacy MediAR rows
 *  into the 'Infusion' label so the UI reads cleanly without touching
 *  Dataverse data beyond the relabel migration. */
export const LINE_OF_BUSINESS_LABELS: Record<number, string> = {
  [LINE_OF_BUSINESS.Enteral]:  'Enteral',
  [LINE_OF_BUSINESS.Infusion]: 'Infusion',
  [LINE_OF_BUSINESS_LEGACY_MEDIAR]: 'Infusion',
  [LINE_OF_BUSINESS.Both]:     'Both',
};

/** Key used in pmo_AppSetting to store the fallback triage team GUID */
export const SETTING_FALLBACK_TRIAGE_TEAM = 'pmo.fallback_triage_team_id';

/** Key used in pmo_AppSetting to scope user dropdowns by AAD security group object ID.
 *  Stored as the AAD group object ID (not the Dataverse team GUID) so it works across environments. */
export const SETTING_USER_SCOPE_GROUP = 'pmo.user_scope_aad_group_id';

export const SETTING_DEFAULT_PROJECT_TEMPLATE = 'pmo.default_project_template_id';

export const SETTING_TEAM_DEFAULT_TEMPLATE_PREFIX = 'pmo.team_default_template.';

// Per-team controls used by the Teams section (team lead, popup
// announcement, per-team feature-toggle overrides). All three are
// scoped by teamid suffix and persisted in pmo_appsettings.
export const SETTING_TEAM_LEAD_PREFIX         = 'pmo.team_lead.';
export const SETTING_TEAM_ANNOUNCEMENT_PREFIX = 'pmo.team_announcement.';
export const SETTING_TEAM_TOGGLES_PREFIX      = 'pmo.team_toggles.';
// Per-team New Resource Model default (Resourcing → Labor Hours). When a team is
// opted in, NEW projects whose primary team is this team default to the New
// Resource Model (pmo_usenewresourcemodel=true). Value 'true' = opted in; absent
// or anything else = off (legacy behavior — new projects start unchecked).
export const SETTING_TEAM_NRM_DEFAULT_PREFIX  = 'pmo.team_nrm_default.';
// Snapshot of each project's pmo_usenewresourcemodel value captured the moment a
// team is opted IN, so opting OFF can restore the exact prior mix. Value is JSON
// { [projectId]: boolean } written under pmo.team_nrm_snapshot.{teamId}.
export const SETTING_TEAM_NRM_SNAPSHOT_PREFIX = 'pmo.team_nrm_snapshot.';
// Per-team NAV-TAB ALLOWLIST (initiative #4). JSON string[] of nav toggleKeys a
// team is allowed to see. Absent => no restriction (current behavior). Present =>
// members of this team see ONLY these nav.* items. Gated pmo_admin. See
// lib/teamTabVisibility.ts.
export const SETTING_TEAM_TABS_PREFIX          = 'pmo.team_tabs.';
// Configurable admin identity (initiative #4). JSON { teamIds, userObjectIds,
// groupObjectIds } whose members resolve as pmo_admin IN ADDITION to the
// Dataverse role-name checks. Seeded at first-time setup. Gated system_admin.
export const SETTING_ADMIN_PRINCIPALS          = 'pmo.admin_principals_json';

/** Single global announcement, authored by admins, popped to every user. */
export const SETTING_GLOBAL_ANNOUNCEMENT_KEY = 'pmo.global_announcement';
// ─── Phase 2 setting keys (admin-managed operational config) ─────────────────
export const SETTING_DASHBOARD_DISPLAY_CONFIG        = 'pmo.dashboard_display_config_json';
export const SETTING_INTAKE_TRIAGE_SIMILARITY_CONFIG = 'pmo.intake_triage_similarity_config_json';
export const SETTING_NOTIFICATION_DISPLAY_CONFIG     = 'pmo.notification_display_config_json';
export const SETTING_SP_DOCUMENT_CATEGORIES          = 'pmo.sp_document_categories_json';
export const SETTING_SP_LIBRARY_BASE_URL             = 'pmo.sp_library_base_url';
/** SharePoint site URL for the GENERAL-DATA backend (pmo.data_source = 'sharepoint').
 *  Distinct from SETTING_SP_LIBRARY_BASE_URL, which is the file/document library.
 *  Display/provisioning-script only — the connector data source binding is fixed
 *  at provisioning time, not runtime-configurable. See sharePointData.ts. */
export const SETTING_SP_DATA_SITE_URL                = 'pmo.sp_data_site_url';
/** Standard monthly capacity hours used by the New Resource Model section on the
 *  Capacity page and the Resources sub-tab. Defaults to 160 when unset, keeping
 *  the same number the old-model section already hardcodes. */
export const SETTING_STANDARD_CAPACITY_HOURS         = 'pmo.standard_capacity_hours';
/** Collaboration mode for the project Collaborate tab. 'team' = team-based (default);
 *  'individual' = per-user grants via pmo_projectcollaborator. See lib/collaborationMode.ts. */
export const SETTING_COLLABORATION_MODE              = 'pmo.collaboration_mode';
export const SETTING_PMO_TEAM_FIELD                  = 'pmo.pmo_team_field';
export const SETTING_TENANT_ID                       = 'pmo.tenant_id';
// Environment identity overrides (initiative #2 -- transferability). Both are
// OPTIONAL and default to the compiled constants below, so an unset environment
// behaves EXACTLY as before.
//   pmo.environment_label   -> string 'DEV' | 'UAT' | 'PROD' (sidebar badge).
//                              Unset -> match live environmentId vs ENV_IDS (legacy).
//   pmo.p4w_env_guids_json  -> JSON { calendarId, workHoursTemplateId, orgUnitId }
//                              for THIS env. Unset -> P4W_GUIDS_BY_ENV[environmentId].
export const SETTING_ENVIRONMENT_LABEL               = 'pmo.environment_label';
export const SETTING_P4W_ENV_GUIDS                   = 'pmo.p4w_env_guids_json';
//   pmo.environment_badge_color -> named palette for the sidebar env badge
//                              (amber|sky|emerald|rose|violet|slate). Unset ->
//                              derived from the label (legacy: DEV=amber,
//                              UAT=sky, else emerald), so appearance is unchanged.
export const SETTING_ENVIRONMENT_BADGE_COLOR         = 'pmo.environment_badge_color';
// Branding overrides (transferability). All OPTIONAL; blank/unset falls back to
// the compiled defaults below so an un-customized environment is unchanged.
//   pmo.brand_sidebar_name -> sidebar brand text (default 'CFR PMO')
//   pmo.brand_app_title    -> header banner title (default 'CFR Project Management')
//   pmo.brand_greeting     -> fixed greeting override; blank -> time-based greeting
export const SETTING_BRAND_SIDEBAR_NAME              = 'pmo.brand_sidebar_name';
export const SETTING_BRAND_APP_TITLE                 = 'pmo.brand_app_title';
export const SETTING_BRAND_GREETING                  = 'pmo.brand_greeting';
export const DEFAULT_BRAND_SIDEBAR_NAME              = 'CFR PMO';
export const DEFAULT_BRAND_APP_TITLE                 = 'CFR Project Management';

/** Named palette for the sidebar environment badge. Full Tailwind class strings
 *  are listed literally so the JIT compiler keeps them (no dynamic class names). */
export const ENV_BADGE_COLORS = {
  amber:   'bg-amber-100 text-amber-700 border-amber-300',
  sky:     'bg-sky-100 text-sky-700 border-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  rose:    'bg-rose-100 text-rose-700 border-rose-300',
  violet:  'bg-violet-100 text-violet-700 border-violet-300',
  slate:   'bg-slate-100 text-slate-700 border-slate-300',
} as const;

export type EnvBadgeColor = keyof typeof ENV_BADGE_COLORS;
export const SETTING_INTAKE_ROUTING_CONFIG           = 'pmo.intake_routing_config_json';
export const SETTING_PRIORITIZATION_WEIGHTS          = 'pmo.prioritization_weights_json';
export const SETTING_PRIORITIZATION_BUDGET_TIERS     = 'pmo.prioritization_budget_tiers_json';
export const SETTING_MIRA_SIGNAL_THRESHOLDS          = 'pmo.mira_signal_thresholds_json';
export const SETTING_FEATURE_TOGGLES                  = 'pmo.feature_toggles_json';
export const SETTING_TENOR_API_KEY                    = 'pmo.tenor_api_key';

// ─── Staging (PSS write reliability) ────────────────────────────────
// pmo_stagingenabled = 'true' | 'false'. Default false. When true, task /
// bucket / dependency / assignment writes route through pmo_taskstaging and
// the async flush plugin instead of hitting PSS directly. When false, the
// legacy direct-PSS path (schedulingClient.ts) is used. Toggled per env.
export const SETTING_STAGING_ENABLED                  = 'pmo.staging_enabled';

/** pmo_telemetryevent.pmo_eventtype value written by the staging flush plugin
 *  and the pmo_FlushTaskStaging Custom API for every flush attempt (success
 *  and failure). The System Jobs admin panel queries on this event type. */
export const STAGING_FLUSH_EVENT_TYPE = 'StagingFlush';

/** pmo_taskstaging.pmo_operation choice values. */
export const STAGING_OPERATION = {
  Create: 893460300,
  Update: 893460301,
  Delete: 893460302,
} as const;

/** pmo_taskstaging.pmo_entitytype choice values. */
export const STAGING_ENTITY_TYPE = {
  Task:       893460310,
  Bucket:     893460311,
  Dependency: 893460312,
  Assignment: 893460313,
} as const;

/** pmo_taskstaging.pmo_syncstatus choice values. */
export const STAGING_SYNC_STATUS = {
  Pending:   893460320,
  InFlight:  893460321,
  Synced:    893460322,
  Failed:    893460323,
  Abandoned: 893460324,
} as const;

export type StagingOperation  = typeof STAGING_OPERATION[keyof typeof STAGING_OPERATION];
export type StagingEntityType = typeof STAGING_ENTITY_TYPE[keyof typeof STAGING_ENTITY_TYPE];
export type StagingSyncStatus = typeof STAGING_SYNC_STATUS[keyof typeof STAGING_SYNC_STATUS];

// ─── Environment IDs (Power Platform environmentId) ──────────────────────────
// Used to switch env-pinned values (P4W GUIDs, etc.) at runtime so the same
// bundle ships unchanged to DEV / UAT / PROD. Source of truth is the Env Map
// in docs/deployment-runbook.md. Also referenced by the Sidebar env badge.
export const ENV_IDS = {
  dev:  '731e4975-10cd-4535-b82f-1ff016e59b6c',  // Nexus RCM - DEV
  uat:  '69a4a130-ad3b-491e-8dac-7ce7a41a7934',  // Nexus RCM - UAT
  prod: '7a0a0d77-0433-4d7e-9480-604d1d24cc6f',  // Nexus - CVS Finance RevCycle
} as const;

// ─── P4W environment-pinned GUIDs ────────────────────────────────────────────
// Calendar, work-hours template, and contracting organizational unit records
// all exist in every P4W environment but with different GUIDs per env.
// Previously hardcoded into the CFRIntakeToProject flow JSON and patched via
// PowerShell at deploy. Now baked here and selected by environmentId at
// runtime so the client-side conversion path (StageApprovalPanel) builds a
// P4W-valid project payload without any deploy-time patching.
//
// Values verified against docs/deployment-runbook.md (PROD/UAT) and
// solution/src/Workflows/pmo_CFRIntakeToProject-*.json (DEV).
export interface P4WEnvIds {
  calendarId: string;
  workHoursTemplateId: string;
  orgUnitId: string;
}

// Only DEV and PROD are baked. UAT and any other env intentionally fall through
// (resolver returns undefined) so the legacy CFRIntakeToProject flow handles
// them. Runbook+flow JSON+patch script currently disagree on UAT's GUIDs; we
// will fill UAT in once verified directly against msdyn_organizationalunits.
export const P4W_GUIDS_BY_ENV: Record<string, P4WEnvIds> = {
  [ENV_IDS.dev]: {
    // Verified live against DEV Dataverse 2026-07-07. Prior GUIDs
    // (501397da..., 592d1cba..., 381c82d4...) were re-provisioned; submitting
    // a project on wizard tab 6 returned ObjectDoesNotExist on
    // msdyn_workhourtemplate. Live values now sourced from
    //   /msdyn_workhourtemplates, /msdyn_organizationalunits,
    //   and msdyn_workhourtemplate.msdyn_calendarid.
    calendarId:          '75f05144-1cb0-f011-bbd3-6045bdeb6f62',
    workHoursTemplateId: '71f05144-1cb0-f011-bbd3-6045bdeb6f62',
    orgUnitId:           '67f05144-1cb0-f011-bbd3-6045bdeb6f62',
  },
  [ENV_IDS.prod]: {
    // Sourced from docs/deployment-runbook.md "Prod P4W GUIDs" table.
    calendarId:          '6138f6d6-f570-ef11-a670-0022482c38a9',
    workHoursTemplateId: '6038f6d6-f570-ef11-a670-0022482c38a9',
    orgUnitId:           '5638f6d6-f570-ef11-a670-0022482c38a9',
  },
};

export const SOURCE_SYSTEM = {
  CfrPmo: 893460030,
  BiPmoTool: 893460031,
  External: 893460032,
} as const;

// ─── pmo_projectteam choices ───────────────────────────────────────────────────

export const TEAM_ROLE = {
  Primary: 893460040,
  Contributing: 893460041,
} as const;

// ─── msdyn_project extension choices ──────────────────────────────────────────

export const CFR_CATEGORY = {
  ItInfrastructure: 893460050,
  FinanceSystems: 893460051,
  Compliance: 893460052,
  DataAndAnalytics: 893460053,
  Operations: 893460054,
  Other: 893460055,
} as const;

export const COMPLEXITY = {
  Low: 893460060,
  Medium: 893460061,
  High: 893460062,
  Critical: 893460063,
} as const;

export const STRATEGIC_PRIORITY = {
  MustHave: 893460070,
  ShouldHave: 893460071,
  NiceToHave: 893460072,
} as const;

// ─── Affected Systems (multi-select Choice) ──────────────────
// New standardized multi-select `pmo_affectedsystems` on BOTH pmo_projectrequest
// and pmo_project, backed by the global option set `pmo_affectedsystem`
// (scripts/add-affectedsystem-choice.py). Replaces the legacy single
// pmo_AffectedSystem lookup -> cr87a_system (a Nexus-RCM catalog absent from DEV).
// Values are STABLE and MUST match the option-set values created by the script.
// A MultiSelectPicklist round-trips over OData as a comma-joined string of the
// integer values (see multiSelectToArray / arrayToMultiSelect helpers below).
export const AFFECTED_SYSTEM_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 100000000, label: 'ACIS' },
  { value: 100000001, label: 'ACIS, Epic' },
  { value: 100000002, label: 'ACIS, MediAR' },
  { value: 100000003, label: 'Availity' },
  { value: 100000004, label: 'CE2000' },
  { value: 100000005, label: 'Co-mingled' },
  { value: 100000006, label: 'Correspondence Multi-Claim' },
  { value: 100000007, label: 'End-To-End' },
  { value: 100000008, label: 'Epic' },
  { value: 100000009, label: 'ePremis (CHC)' },
  { value: 100000010, label: 'FHA' },
  { value: 100000011, label: 'HC360' },
  { value: 100000012, label: 'MediAR' },
  { value: 100000013, label: 'Med-Metrix Workflow Tool (MMX)' },
  { value: 100000014, label: 'Microsoft Application' },
  { value: 100000015, label: 'Possible Other System' },
  { value: 100000016, label: 'Power BI - Coram Revenue Cycle' },
  { value: 100000017, label: 'RCM - Revenue Cycle Manager' },
  { value: 100000018, label: 'SAP' },
  { value: 100000019, label: 'ServiceNow' },
  { value: 100000020, label: 'SharePoint - Epic' },
  { value: 100000021, label: 'SharePoint - Specialty Reimbursement' },
  { value: 100000022, label: 'Unable to Determine' },
  { value: 100000023, label: 'SharePoint' },
] as const;

/** MultiSelectCheckList options (string values) for the Affected Systems field. */
export const AFFECTED_SYSTEM_SELECT_OPTIONS = AFFECTED_SYSTEM_OPTIONS.map(
  (o) => ({ value: String(o.value), label: o.label }),
);

/** Dataverse MultiSelectPicklist -> string[] of option values. */
export function multiSelectToArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw).split(',').map((x) => x.trim()).filter(Boolean);
}

/** string[] of option values -> the comma-joined form Dataverse persists.
 *  Empty selection -> null so the column clears. */
export function arrayToMultiSelect(values: string[] | null | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join(',');
}

/** Resolve option values to their display labels (comma-joined) for read-only UI. */
export function affectedSystemLabels(values: string[]): string {
  return values
    .map((v) => AFFECTED_SYSTEM_OPTIONS.find((o) => String(o.value) === v)?.label ?? null)
    .filter((l): l is string => !!l)
    .join(', ');
}

// ─── msdyn_projectprogram Accelerator choices ─────────────────────────────────
// Queried from DEV on 2026-04-17 via PicklistAttributeMetadata

export const PROG_TYPE = {
  Customer:    189330000,
  Development: 189330001,
  Support:     189330002,
  Enhancement: 189330003,
  Program:     189330004,
  Other:       189330005,
} as const;

export const PROG_GOALS = {
  CustomerSatisfaction: 189330000,
  GrowBusiness:         189330001,
  RunBusiness:          189330002,
  Transformation:       189330003,
  Other:                189330004,
} as const;

// CFR-specific business unit deployment (Coram/RCM)
export const PROG_BUSINESS_UNIT = {
  Enteral:        189330000,
  Epic:           189330001,
  InfusionLegacy: 189330002,
  Medicare:       153480001,
} as const;

// ─── proj_overallhealth (PMO Accelerator) ─────────────────────────────────────

export const OVERALL_HEALTH = {
  OnTrack: 189330000,
  AtRisk: 189330001,
  OffTrack: 189330002,
} as const;

// ─── msdyn_projectrisk Accelerator choices ─────────────────────────────────────

export const RISK_CATEGORY = {
  Stakeholder: 189330000,
  Scope: 189330001,
  Change: 189330002,
  Resources: 189330003,
  Design: 189330004,
  Technical: 189330005,
  Other: 189330006,
} as const;

export const RISK_STATE = {
  Proposed: 189330000,
  Active: 189330001,
  Closed: 189330002,
  OnHold: 189330003,
} as const;

// ─── msdyn_projectissue Accelerator choices ────────────────────────────────────

export const ISSUE_CATEGORY = {
  Issue: 189330000,
  Task: 189330001,
  Bug: 189330002,
  Other: 189330003,
} as const;

// proj_priority is shared by issue and change
export const ACCEL_PRIORITY = {
  Critical: 189330000,
  High: 189330001,
  Moderate: 189330002,
  Low: 189330003,
} as const;

// proj_state is shared by risk, issue, and change
export const ACCEL_STATE = {
  Proposed: 189330000,
  Active: 189330001,
  Closed: 189330002,
  OnHold: 189330003,
} as const;

// ─── msdyn_projectchange Accelerator choices ───────────────────────────────────

export const CHANGE_TYPE = {
  Scope: 189330000,
  Schedule: 189330001,
  Cost: 189330002,
  None: 189330003,
} as const;

export const CHANGE_IMPACT = {
  High: 189330000,
  Medium: 189330001,
  Low: 189330002,
} as const;

export const CHANGE_RISK = {
  High: 189330000,
  Moderate: 189330001,
  Low: 189330002,
  None: 189330003,
} as const;

export const CHANGE_APPROVAL = {
  NotYetRequested: 189330000,
  Requested: 189330001,
  Approved: 189330002,
  Rejected: 189330003,
} as const;

// ─── Team flag field name ──────────────────────────────────────────────────────
// pmo_pmoteam is a Boolean column owned by CFRProjectManagement solution (pmo_ publisher).
// DEV previously used cr741_pmoteam from another publisher; this column is the solution-owned replacement.
// Populate this flag on all PMO teams in UAT/PROD after solution import.
export const PMO_TEAM_FLAG = 'pmo_pmoteam' as const;

// ─── Planner deep link ─────────────────────────────────────────────────────────
// Template: PLANNER_BASE + planId + '/org/' + organizationId + PLANNER_BOARD_SUFFIX + '?tid=' + TENANT_ID
// organizationId is queried at runtime from GET /api/data/v9.2/organizations

export const PLANNER_BASE = 'https://planner.cloud.microsoft/webui/premiumplan/';
export const PLANNER_BOARD_SUFFIX = '/view/board';
export const TENANT_ID = 'fabb61b8-3afe-4e75-b934-a47f782b8cd7';

// ─── pmo_projectgate choices ─────────────────────────────────────────────────

export const GATE_TYPE = {
  Initiation: 893460090,
  Planning:   893460091,
  Execution:  893460092,
  Closeout:   893460093,
} as const;

export const GATE_STATUS = {
  NotStarted: 893460094,
  InProgress: 893460095,
  Passed:     893460096,
  Failed:     893460097,
  Waived:     893460098,
} as const;

export const GATE_DECISION = {
  Approved: 893460100,
  Rejected: 893460101,
  Deferred: 893460102,
} as const;

// ─── pmo_requiredartifact choices ────────────────────────────────────────────

export const ARTIFACT_TYPE = {
  BusinessCase:       893460110,
  ProjectCharter:     893460111,
  RaciMatrix:         893460112,
  CommunicationPlan:  893460113,
  RiskRegister:       893460114,
  SOW:                893460115,
  Budget:             893460116,
  CloseoutReport:     893460117,
  LessonsLearned:     893460118,
  Other:              893460119,
} as const;

export const ARTIFACT_STATUS = {
  NotStarted: 893460120,
  InProgress: 893460121,
  Complete:   893460122,
  Waived:     893460123,
} as const;

// ─── pmo_notification choices ────────────────────────────────────────────────

export const NOTIF_CATEGORY = {
  Gate:     893460130,
  Artifact: 893460131,
  Closeout: 893460132,
  Meeting:  893460133,
  Error:    893460134,
  Info:     893460135,
  // Intake / action-item categories on pmo_notification_pmo_category.
  // Added to DEV + PROD via scripts/add-intake-notification-categories.py
  // (2026-08-06). These were MISSING from both envs before that — the emitters
  // were silently 400-ing (best-effort wrapper swallowed it), so no intake
  // notification was ever written. Do not reference these values in an env
  // where the script hasn't run.
  TaskAssigned:           893460136,
  ClarificationRequested: 893460137,
  RequestSubmitted:       893460138,
  RequestDecision:        893460139,
} as const;

// ─── pmo_telemetryevent choices ──────────────────────────────────────────────

export const TELEMETRY_SEVERITY = {
  Info:     893460140,
  Warning:  893460141,
  Error:    893460142,
  Critical: 893460143,
} as const;

// ─── pmo_projectdecision choices ─────────────────────────────────────────────

export const DECISION_STATUS = {
  Proposed: 893460150,
  Approved: 893460151,
  Rejected: 893460152,
  Deferred: 893460153,
} as const;

export const DECISION_IMPACT = {
  High:   893460154,
  Medium: 893460155,
  Low:    893460156,
} as const;

// ─── Intake workflow / governed initiation choices ──────────────────────────

export const WORKFLOW_SCOPE = {
  IntakeWorkflow: 893460200,
  ProjectGateset: 893460201,
} as const;

export const TARGET_ENTITY_TYPE = {
  Project: 893460210,
  Program: 893460211,
} as const;

export const CONVERSION_TARGET = {
  Project: 893460220,
  Program: 893460221,
} as const;

// ─── Intake workflow app settings keys ──────────────────────────────────────

export const SETTING_DEFAULT_INTAKE_WORKFLOW = 'pmo.default_intake_workflow_id';
export const SETTING_PROJECT_INTAKE_WORKFLOW = 'pmo.project_intake_workflow_id';
export const SETTING_PROGRAM_INTAKE_WORKFLOW = 'pmo.program_intake_workflow_id';
export const SETTING_INTAKE_ANALYTICS_RETENTION_DAYS = 'pmo.intake_analytics_retention_days';

// ─── Intake field labels (for admin stage configuration UI) ─────────────────

export const INTAKE_CONFIGURABLE_FIELDS: Record<string, string> = {
  pmo_name: 'Request Name',
  pmo_description: 'Description',
  pmo_businessjustification: 'Business Justification',
  pmo_submissiontext: 'Submission Text',
  pmo_lineofbusiness: 'Line of Business',
  pmo_requestedstartdate: 'Requested Start Date',
  pmo_targetcompletiondate: 'Target Completion Date',
  pmo_estimatedbudget: 'Estimated Budget',
  pmo_forecastedlaborhours: 'Forecasted Labor Hours',
  pmo_priority: 'Priority',
  pmo_requesttype: 'Request Type',
  // Real lookup column (set via pmo_TargetTeam@odata.bind on write)
  _pmo_targetteam_value: 'Primary Team',
  // Real lookup column (set via pmo_AffectedSystem@odata.bind on write)
  _pmo_affectedsystem_value: 'Affected System',
  // Holding-pen fields (stored in pmo_extractedfieldsjson under aip_intakeExtras
  // until real columns exist on pmo_projectrequest). See lib/intakeExtras.ts.
  'extras.projectManagerId': 'Project Manager',
  'extras.executiveSponsorId': 'Executive Sponsor',
  'extras.complexity': 'Complexity',
  'extras.strategicPriority': 'Strategic Priority',
  'extras.cfrCategory': 'CFR Category',
  // Optional msdyn_projectprogram lookup. Stamped on the resulting project
  // as msdyn_Program@odata.bind during conversion. Always rendered as
  // optional in the wizard regardless of stage config.
  'extras.targetProgramId': 'Program (optional)',
  // ─── Team-specific extras ────────────────────────────────────────────────
  // Naming convention: "<Team Display Name>: <Feature>" so reviewers can
  // tell at a glance which team owns a customization. Always-optional
  // fields carry "(Optional)" in the title (avoid duplicating it as
  // placeholder/hint text). See docs/team-feature-conventions.md.
  'extras.hpiIssueId':                 'Payer Initiative Team: HPI (Optional)',
  'extras.payerIssueIds':              'Payer Initiative Team: Payer Inquiries (Optional)',
  'extras.strategicAccountExecutiveId': 'Payer Initiative Team: Strategic Account Executive (Optional)',
} as const;

export const CONVERSION_INTAKE_FIELDS: Array<{ field: string; label: string; transform: 'direct' | 'odata_bind' }> = [
  { field: 'pmo_name', label: 'Request Name', transform: 'direct' },
  { field: 'pmo_description', label: 'Description', transform: 'direct' },
  { field: 'pmo_businessjustification', label: 'Business Justification', transform: 'direct' },
  { field: 'pmo_submissiontext', label: 'Submission Text', transform: 'direct' },
  { field: 'pmo_lineofbusiness', label: 'Line of Business', transform: 'direct' },
  { field: 'pmo_requestedstartdate', label: 'Requested Start Date', transform: 'direct' },
  { field: 'pmo_targetcompletiondate', label: 'Target Completion Date', transform: 'direct' },
  { field: 'pmo_estimatedbudget', label: 'Estimated Budget', transform: 'direct' },
  { field: 'pmo_forecastedlaborhours', label: 'Forecasted Labor Hours', transform: 'direct' },
  { field: 'pmo_priority', label: 'Priority', transform: 'direct' },
  { field: '_pmo_targetteam_value', label: 'Target Team', transform: 'odata_bind' },
  { field: '_pmo_affectedsystem_value', label: 'Affected System', transform: 'odata_bind' },
];

export const CONVERSION_PROJECT_FIELDS: Array<{ field: string; label: string; transform: 'direct' | 'odata_bind' }> = [
  { field: 'msdyn_subject', label: 'Project Name', transform: 'direct' },
  { field: 'msdyn_description', label: 'Description', transform: 'direct' },
  { field: 'msdyn_scheduledstart', label: 'Start Date', transform: 'direct' },
  { field: 'pmo_cfrcategory', label: 'CFR Category', transform: 'direct' },
  { field: 'pmo_complexity', label: 'Complexity', transform: 'direct' },
  { field: 'pmo_strategicpriority', label: 'Strategic Priority', transform: 'direct' },
  { field: 'proj_budget', label: 'Budget', transform: 'direct' },
  { field: 'pmo_forecastedlaborhours', label: 'Forecasted Labor Hours', transform: 'direct' },
  { field: 'pmo_PrimaryTeam@odata.bind', label: 'Primary Team', transform: 'odata_bind' },
  { field: 'msdyn_projectmanager@odata.bind', label: 'Project Manager', transform: 'odata_bind' },
  { field: 'proj_ExecutiveSponsor@odata.bind', label: 'Executive Sponsor', transform: 'odata_bind' },
];

export const ARTIFACT_TYPE_LABELS: Record<number, string> = {
  893460110: 'Business Case',
  893460111: 'Project Charter',
  893460112: 'RACI Matrix',
  893460113: 'Communication Plan',
  893460114: 'Risk Register',
  893460115: 'SOW',
  893460116: 'Budget',
  893460117: 'Closeout Report',
  893460118: 'Lessons Learned',
  893460119: 'Other',
} as const;

export const SP_LIBRARY_BASE_URL = 'https://aetnao365.sharepoint.com/sites/Nexus-PMO/AppDocuments';

export const SP_DOCUMENT_CATEGORIES = [
  'Business Case', 'Project Charter', 'RACI Matrix', 'Communication Plan',
  'Risk Register', 'SOW', 'Budget', 'Closeout Report', 'Lessons Learned',
  'Status Report', 'Meeting Notes', 'General', 'Other',
] as const;

/** pmo.tracking_labels_json: admin-configurable list of available tracking label strings.
 *  Stored as a JSON string array in pmo_appsettings. Default seeds one tag.
 *  Actual tracking rows live in pmo_tracking (Global CRUD for all CFR PMO users). */
export const SETTING_TRACKING_LABELS = 'pmo.tracking_labels_json';
export const DEFAULT_TRACKING_LABELS: string[] = ['Business Process'];

// ── UAT option sets ──────────────────────────────────────────────────────────
// Re-exported, not redefined. app/src/lib/uatOptionSets.ts is GENERATED from
// Nexus RCM - DEV by scripts/uat/Export-UatOptionSets.ps1 and is the only
// sanctioned origin for a UAT option integer (gate G-OPTINT). Never copy a value
// out of it into this file: every UAT set starts at the same base, so a stray
// number is a valid integer for the wrong column and nothing will complain.
export * from './uatOptionSets';