import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE, projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectDecision, ProjectDecisionCreate, ProjectDecisionUpdate } from '../models/projectDecision.model';

const SET = ENTITY_SETS.projectDecision;
const FIELDS: string[] = [
  'pmo_projectdecisionid', 'pmo_name', 'pmo_description', 'pmo_decisiondate',
  'pmo_status', 'pmo_impact', 'statecode', 'createdon',
  '_pmo_decisionowner_value', '_pmo_program_value', '_pmo_meetinglink_value',
  ...PROJECT_VALUE_SELECT,
];

function shortId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export async function listProjectDecisions(projectId: string): Promise<ProjectDecision[]> {
  return dv.list<ProjectDecision>(SET, {
    $select: FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_decisiondate desc',
  });
}

export async function createProjectDecision(payload: ProjectDecisionCreate): Promise<ProjectDecision> {
  const resolved: ProjectDecisionCreate = {
    ...payload,
    pmo_name: `DECISION-${shortId()}`,
  };
  void touchCustomProject(projectIdFromBindPayload(resolved as unknown as Record<string, unknown>) ?? '');
  return dv.create<ProjectDecision>(SET, resolved);
}

export async function updateProjectDecision(id: string, payload: ProjectDecisionUpdate): Promise<void> {
  await dv.update(SET, id, payload);
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
}

export async function deactivateProjectDecision(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE);
  await dv.deactivate(SET, id);
}
