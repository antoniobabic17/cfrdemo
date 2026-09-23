export interface GateSetTemplate {
  pmo_gatesettemplateid: string;
  pmo_name: string;
  pmo_description?: string;
  pmo_cfrcategory?: number;
  pmo_isdefault?: boolean;
  pmo_workflowscope?: number;
  pmo_targetentitytype?: number;
  pmo_conversionrulesjson?: string;
  statecode?: 0 | 1;
}

export type GateSetTemplateCreate = Pick<
  GateSetTemplate,
  'pmo_name' | 'pmo_description' | 'pmo_cfrcategory' | 'pmo_isdefault' | 'pmo_workflowscope' | 'pmo_targetentitytype' | 'pmo_conversionrulesjson'
>;

export type GateSetTemplateUpdate = Partial<GateSetTemplateCreate> & {
  statecode?: 0 | 1;
};

export interface GateSetItem {
  pmo_gatesetitemid: string;
  pmo_name: string;
  pmo_gatetype: number;
  pmo_gateorder: number;
  pmo_conditionsjson?: string;
  pmo_requiredfieldsjson?: string;
  pmo_requiredartifacttypesjson?: string;
  pmo_requiresapproval?: boolean;
  pmo_approvergroupid?: string;
  pmo_stagelabel?: string;
  statecode?: 0 | 1;
  '_pmo_gateset_value'?: string;
}

export type GateSetItemCreate = {
  pmo_name: string;
  pmo_gatetype: number;
  pmo_gateorder: number;
  pmo_conditionsjson?: string;
  pmo_requiredfieldsjson?: string;
  pmo_requiredartifacttypesjson?: string;
  pmo_requiresapproval?: boolean;
  pmo_approvergroupid?: string;
  pmo_stagelabel?: string;
  'pmo_GateSet@odata.bind': string;
};

export type GateSetItemUpdate = Partial<Omit<GateSetItemCreate, 'pmo_GateSet@odata.bind'>> & {
  statecode?: 0 | 1;
};
