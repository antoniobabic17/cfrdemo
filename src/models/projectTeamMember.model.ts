/**
 * msdyn_projectteam — P4W native project resource record.
 * NOT to be confused with pmo_projectteam (CFR custom org-team junction).
 * The logical entity name is msdyn_projectteam; entity set is msdyn_projectteams.
 */
export interface ProjectTeamMember {
  msdyn_projectteamid: string;
  msdyn_name?: string;
  msdyn_effort?: number;
  msdyn_effortcompleted?: number;
  msdyn_effortremaining?: number;
  msdyn_hours?: number;
  msdyn_requiredhours?: number;
  msdyn_hardbookedhours?: number;
  msdyn_softbookedhours?: number;
  msdyn_percentage?: number;            // allocation %
  msdyn_start?: string;
  msdyn_finish?: string;
  msdyn_projectapprover?: boolean;
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;
  '_msdyn_bookableresourceid_value'?: string;
  '_msdyn_bookableresourceid_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_msdyn_resourcecategory_value'?: string;
  '_msdyn_resourcecategory_value@OData.Community.Display.V1.FormattedValue'?: string;  // role/title
}
