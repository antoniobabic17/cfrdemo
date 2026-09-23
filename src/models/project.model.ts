/** msdyn_project — P4W core + PMO Accelerator (proj_*) + CFR custom (pmo_*) */
export interface Project {
  msdyn_projectid: string;
  msdyn_subject: string;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_modifiedby_value'?: string;
  '_modifiedby_value@OData.Community.Display.V1.FormattedValue'?: string;
  ownerid?: string;
  'ownerid@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Description / narrative ────────────────────────────────────────────────
  msdyn_description?: string;
  msdyn_businesscase?: string;          // Business case tab
  msdyn_valuestatement?: string;        // Business case tab
  msdyn_comments?: string;

  // ── Schedule ───────────────────────────────────────────────────────────────
  msdyn_scheduledstart?: string;        // plan start
  msdyn_finish?: string;                // plan end — NOT msdyn_scheduledend (does not exist).
                                        // P4W/PSS-owned; computed from tasks. Reads
                                        // `msdyn_scheduledstart` on project create if
                                        // no tasks exist yet. Detail page renders "—"
                                        // for the "Task Finish Date" row when
                                        // tasks.length === 0 to avoid presenting the
                                        // scheduled-start bleed-through as a real finish.
  proj_scheduledcompletion?: string;    // The requester's original target-completion
                                        // date captured on intake. Set by
                                        // buildProjectPayload from
                                        // pmo_targetcompletiondate. Persisted here so
                                        // the Details tab can show the intake ask
                                        // alongside msdyn_finish (which PSS overwrites
                                        // as tasks land). DateOnly, behavior=1.
  proj_actualfinishdate?: string;       // Manual, PMO-owned finish date the operator
                                        // edits on the Details tab ("Finish Date"),
                                        // distinct from the task-derived msdyn_finish
                                        // shown as "Task Finish Date". PSS never touches
                                        // it. DateOnly, behavior=1. Custom source maps
                                        // this to pmo_actualfinishdate.
  msdyn_duration?: number;
  msdyn_progress?: number;              // 0–100
  msdyn_effort?: number;
  msdyn_effortcompleted?: number;
  msdyn_effortremaining?: number;
  msdyn_hoursperday?: number;
  msdyn_hoursperweek?: number;
  msdyn_dayspermonth?: number;
  msdyn_schedulemode?: number;
  'msdyn_schedulemode@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Accelerator classification (proj_) ────────────────────────────────────
  proj_stage?: number;
  'proj_stage@OData.Community.Display.V1.FormattedValue'?: string;
  proj_state?: number;
  'proj_state@OData.Community.Display.V1.FormattedValue'?: string;
  proj_priority?: number;
  'proj_priority@OData.Community.Display.V1.FormattedValue'?: string;
  proj_projecttype?: number;
  'proj_projecttype@OData.Community.Display.V1.FormattedValue'?: string;
  proj_businessunit?: number;
  'proj_businessunit@OData.Community.Display.V1.FormattedValue'?: string;
  proj_fundingavailable?: boolean;
  proj_fundingsource?: number;
  'proj_fundingsource@OData.Community.Display.V1.FormattedValue'?: string;
  proj_needsstaffing?: boolean;

  // ── Accelerator health (proj_) ────────────────────────────────────────────
  proj_overallhealth?: number;          // On Track=189330000, At Risk=189330001, Off Track=189330002
  'proj_overallhealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_efforthealth?: number;
  'proj_efforthealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_financialhealth?: number;
  'proj_financialhealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_schedulehealth?: number;
  'proj_schedulehealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_issuehealth?: number;
  'proj_issuehealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_activerisks?: number;            // rollup
  proj_activeissues?: number;           // rollup
  proj_activechanges?: number;          // rollup

  // ── Accelerator financials (proj_) ────────────────────────────────────────
  proj_budget?: number;
  proj_actualcost?: number;
  proj_forecast?: number;
  proj_remainingbudget?: number;
  proj_budgetvariance?: number;
  proj_benefits?: number;
  proj_roi?: number;
  proj_prioritizationscore?: number;

  // ── Accelerator strategic scoring / Business case (proj_) ─────────────────
  proj_strategicalignment?: number;
  'proj_strategicalignment@OData.Community.Display.V1.FormattedValue'?: string;
  proj_strategicalignmentscore?: number;
  proj_improveemployeeretention?: number;
  'proj_improveemployeeretention@OData.Community.Display.V1.FormattedValue'?: string;
  proj_improveemployeeretentionscore?: number;
  proj_lowercost?: number;
  'proj_lowercost@OData.Community.Display.V1.FormattedValue'?: string;
  proj_lowercostscore?: number;
  proj_risk?: number;
  'proj_risk@OData.Community.Display.V1.FormattedValue'?: string;
  proj_riskscore?: number;

  // ── Lookup fields (use _fieldname_value in $select) ───────────────────────
  '_msdyn_msprojectdocument_value'?: string;   // Planner plan GUID (nullable until opened in P4W)
  '_msdyn_projectmanager_value'?: string;
  '_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_msdyn_program_value'?: string;
  '_msdyn_program_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_executivesponsor_value'?: string;
  '_proj_executivesponsor_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_manager_value'?: string;
  '_proj_manager_value@OData.Community.Display.V1.FormattedValue'?: string;

