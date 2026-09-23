/**
 * msdyn_projectsprint — sprint entity.
 * Schema field names confirmed via S8 runtime query (2026-04-18).
 * Standard P4W scheduling entity: Create/Update/Delete via PSS.
 */
export interface ProjectSprint {
  msdyn_projectsprintid: string;
  msdyn_name?: string;
  msdyn_start?: string;
  msdyn_finish?: string;
  '_msdyn_project_value'?: string;
  statecode?: 0 | 1;
  // Additional fields will be discovered at runtime via OData
  [key: string]: unknown;
}
