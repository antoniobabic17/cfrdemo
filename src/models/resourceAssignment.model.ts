export interface ResourceAssignment {
  msdyn_resourceassignmentid: string;
  '_msdyn_taskid_value': string | null;
  '_msdyn_projectteamid_value': string | null;
  '_msdyn_projectid_value': string | null;
  '_msdyn_projectteamid_value@OData.Community.Display.V1.FormattedValue'?: string;
  msdyn_name?: string;
  statecode?: number;
  /**
   * Custom-source (Option-C) assignee identity. On pmo.task_source='custom'
   * the assignment stores the assignee as a direct systemuser lookup
   * (pmo_taskassignment.pmo_user) instead of relying on the P4W
   * projectteam -> bookableresource -> systemuser chain, so team members
   * without a P4W bookable resource can still be assigned. Undefined on the
   * PSS path (identity flows through the projectteam/BR chain there).
   */
  assigneeUserId?: string | null;
  /** Formatted display name of the pmo_user assignee (custom source). */
  assigneeUserName?: string;
  /**
   * Per-assignment contributed hours (New Resource Model only). Stored in
   * pmo_taskassignment.pmo_contributedhours. Undefined on the PSS path and on
   * custom-source projects with the new model OFF. Sum across all assignees on
   * a task = that task's calculated "Hours Done" when the new model is ON.
   */
  contributedHours?: number;
}
