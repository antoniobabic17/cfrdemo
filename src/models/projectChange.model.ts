/** msdyn_projectchange — PMO Accelerator change request record */
export interface ProjectChange {
  msdyn_projectchangeid: string;
  msdyn_name: string;
  msdyn_description?: string;
  msdyn_additionalcomments?: string;
  proj_changetype?: number;
  'proj_changetype@OData.Community.Display.V1.FormattedValue'?: string;
  proj_changeimpact?: number;
  'proj_changeimpact@OData.Community.Display.V1.FormattedValue'?: string;
  proj_changerisk?: number;
  'proj_changerisk@OData.Community.Display.V1.FormattedValue'?: string;
  proj_priority?: number;
  'proj_priority@OData.Community.Display.V1.FormattedValue'?: string;
  proj_approval?: number;
  'proj_approval@OData.Community.Display.V1.FormattedValue'?: string;
  proj_state?: number;
  'proj_state@OData.Community.Display.V1.FormattedValue'?: string;
  proj_costimpact?: number;
  proj_plannedstartdate?: string;
  proj_plannedduedate?: string;
  proj_requesteddate?: string;
  proj_changebenefits?: string;
  proj_changeplan?: string;
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;
  '_proj_assignedto_value'?: string;
  '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_requestedby_value'?: string;
  '_proj_requestedby_value@OData.Community.Display.V1.FormattedValue'?: string;
}
