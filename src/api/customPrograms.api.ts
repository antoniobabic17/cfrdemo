/**
 * Option-C custom-source CRUD for pmo_program — FULL PARITY with the
 * msdyn_projectprogram surface the app reads (programs.api + Program model).
 *
 * SAME-GUID SHELL: a project's upward program bind (_msdyn_program_value) must
 * resolve, so on create we write a same-GUID msdyn_projectprogram SHELL first,
 * then the pmo_program row. Proven on DEV (probe-custom-program-shell.py).
 *
 * PARITY details (mirrors customProjects.api.ts):
 *  - Choices are REAL global option-sets on pmo_program, so Dataverse returns the
 *    same FormattedValue labels PROD does. The normalizer bridges each pmo_
 *    FormattedValue to the proj_ key the UI reads.
 *  - Friendly PROG-##### id lives in pmo_programnumber (autonumber) -> mapped to
 *    Program.pmo_programid; the GUID PK stays msdyn_projectprogramid.
 *  - Project rollups (proj_activeprojects, proj_projectbudget/actualcost/benefits,
 *    proj_projectsontrack/atrisk/introuble, proj_remainingbudget) are PSS
 *    aggregations from child projects — computed on READ from the program's
 *    projects (see applyProgramRollups). Not stored.
 */

import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, OVERALL_HEALTH } from '../lib/constants';
import type { Program, ProgramUpdate } from '../models/program.model';
import type { Project } from '../models/project.model';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_programs';
const SHELL_SET = ENTITY_SETS.program; // 'msdyn_projectprograms'
const FV = '@OData.Community.Display.V1.FormattedValue';

interface PmoProgramRow {
  [key: string]: unknown;
  pmo_programid: string;
  pmo_programnumber?: string | null;
  pmo_name?: string | null;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;
}

const BASE_SELECT: string[] = [
  'pmo_programid', 'pmo_programnumber', 'pmo_name', 'pmo_description', 'pmo_businesscase',
  'pmo_benefit', 'pmo_budget', 'pmo_roi', 'pmo_programstart', 'pmo_programdue',
  'pmo_state', 'pmo_priority', 'pmo_programtype', 'pmo_programgoals', 'pmo_businessunit',
  'pmo_overallhealth', 'pmo_efforthealth', 'pmo_financialhealth', 'pmo_schedulehealth',
  'statecode', 'statuscode', 'createdon', 'modifiedon', '_pmo_manager_value',
  '_createdby_value', '_modifiedby_value',
];

// pmo_ choice col -> target field; value + FormattedValue annotation both copied.
const CHOICE_MAP: Record<string, string> = {
  pmo_state: 'proj_state', pmo_priority: 'proj_priority',
  pmo_programtype: 'proj_programtype', pmo_programgoals: 'proj_programgoals',
  pmo_businessunit: 'proj_businessunit', pmo_overallhealth: 'proj_overallhealth',
  pmo_efforthealth: 'proj_efforthealth', pmo_financialhealth: 'proj_financialhealth',
  pmo_schedulehealth: 'proj_schedulehealth',
};
const NUMERIC_MAP: Record<string, string> = {
  pmo_benefit: 'msdyn_benefit', pmo_budget: 'msdyn_budget', pmo_roi: 'msdyn_roi',
};
const LOOKUP_MAP: Record<string, string> = { _pmo_manager_value: '_proj_manager_value' };

