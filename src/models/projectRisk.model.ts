/** msdyn_projectrisk — PMO Accelerator risk record */
export interface ProjectRisk {
  msdyn_projectriskid: string;
  msdyn_name: string;
  msdyn_subject?: string;               // risk title (separate from name)
  msdyn_description?: string;
  msdyn_contingencyplan?: string;
  msdyn_mitigationplan?: string;
  msdyn_riskprobability?: number;       // P4W native probability (decimal)
  proj_impact?: number;                 // 1–5 scale
  proj_probability?: number;            // 1–5 scale
  proj_exposure?: number;
  proj_cost?: number;
  proj_costexposure?: number;
  proj_due?: string;
  proj_category?: number;
  'proj_category@OData.Community.Display.V1.FormattedValue'?: string;
  proj_state?: number;
  'proj_state@OData.Community.Display.V1.FormattedValue'?: string;
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;
  '_proj_assignedto_value'?: string;
  '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
}
