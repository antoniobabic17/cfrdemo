/** pmo_projectgate — lifecycle governance gates */
export interface ProjectGate {
  pmo_projectgateid: string;
  pmo_name: string;
  pmo_gatetype: number;
  pmo_gateorder: number;
  pmo_status: number;
  pmo_targetdate?: string;
  pmo_completeddate?: string;
  pmo_notes?: string;
  pmo_rationale?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_owner_value'?: string;
  '_pmo_owner_value@OData.Community.Display.V1.FormattedValue'?: string;
}

export type ProjectGateCreate = {
  pmo_name: string;
  pmo_gatetype: number;
  pmo_gateorder: number;
  pmo_status: number;
  pmo_targetdate?: string;
  pmo_notes?: string;
  'pmo_Project@odata.bind': string;
  'pmo_Owner@odata.bind'?: string;
};

export type ProjectGateUpdate = Partial<
  Pick<ProjectGate, 'pmo_name' | 'pmo_status' | 'pmo_targetdate' | 'pmo_completeddate' | 'pmo_notes'>
> & { 'pmo_Owner@odata.bind'?: string | null; pmo_rationale?: string };

/** pmo_projectgatedecision — gate approval decisions */
export interface ProjectGateDecision {
  pmo_projectgatedecisionid: string;
  pmo_name: string;
  pmo_decision: number;
  pmo_decisiondate: string;
  pmo_notes?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_gate_value'?: string;
  '_pmo_decidedby_value'?: string;
  '_pmo_decidedby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

export type ProjectGateDecisionCreate = {
  pmo_name: string;
  pmo_decision: number;
  pmo_decisiondate: string;
  pmo_notes?: string;
  'pmo_Gate@odata.bind': string;
  'pmo_DecidedBy@odata.bind': string;
};