/** Normalize a pmo_program row into the Program model shape, incl. FormattedValue. */
export function normalizeCustomProgram(row: PmoProgramRow): Program {
  const out: Record<string, unknown> = {
    msdyn_projectprogramid: row.pmo_programid,
    // Friendly PROG-##### id lives in the autonumber col.
    pmo_programid: row.pmo_programnumber ?? undefined,
    msdyn_name: row.pmo_name ?? '',
    msdyn_description: (row.pmo_description as string) ?? undefined,
    msdyn_businesscase: (row.pmo_businesscase as string) ?? undefined,
    statecode: row.statecode ?? 0,
    statuscode: row.statuscode ?? undefined,
    createdon: row.createdon,
    modifiedon: row.modifiedon,
    '_createdby_value': (row as Record<string, unknown>)['_createdby_value'] as string | undefined,
    '_createdby_value@OData.Community.Display.V1.FormattedValue': (row as Record<string, unknown>)['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined,
    '_modifiedby_value': (row as Record<string, unknown>)['_modifiedby_value'] as string | undefined,
    '_modifiedby_value@OData.Community.Display.V1.FormattedValue': (row as Record<string, unknown>)['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined,
    proj_programstart: edmDateToNoonUtc(row.pmo_programstart as string),
    proj_programdue: edmDateToNoonUtc(row.pmo_programdue as string),
  };
  for (const [src, tgt] of Object.entries(CHOICE_MAP)) {
    if (row[src] != null) out[tgt] = row[src];
    const fv = row[`${src}${FV}`];
    if (fv != null) out[`${tgt}${FV}`] = fv;
  }
  for (const [src, tgt] of Object.entries(NUMERIC_MAP)) if (row[src] != null) out[tgt] = row[src];
  for (const [src, tgt] of Object.entries(LOOKUP_MAP)) {
    if (row[src] != null) out[tgt] = row[src];
    const fv = row[`${src}${FV}`];
    if (fv != null) out[`${tgt}${FV}`] = fv;
  }
  return out as unknown as Program;
}

// ── Project rollup (custom-source replacement for PSS program aggregation) ─────

/** Pure: fold a program's child projects into the rollup fields. Unit-tested. */
export function computeProgramRollup(projects: Project[]): Partial<Program> {
  let budget = 0, actual = 0, benefits = 0, remaining = 0;
  let onTrack = 0, atRisk = 0, inTrouble = 0;
  for (const p of projects) {
    budget += p.proj_budget ?? 0;
    actual += p.proj_actualcost ?? 0;
    benefits += p.proj_benefits ?? 0;
    remaining += p.proj_remainingbudget ?? Math.max(0, (p.proj_budget ?? 0) - (p.proj_actualcost ?? 0));
    switch (p.proj_overallhealth) {
      case OVERALL_HEALTH.OnTrack: onTrack++; break;
      case OVERALL_HEALTH.AtRisk: atRisk++; break;
      case OVERALL_HEALTH.OffTrack: inTrouble++; break;
      default: break;
    }
  }
  return {
    proj_activeprojects: projects.length,
    proj_projectbudget: budget,
    proj_projectactualcost: actual,
    proj_projectbenefits: benefits,
    proj_remainingbudget: remaining,
    proj_projectsontrack: onTrack,
    proj_projectsatrisk: atRisk,
    proj_projectsintrouble: inTrouble,
  };
}

/** Apply child-project rollups onto a set of normalized programs. One batched
 *  projects read per program (best-effort — unchanged on failure).
 *
 *  CUSTOM SOURCE: a project's program bind lives on pmo_project
 *  (_pmo_program_value), NOT the msdyn_project shell — so we MUST read the
 *  children from pmo_projects here (reading msdyn_project shells by
 *  _msdyn_program_value returns nothing until the reverse-sync runs). The
 *  proj_* rollup source columns (budget/actualcost/benefits/overallhealth) are
 *  stored on pmo_project directly, so no normalization is needed for the fold. */
export async function applyProgramRollups(programs: Program[]): Promise<Program[]> {
  if (programs.length === 0) return programs;
  const results = await Promise.all(programs.map(async (prog) => {
    try {
      const kids = await dv.list<Record<string, number | undefined>>('pmo_projects', {
        $select: ['pmo_projectid', 'pmo_budget', 'pmo_actualcost', 'pmo_benefits', 'pmo_remainingbudget', 'pmo_overallhealth'],
        $filter: `_pmo_program_value eq ${prog.msdyn_projectprogramid} and statecode eq 0`,
      });
      // computeProgramRollup reads proj_* keys; map the pmo_ columns onto them.
      const mapped = kids.map((k) => ({
        proj_budget: k['pmo_budget'],
        proj_actualcost: k['pmo_actualcost'],
        proj_benefits: k['pmo_benefits'],
        proj_remainingbudget: k['pmo_remainingbudget'],
        proj_overallhealth: k['pmo_overallhealth'],
      })) as Project[];
      return { ...prog, ...computeProgramRollup(mapped) };
    } catch {
      return prog; // rollup best-effort
    }
  }));
  return results;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function listCustomPrograms(extraSelect: string[] = []): Promise<Program[]> {
  const rows = await dv.list<PmoProgramRow>(SET, {
    $select: dv.boundedSelect(BASE_SELECT, extraSelect),
    $filter: 'statecode eq 0',
    $orderby: 'pmo_name asc',
  });
  return applyProgramRollups(rows.map(normalizeCustomProgram));
}

export async function getCustomProgram(id: string): Promise<Program> {
  const row = await dv.get<PmoProgramRow>(SET, id, BASE_SELECT);
  const [withRollup] = await applyProgramRollups([normalizeCustomProgram(row)]);
  return withRollup;
}

// ── Write ─────────────────────────────────────────────────────────────────────

const SCALAR_MAP: Record<string, string> = {
  msdyn_name: 'pmo_name',
  msdyn_description: 'pmo_description',
  msdyn_businesscase: 'pmo_businesscase',
  msdyn_benefit: 'pmo_benefit',
  msdyn_budget: 'pmo_budget',
  msdyn_roi: 'pmo_roi',
  proj_state: 'pmo_state',
  proj_priority: 'pmo_priority',
  proj_programtype: 'pmo_programtype',
  proj_programgoals: 'pmo_programgoals',
  proj_businessunit: 'pmo_businessunit',
  proj_overallhealth: 'pmo_overallhealth',
  proj_efforthealth: 'pmo_efforthealth',
  proj_financialhealth: 'pmo_financialhealth',
  proj_schedulehealth: 'pmo_schedulehealth',
};

const DATE_MAP: Record<string, string> = {
  proj_programstart: 'pmo_programstart',
  proj_programdue: 'pmo_programdue',
};

const LOOKUP_BIND_MAP: Record<string, string> = {
  'proj_Manager@odata.bind': 'pmo_Manager',
};

/** Build a pmo_program body from a ProgramUpdate. Pure — unit tested. */
export function buildCustomProgramPayload(input: ProgramUpdate): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key in DATE_MAP) {
      p[DATE_MAP[key]] = value === null ? null : toEdmDate(value as string);
    } else if (key in SCALAR_MAP) {
      p[SCALAR_MAP[key]] = value;
    } else if (key in LOOKUP_BIND_MAP) {
      p[`${LOOKUP_BIND_MAP[key]}@odata.bind`] = value;
    }
  }
  return p;
}

