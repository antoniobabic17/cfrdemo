export interface ProjectDecision {
  pmo_projectdecisionid: string;
  pmo_name: string;
  pmo_description: string;
  pmo_decisiondate: string;
  pmo_status: number;
  pmo_impact?: number;
  pmo_rationale?: string;
  pmo_impactdescription?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_decisionowner_value'?: string;
  '_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_project_value'?: string;
  '_pmo_program_value'?: string;
  '_pmo_meetinglink_value'?: string;
}

export type ProjectDecisionCreate = {
  pmo_name: string;
  pmo_description: string;
  pmo_decisiondate: string;
  pmo_status: number;
  pmo_impact?: number;
  pmo_rationale?: string;
  pmo_impactdescription?: string;
  'pmo_DecisionOwner@odata.bind'?: string;
  /** The msdyn_project shell lookup (pss mode). */
  'pmo_Project@odata.bind'?: string;
  /**
   * The pmo_project lookup (custom mode). Declared because `useCreateProjectDecision` and
   * `UatBypassDialog` both emit it through `projectBind`, and it exists in the environment:
   * `pmo_projectref` on pmo_projectdecision targets `pmo_project`. Its absence from this type
   * is what made the write look unsafe. Asymmetry worth naming rather than fixing blind: the
   * eight sibling sidecar create-types (gate, baseline, closeout, team, meeting link, required
   * artifact, notification, telemetry) still declare only the shell bind while their APIs use
   * the same helper, so the same gap is latent there.
   */
  'pmo_ProjectRef@odata.bind'?: string;
  'pmo_Program@odata.bind'?: string;
  'pmo_MeetingLink@odata.bind'?: string;
};

export type ProjectDecisionUpdate = Partial<
  Pick<ProjectDecision, 'pmo_name' | 'pmo_description' | 'pmo_status' | 'pmo_impact' | 'pmo_rationale' | 'pmo_impactdescription'>
> & {
  'pmo_DecisionOwner@odata.bind'?: string | null;
  'pmo_MeetingLink@odata.bind'?: string | null;
};
