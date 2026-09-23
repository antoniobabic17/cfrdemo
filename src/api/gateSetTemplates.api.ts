import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, WORKFLOW_SCOPE } from '../lib/constants';
import type { GateSetTemplate, GateSetTemplateCreate, GateSetTemplateUpdate, GateSetItem, GateSetItemCreate, GateSetItemUpdate } from '../models/gateSetTemplate.model';

const SET = ENTITY_SETS.gateSetTemplate;
const ITEM_SET = ENTITY_SETS.gateSetItem;

const TEMPLATE_SELECT = [
  'pmo_gatesettemplateid', 'pmo_name', 'pmo_description', 'pmo_cfrcategory',
  'pmo_isdefault', 'pmo_workflowscope', 'pmo_targetentitytype', 'pmo_conversionrulesjson', 'statecode',
];

const ITEM_SELECT = [
  'pmo_gatesetitemid', 'pmo_name', 'pmo_gatetype', 'pmo_gateorder', 'pmo_conditionsjson',
  'pmo_requiredfieldsjson', 'pmo_requiredartifacttypesjson', 'pmo_requiresapproval',
  'pmo_approvergroupid', 'pmo_stagelabel', '_pmo_gateset_value', 'statecode',
];

export async function listGateSetTemplates(): Promise<GateSetTemplate[]> {
  return dv.list<GateSetTemplate>(SET, {
    $select: TEMPLATE_SELECT,
    $filter: 'statecode eq 0',
    $orderby: 'pmo_name asc',
  });
}

export async function listIntakeWorkflows(): Promise<GateSetTemplate[]> {
  return dv.list<GateSetTemplate>(SET, {
    $select: TEMPLATE_SELECT,
    $filter: `pmo_workflowscope eq ${WORKFLOW_SCOPE.IntakeWorkflow} and statecode eq 0`,
    $orderby: 'pmo_name asc',
  });
}

export async function listProjectGateSets(): Promise<GateSetTemplate[]> {
  return dv.list<GateSetTemplate>(SET, {
    $select: TEMPLATE_SELECT,
    $filter: `pmo_workflowscope eq ${WORKFLOW_SCOPE.ProjectGateset} and statecode eq 0`,
    $orderby: 'pmo_name asc',
  });
}

export async function getGateSetTemplate(id: string): Promise<GateSetTemplate> {
  return dv.get<GateSetTemplate>(SET, id, TEMPLATE_SELECT);
}

export async function createGateSetTemplate(payload: GateSetTemplateCreate): Promise<GateSetTemplate> {
  return dv.create<GateSetTemplate>(SET, payload);
}

export async function updateGateSetTemplate(id: string, payload: GateSetTemplateUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function listGateSetItems(gateSetId: string): Promise<GateSetItem[]> {
  return dv.list<GateSetItem>(ITEM_SET, {
    $select: ITEM_SELECT,
    $filter: `_pmo_gateset_value eq '${gateSetId}' and statecode eq 0`,
    $orderby: 'pmo_gateorder asc',
  });
}

export async function createGateSetItem(payload: GateSetItemCreate): Promise<GateSetItem> {
  return dv.create<GateSetItem>(ITEM_SET, payload);
}

export async function updateGateSetItem(id: string, payload: GateSetItemUpdate): Promise<void> {
  return dv.update(ITEM_SET, id, payload);
}

export async function deleteGateSetItem(id: string): Promise<void> {
  return dv.update(ITEM_SET, id, { statecode: 1 });
}
