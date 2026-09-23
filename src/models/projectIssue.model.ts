/** msdyn_projectissue — PMO Accelerator issue record */
export interface ProjectIssue {
  msdyn_projectissueid: string;
  msdyn_name: string;
  msdyn_description?: string;
  msdyn_resolution?: string;
  proj_duedate?: string;
  proj_issuecategory?: number;
  'proj_issuecategory@OData.Community.Display.V1.FormattedValue'?: string;
  proj_priority?: number;
  'proj_priority@OData.Community.Display.V1.FormattedValue'?: string;
  proj_state?: number;
  'proj_state@OData.Community.Display.V1.FormattedValue'?: string;
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;
  '_proj_assignedto_value'?: string;
  '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_requestor_value'?: string;
  '_proj_requestor_value@OData.Community.Display.V1.FormattedValue'?: string;
}