/** Create a program on the custom source: same-GUID shell first, then pmo_program;
 *  roll back the shell on failure. */
export async function createCustomProgram(payload: ProgramUpdate): Promise<Program> {
  const id = crypto.randomUUID();
  const name = (payload.msdyn_name as string | undefined) ?? 'Untitled Program';

  await dv.create(SHELL_SET, { msdyn_projectprogramid: id, msdyn_name: name });

  try {
    const body = buildCustomProgramPayload(payload);
    body.pmo_programid = id;
    if (body.pmo_name === undefined) body.pmo_name = name;
    // Health defaults: seed all four program health fields to On Track when
    // unset, matching createCustomProject (and PSS/Accelerator, which seed
    // health on create). Programs previously landed with NULL health.
    for (const h of ['pmo_overallhealth', 'pmo_efforthealth', 'pmo_financialhealth', 'pmo_schedulehealth'] as const) {
      if (body[h] === undefined || body[h] === null) body[h] = OVERALL_HEALTH.OnTrack;
    }
    await dv.create<PmoProgramRow>(SET, body);
  } catch (err) {
    try {
      await dv.remove(SHELL_SET, id);
    } catch {
      /* best-effort rollback */
    }
    throw err;
  }

  return getCustomProgram(id);
}

/** Update a program on the custom source (direct PATCH on pmo_program). */
export async function updateCustomProgram(id: string, payload: ProgramUpdate): Promise<void> {
  const body = buildCustomProgramPayload(payload);
  if (Object.keys(body).length === 0) return;
  await dv.update(SET, id, body);
}

/** Soft-delete the pmo_program row. Shell + nested cascade handled by cascadeDelete. */
export async function deleteCustomProgram(id: string): Promise<void> {
  await dv.deactivate(SET, id);
}
