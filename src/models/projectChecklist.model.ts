/**
 * msdyn_projectchecklist — task checklist item.
 * Entity set: msdyn_projectchecklists
 * Schema confirmed from DEV environment 2026-04-18 (spike S6).
 * Write via PSS PssCreateV1 / PssUpdateV1 / PssDeleteV1.
 */
export interface ProjectChecklist {
  msdyn_projectchecklistid: string;
  msdyn_name: string;
  msdyn_projectchecklistcompleted: boolean;
  msdyn_projectchecklistorder: number;
  /** Optional due date (DateOnly), custom source only. YYYY-MM-DD or null. */
  dueDate?: string | null;
  '_msdyn_projecttaskid_value': string | null;
  statecode?: 0 | 1;
  createdon?: string;
}
