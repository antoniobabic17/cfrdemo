/**
 * Demo choice-label registry.
 *
 * Real Dataverse returns choice/option-set labels via the
 * `<field>@OData.Community.Display.V1.FormattedValue` annotation. The demo store
 * (demoStore.synthesizeChoiceLabels) stamps these annotations onto fixture rows
 * on read, so fixtures only carry the integer CODE and the UI still renders the
 * human label (Health, Stage, Priority, Status, …) instead of a bare number or
 * an empty `—`.
 *
 * Codes MUST match the option-set values in src/lib/constants.ts (the app's
 * single source of truth for these enums). Labels mirror what PROD Dataverse
 * returns for each value.
 *
 * The registry is keyed by the RAW column logical name (pmo_ on the custom
 * source AND the proj_ / msdyn_ twins the normalizers copy to), so a synthesized
 * annotation is present no matter which key a surface reads.
 */

const HEALTH: Record<number, string> = {
  189330000: 'On Track',
  189330001: 'At Risk',
  189330002: 'Off Track',
};

// proj_state / risk / issue / change share one enum (ACCEL_STATE / RISK_STATE).
const ACCEL_STATE: Record<number, string> = {
  189330000: 'Proposed',
  189330001: 'Active',
  189330002: 'Closed',
  189330003: 'On Hold',
};

const ACCEL_PRIORITY: Record<number, string> = {
  189330000: 'Critical',
  189330001: 'High',
  189330002: 'Moderate',
  189330003: 'Low',
};

const RISK_CATEGORY: Record<number, string> = {
  189330000: 'Stakeholder',
  189330001: 'Scope',
  189330002: 'Change',
  189330003: 'Resources',
  189330004: 'Design',
  189330005: 'Technical',
  189330006: 'Other',
};

const ISSUE_CATEGORY: Record<number, string> = {
  189330000: 'Issue',
  189330001: 'Task',
  189330002: 'Bug',
  189330003: 'Other',
};

const CHANGE_TYPE: Record<number, string> = {
  189330000: 'Scope',
  189330001: 'Schedule',
  189330002: 'Cost',
  189330003: 'None',
};

const PROJECT_STATUS: Record<number, string> = {
  508640000: 'New',
  508640001: 'In-Progress',
  508640003: 'On-Hold',
  508640004: 'Complete',
  508640005: 'Cancelled',
};

// proj_stage (msdyn Accelerator project stage). Real DEV values.
const PROJECT_STAGE: Record<number, string> = {
  192350000: 'New',
  192350001: 'Planning',
  192350002: 'Execution',
  192350003: 'Closeout',
};

const PROJECT_TYPE: Record<number, string> = {
  189330000: 'Customer',
  189330001: 'Internal',
  189330002: 'Compliance',
  189330003: 'Other',
};

const BUSINESS_UNIT: Record<number, string> = {
  189330000: 'Enteral',
  189330001: 'Epic',
  189330002: 'Infusion (Legacy)',
  153480001: 'Medicare',
};

const PROG_TYPE: Record<number, string> = {
  189330000: 'Customer',
  189330001: 'Development',
  189330002: 'Support',
  189330003: 'Enhancement',
  189330004: 'Program',
  189330005: 'Other',
};

const COMPLEXITY: Record<number, string> = {
  893460060: 'Low',
  893460061: 'Medium',
  893460062: 'High',
  893460063: 'Critical',
};

const STRATEGIC_PRIORITY: Record<number, string> = {
  893460070: 'Must Have',
  893460071: 'Should Have',
  893460072: 'Nice To Have',
};

const CFR_CATEGORY: Record<number, string> = {
  893460050: 'IT Infrastructure',
  893460051: 'Finance Systems',
  893460052: 'Compliance',
  893460053: 'Data & Analytics',
  893460054: 'Operations',
  893460055: 'General',
};

const GATE_TYPE: Record<number, string> = {
  893460090: 'Initiation',
  893460091: 'Planning',
  893460092: 'Execution',
  893460093: 'Closeout',
};

const GATE_STATUS: Record<number, string> = {
  893460094: 'Not Started',
  893460095: 'In Progress',
  893460096: 'Passed',
  893460097: 'Failed',
  893460098: 'Waived',
};

