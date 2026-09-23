/** msdyn_projectstatusreport — PMO Accelerator status report */
export interface StatusReport {
  msdyn_projectstatusreportid: string;
  msdyn_name: string;
  msdyn_accomplishedactivities?: string;
  msdyn_plannedactivities?: string;
  msdyn_additionalcomments?: string;
  proj_reportingdate?: string;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;

  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_msdyn_project_value'?: string;
  '_msdyn_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_submittedto_value'?: string;
  '_proj_submittedto_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_proj_submitter_value'?: string;
  '_proj_submitter_value@OData.Community.Display.V1.FormattedValue'?: string;
}
