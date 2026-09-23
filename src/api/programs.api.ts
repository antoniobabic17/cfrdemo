import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { Program, ProgramUpdate } from '../models/program.model';

const SET = ENTITY_SETS.program;

/**
 * Direct (non-rollup) fields safe for $select on msdyn_projectprogram.
 * Rollup fields (proj_activeprojects, proj_projectbudget, proj_projectsatrisk, etc.)
 * are excluded — they may not be exposed via OData on all environments.
 * getProgram() fetches without $select to get all available fields including rollups.
 */
const LIST_SELECT: string[] = [
  'msdyn_projectprogramid',
  'pmo_programid',
  'msdyn_name',
  'msdyn_description',
  'msdyn_businesscase',
  'msdyn_benefit',
  'msdyn_budget',
  'msdyn_roi',
  'statecode',
  'createdon',
  'modifiedon',
  '_createdby_value',
  '_modifiedby_value',
  // Schedule
  'proj_programstart',
  'proj_programdue',
  // Classification
  'proj_state',
  'proj_priority',
  'proj_programtype',
  'proj_programgoals',
  'proj_businessunit',
  // Health
  'proj_overallhealth',
  'proj_efforthealth',
  'proj_financialhealth',
  'proj_schedulehealth',
  // Governance
  '_proj_manager_value',
];

export async function listPrograms(extraSelect: string[] = []): Promise<Program[]> {
  return dv.list<Program>(SET, {
    // Base curated columns + any view-driven columns (bounded).
    $select: dv.boundedSelect(LIST_SELECT, extraSelect),
    $filter: 'statecode eq 0',
    $orderby: 'msdyn_name asc',
  });
}

/** Fetch full record — no $select so Dataverse returns all available fields including rollups. */
export async function getProgram(id: string): Promise<Program> {
  return dv.get<Program>(SET, id);
}

export async function createProgram(payload: object): Promise<Program> {
  return dv.create<Program>(SET, payload);
}

export async function updateProgram(id: string, payload: ProgramUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}