const DECISION_STATUS: Record<number, string> = {
  893460150: 'Proposed',
  893460151: 'Approved',
  893460152: 'Rejected',
  893460153: 'Deferred',
};

const DECISION_IMPACT: Record<number, string> = {
  893460154: 'High',
  893460155: 'Medium',
  893460156: 'Low',
};

const CHANGE_IMPACT: Record<number, string> = {
  189330000: 'High',
  189330001: 'Medium',
  189330002: 'Low',
};

const CHANGE_APPROVAL: Record<number, string> = {
  189330000: 'Not Yet Requested',
  189330001: 'Requested',
  189330002: 'Approved',
  189330003: 'Rejected',
};

const FEEDBACK_TYPE: Record<number, string> = {
  893460000: 'Bug',
  893460001: 'Enhancement',
};

const FEEDBACK_STATUS: Record<number, string> = {
  893460010: 'New',
  893460011: 'In Review',
  893460012: 'Planned',
  893460013: 'In Progress',
  893460014: 'Resolved',
  893460015: 'Declined',
};

const REQUEST_STATUS: Record<number, string> = {
  893460020: 'Draft',
  893460021: 'Submitted',
  893460022: 'In Triage',
  893460023: 'Approved',
  893460024: 'Rejected',
  893460029: 'Cancelled',
};

/**
 * column logical name → (code → label). A field appears under every key a
 * surface might read it as (the custom pmo_ source AND the proj_ / msdyn_ twins
 * the normalizers bridge to), so the synthesized FormattedValue is always found.
 */
export const CHOICE_LABELS: Record<string, Record<number, string>> = {
  // Health (all five health columns, both pmo_ and proj_ twins)
  pmo_overallhealth: HEALTH, proj_overallhealth: HEALTH,
  pmo_efforthealth: HEALTH, proj_efforthealth: HEALTH,
  pmo_financialhealth: HEALTH, proj_financialhealth: HEALTH,
  pmo_schedulehealth: HEALTH, proj_schedulehealth: HEALTH,
  pmo_issuehealth: HEALTH, proj_issuehealth: HEALTH,
  // Project stage / state / type / BU / status
  pmo_stage: PROJECT_STAGE, proj_stage: PROJECT_STAGE,
  pmo_state: ACCEL_STATE, proj_state: ACCEL_STATE,
  pmo_projecttype: PROJECT_TYPE, proj_projecttype: PROJECT_TYPE,
  pmo_businessunit: BUSINESS_UNIT, proj_businessunit: BUSINESS_UNIT,
  pmo_projectstatus: PROJECT_STATUS,
  pmo_priority: ACCEL_PRIORITY, proj_priority: ACCEL_PRIORITY,
  pmo_complexity: COMPLEXITY,
  pmo_strategicpriority: STRATEGIC_PRIORITY,
  pmo_cfrcategory: CFR_CATEGORY,
  // Program
  pmo_programtype: PROG_TYPE, proj_programtype: PROG_TYPE,
  // Monitor twins (risk/issue/change) — priority + state shared
  pmo_category: RISK_CATEGORY,
  pmo_issuecategory: ISSUE_CATEGORY,
  pmo_changetype: CHANGE_TYPE,
  pmo_changeimpact: CHANGE_IMPACT,
  pmo_approval: CHANGE_APPROVAL,
  // Gates
  pmo_gatetype: GATE_TYPE,
  pmo_status: GATE_STATUS, // pmo_projectgate.pmo_status (gate status)
  // Decisions
  pmo_impact: DECISION_IMPACT,
  // Feedback
  pmo_feedbacktype: FEEDBACK_TYPE,
  // Intake request status handled elsewhere (kept for completeness)
};

/**
 * Per-entity overrides where the SAME column name means different enums on
 * different tables (e.g. pmo_status is gate-status on pmo_projectgate but
 * request-status on pmo_projectrequest, decision-status on pmo_projectdecision,
 * feedback-status on pmo_userfeedback). Keyed by `${entitySet}.${field}`.
 */
export const CHOICE_LABELS_BY_ENTITY: Record<string, Record<number, string>> = {
  'pmo_projectrequests.pmo_status': REQUEST_STATUS,
  'pmo_userfeedbacks.pmo_status': FEEDBACK_STATUS,
  'pmo_projectdecisions.pmo_status': DECISION_STATUS,
  'pmo_projectgates.pmo_status': GATE_STATUS,
};