  // ── CFR custom extension (pmo_) ───────────────────────────────────────────
  // Auto-number (Dataverse-populated on Create). Format: PROJ-{SEQNUM:00000}.
  // Existing rows backfilled via scripts/backfill-project-autonumber.py.
  pmo_projectid?: string;
  '_pmo_primaryteam_value'?: string;
  '_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_requestsource_value'?: string;
  '_pmo_requestsource_value@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_cfrcategory?: number;
  'pmo_cfrcategory@OData.Community.Display.V1.FormattedValue'?: string;
  // Affected Systems — standardized multi-select Choice (comma-joined option values).
  pmo_affectedsystems?: string;
  'pmo_affectedsystems@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_complexity?: number;
  'pmo_complexity@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_strategicpriority?: number;
  'pmo_strategicpriority@OData.Community.Display.V1.FormattedValue'?: string;
  // HPI lookup — renamed from pmo_hpiissue to pmo_payerinitiatives_hpiissue.
  '_pmo_payerinitiatives_hpiissue_value'?: string;
  '_pmo_payerinitiatives_hpiissue_value@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_legacyprojectid?: string;
  // Executive summary (memo) + project status (5-value choice) — Payer
  // Initiatives migration fields on pmo_project (custom source only).
  pmo_executivesummary?: string;
  pmo_projectstatus?: number;
  'pmo_projectstatus@OData.Community.Display.V1.FormattedValue'?: string;
  // ── Payer Initiatives team-feature extensions ────────────────────────────
  '_pmo_payerinitiatives_strategicaccountexecutive_value'?: string;
  '_pmo_payerinitiatives_strategicaccountexecutive_value@OData.Community.Display.V1.FormattedValue'?: string;
  // SAE direct-AAD identity snapshot (object id + name + email). New
  // writes target these; the lookup above is a read fallback only.
  pmo_payerinitiatives_saeaadobjectid?: string;
  pmo_payerinitiatives_saedisplayname?: string;
  pmo_payerinitiatives_saeemail?: string;
  // ── New Resource Model (per-project toggle) ───────────────────────────────
  // Top-down hours estimate captured at intake, editable on Project Detail.
  pmo_forecastedlaborhours?: number;
  // App-computed rollups (stored so they are sortable/filterable/exportable).
  pmo_currenttotalhours?: number;
  pmo_currentcompletedhours?: number;
  // Toggle: when false/unset the project behaves exactly as it does today.
  pmo_usenewresourcemodel?: boolean;
  // Resource Metric Type: Labor (track hours) vs Financial (track budget).
  // See RESOURCE_METRIC_TYPE. Null is treated as Labor by the app.
  pmo_resourcemetrictype?: number;
  'pmo_resourcemetrictype@OData.Community.Display.V1.FormattedValue'?: string;
}

/** Payload for PATCH updates on msdyn_project */
export type ProjectUpdate = Partial<
  Pick<
    Project,
    | 'msdyn_subject'
    | 'msdyn_description'
    | 'msdyn_scheduledstart'
    | 'msdyn_finish'
    | 'proj_scheduledcompletion'
    | 'proj_actualfinishdate'
    | 'msdyn_businesscase'
    | 'msdyn_valuestatement'
    | 'msdyn_comments'
    | 'proj_priority'
    | 'proj_stage'
    | 'proj_projecttype'
    | 'proj_businessunit'
    | 'proj_fundingavailable'
    | 'proj_fundingsource'
    | 'proj_budget'
    | 'proj_forecast'
    | 'proj_actualcost'
    | 'proj_benefits'
  >
> & {
  // CFR classification allows null to explicitly clear the field in Dataverse
  pmo_cfrcategory?: number | null;
  pmo_complexity?: number | null;
  pmo_strategicpriority?: number | null;
  // Affected Systems multi-select: comma-joined option values, or null to clear.
  pmo_affectedsystems?: string | null;
  // Health indicators — null clears; same 189330000/189330001/189330002 scale as proj_overallhealth
  proj_overallhealth?: number | null;
  proj_schedulehealth?: number | null;
  proj_efforthealth?: number | null;
  proj_financialhealth?: number | null;
  proj_issuehealth?: number | null;
  // Lookup binds — use NavigationPropertyName (PascalCase schema name, not logical name)
  'msdyn_projectmanager@odata.bind'?: string | null;
  'pmo_PrimaryTeam@odata.bind'?: string | null;
  'pmo_RequestSource@odata.bind'?: string | null;
  'msdyn_Program@odata.bind'?: string | null;
  'proj_ExecutiveSponsor@odata.bind'?: string | null;
  'proj_Manager@odata.bind'?: string | null;
  'pmo_PayerInitiatives_HpiIssue@odata.bind'?: string | null;
  'pmo_PayerInitiatives_StrategicAccountExecutive@odata.bind'?: string | null;
  // SAE direct-AAD write columns (null clears). Preferred over the bind above.
  pmo_payerinitiatives_saeaadobjectid?: string | null;
  pmo_payerinitiatives_saedisplayname?: string | null;
  pmo_payerinitiatives_saeemail?: string | null;
  // Payer Initiatives migration fields (custom source)
  pmo_executivesummary?: string | null;
  pmo_projectstatus?: number | null;
  // New Resource Model — null clears the numeric fields.
  pmo_forecastedlaborhours?: number | null;
  pmo_currenttotalhours?: number | null;
  pmo_currentcompletedhours?: number | null;
  pmo_usenewresourcemodel?: boolean | null;
  // Resource Metric Type — null clears; Labor/Financial per RESOURCE_METRIC_TYPE.
  pmo_resourcemetrictype?: number | null;
};
