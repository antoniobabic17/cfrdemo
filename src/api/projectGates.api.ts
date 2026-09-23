import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE, projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectGate, ProjectGateCreate, ProjectGateUpdate, ProjectGateDecision, ProjectGateDecisionCreate } from '../models/projectGate.model';

const GATE_SET = ENTITY_SETS.projectGate;
const DECISION_SET = ENTITY_SETS.projectGateDecision;

const GATE_FIELDS: string[] = [
  'pmo_projectgateid', 'pmo_name', 'pmo_gatetype', 'pmo_gateorder',
  'pmo_status', 'pmo_targetdate', 'pmo_completeddate', 'pmo_notes',
  'statecode', 'createdon', '_pmo_owner_value',
  ...PROJECT_VALUE_SELECT,
];

const DECISION_FIELDS: (keyof ProjectGateDecision)[] = [
  'pmo_projectgatedecisionid', 'pmo_name', 'pmo_decision',
  'pmo_decisiondate', 'pmo_notes', 'statecode', 'createdon',
  '_pmo_gate_value', '_pmo_decidedby_value',
];

export async function listProjectGates(projectId: string): Promise<ProjectGate[]> {
  return dv.list<ProjectGate>(GATE_SET, {
    $select: GATE_FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_gateorder asc',
  });
}

export async function createProjectGate(payload: ProjectGateCreate): Promise<ProjectGate> {
  const created = await dv.create<ProjectGate>(GATE_SET, payload);
  void touchCustomProject(projectIdFromBindPayload(payload as unknown as Record<string, unknown>) ?? '');
  return created;
}

export async function updateProjectGate(id: string, payload: ProjectGateUpdate): Promise<void> {
  await dv.update(GATE_SET, id, payload);
  void touchProjectFromChild(GATE_SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
}

export async function listGateDecisions(gateId: string): Promise<ProjectGateDecision[]> {
  return dv.list<ProjectGateDecision>(DECISION_SET, {
    $select: DECISION_FIELDS,
    $filter: `_pmo_gate_value eq '${gateId}' and statecode eq 0`,
    $orderby: 'pmo_decisiondate desc',
  });
}

export async function createGateDecision(payload: ProjectGateDecisionCreate): Promise<ProjectGateDecision> {
  return dv.create<ProjectGateDecision>(DECISION_SET, payload);
}
