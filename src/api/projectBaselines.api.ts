import * as dv from '../lib/dataverseClient';
import { touchCustomProject } from './customProjects.api';
import { projectMatch, PROJECT_VALUE_SELECT } from '../lib/projectLookupRef';
import { projectIdFromBindPayload } from '../lib/projectLookupRef';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectBaseline, ProjectBaselineCreate } from '../models/projectBaseline.model';

const SET = ENTITY_SETS.projectBaseline;
const FIELDS: string[] = [
  'pmo_projectbaselineid', 'pmo_name', 'pmo_captureddate',
  'pmo_baselinestart', 'pmo_finish', 'pmo_budget', 'pmo_baselineeffort',
  'pmo_snapshotjson', 'pmo_notes', 'statecode', 'createdon',
  ...PROJECT_VALUE_SELECT,
];

export async function listProjectBaselines(projectId: string): Promise<ProjectBaseline[]> {
  return dv.list<ProjectBaseline>(SET, {
    $select: FIELDS,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_captureddate desc',
  });
}

export async function createProjectBaseline(payload: ProjectBaselineCreate): Promise<ProjectBaseline> {
  void touchCustomProject(projectIdFromBindPayload(payload as unknown as Record<string, unknown>) ?? '');
  return dv.create<ProjectBaseline>(SET, payload);
}
