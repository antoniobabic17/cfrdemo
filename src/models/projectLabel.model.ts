/**
 * msdyn_projectlabel — project-scoped label definition.
 * Labels are auto-created per project (cannot be created/deleted via PSS; rename only).
 * Schema confirmed from spike S5 (2026-04-18).
 */
export interface ProjectLabel {
  msdyn_projectlabelid: string;
  msdyn_projectlabeltext: string;
  msdyn_colorindex: number;
  '_msdyn_projectid_value'?: string;
  statecode?: 0 | 1;
}

/**
 * msdyn_projecttasktolabel — junction entity linking a task to a label.
 * PSS: Create/Delete supported. Schema confirmed from spike S5b.
 */
export interface ProjectTaskToLabel {
  msdyn_projecttasktolabelid: string;
  msdyn_name?: string;
  '_msdyn_projectlabelid_value': string;
  '_msdyn_projecttaskid_value': string;
  statecode?: 0 | 1;
}
