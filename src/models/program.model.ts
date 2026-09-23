/** msdyn_projectprogram — PMO Accelerator program entity */
export interface Program {
  msdyn_projectprogramid: string;
  // Auto-number (Dataverse-populated on Create). Format: PROG-{SEQNUM:00000}.
  // Existing rows backfilled via scripts/backfill-autonumber.py.
  pmo_programid?: string;
  msdyn_name: string;
  msdyn_description?: string;
  msdyn_businesscase?: string;
  msdyn_benefit?: number;
  msdyn_budget?: number;
  msdyn_roi?: number;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_modifiedby_value'?: string;
  '_modifiedby_value@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Schedule ──────────────────────────────────────────────────────────────
  proj_programstart?: string;
  proj_programdue?: string;

  // ── Classification ────────────────────────────────────────────────────────
  proj_state?: number;
  'proj_state@OData.Community.Display.V1.FormattedValue'?: string;
  proj_priority?: number;
  'proj_priority@OData.Community.Display.V1.FormattedValue'?: string;
  proj_programtype?: number;
  'proj_programtype@OData.Community.Display.V1.FormattedValue'?: string;
  proj_programgoals?: number;
  'proj_programgoals@OData.Community.Display.V1.FormattedValue'?: string;
  proj_businessunit?: number;
  'proj_businessunit@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Health ────────────────────────────────────────────────────────────────
  proj_overallhealth?: number;
  'proj_overallhealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_efforthealth?: number;
  'proj_efforthealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_financialhealth?: number;
  'proj_financialhealth@OData.Community.Display.V1.FormattedValue'?: string;
  proj_schedulehealth?: number;
  'proj_schedulehealth@OData.Community.Display.V1.FormattedValue'?: string;

  // ── Project rollups ───────────────────────────────────────────────────────
  proj_activeprojects?: number;
  proj_projectsontrack?: number;
  proj_projectsatrisk?: number;
  proj_projectsintrouble?: number;

  // ── Financial rollups ─────────────────────────────────────────────────────
  proj_projectbudget?: number;
  proj_projectactualcost?: number;
  proj_projectbenefits?: number;
  proj_remainingbudget?: number;

  // ── Governance ────────────────────────────────────────────────────────────
  '_proj_manager_value'?: string;
  '_proj_manager_value@OData.Community.Display.V1.FormattedValue'?: string;
}

/** Payload for PATCH updates on msdyn_projectprogram */
export type ProgramUpdate = {
  msdyn_name?: string;
  msdyn_description?: string;
  msdyn_businesscase?: string;
  msdyn_benefit?: number;
  msdyn_budget?: number;
  msdyn_roi?: number;
  proj_programstart?: string;
  proj_programdue?: string;
  // Choice fields — null explicitly clears the field in Dataverse
  proj_state?: number | null;
  proj_priority?: number | null;
  proj_programtype?: number | null;
  proj_programgoals?: number | null;
  proj_businessunit?: number | null;
  proj_overallhealth?: number | null;
  proj_efforthealth?: number | null;
  proj_financialhealth?: number | null;
  proj_schedulehealth?: number | null;
  // Lookup bind — use NavigationPropertyName (PascalCase schema name)
  'proj_Manager@odata.bind'?: string | null;
};
