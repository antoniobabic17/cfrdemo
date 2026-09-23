/**
 * Option-C custom-source CRUD for pmo_project — FULL PARITY with the
 * msdyn_project surface the app reads (projects.api LIST_SELECT + DETAIL_SELECT
 * + ProjectUpdate). Decision 2026-07-31: projects go fully custom.
 *
 * SAME-GUID SHELL: every child row (tasks/risks/issues/gates) binds to the
 * msdyn_project GUID via _msdyn_project_value. On create we write TWO rows with
 * the SAME chosen GUID: (1) an empty msdyn_project SHELL, then (2) the full
 * pmo_project row. Proven on DEV (probe-custom-project-shell.py).
 *
 * PARITY details:
 *  - Choice fields are REAL option-sets on pmo_project (global reuse for proj_*,
 *    local recreation with identical values for the 3 CFR choices), so Dataverse
 *    returns the same @OData.Community.Display.V1.FormattedValue labels PROD does.
 *    The normalizer bridges each pmo_ FormattedValue to the proj_/pmo_/msdyn_ key
 *    the UI reads.
 *  - Friendly PROJ-##### id lives in the pmo_projectnumber autonumber col and maps
 *    to Project.pmo_projectid (display); the GUID PK stays msdyn_projectid.
 *  - Effort/progress/risk-count are PSS rollups from child tasks — NOT stored here.
 *    They are computed on READ in useProjects (see rollupProjectEffort). The
 *    normalizer leaves msdyn_effort/progress/etc. undefined.
 */

import * as dv from '../lib/dataverseClient';
import { getCachedDataSource } from '../lib/taskSource';
import { ENTITY_SETS, OVERALL_HEALTH } from '../lib/constants';
import type { Project, ProjectUpdate } from '../models/project.model';
import type { ProjectTask } from '../models/projectTask.model';
import { getTaskEffort, getTaskHoursDone } from '../models/projectTask.model';
import { computeDurationDays } from '../lib/taskDuration';
import { listCustomTasksForProjects } from './customTasks.api';
import { recomputeAndSaveProjectRollups } from '../lib/resourceRollups';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_projects';
const SHELL_SET = ENTITY_SETS.project; // 'msdyn_projects'

const FV = '@OData.Community.Display.V1.FormattedValue';

/** Raw pmo_project row. `[key: string]` lets us read the FormattedValue
 *  annotation keys Dataverse returns alongside choices + lookups. */
interface PmoProjectRow {
  [key: string]: unknown;
  pmo_projectid: string;
  pmo_projectnumber?: string | null;
  pmo_subject?: string | null;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;
}

// Scalar/choice/date/money columns to read. FormattedValue annotations for the
// choices + lookups are returned automatically (no need to list them).
const BASE_SELECT: string[] = [
  'pmo_projectid', 'pmo_projectnumber', 'pmo_subject', 'pmo_description', 'pmo_businesscase',
  'pmo_valuestatement', 'pmo_comments', 'pmo_scheduledstart', 'pmo_finish',
  'pmo_scheduledcompletion', 'pmo_actualfinishdate', 'pmo_stage', 'pmo_state', 'pmo_priority', 'pmo_projecttype',
  'pmo_businessunit', 'pmo_fundingavailable', 'pmo_fundingsource', 'pmo_needsstaffing',
  'pmo_overallhealth', 'pmo_efforthealth', 'pmo_financialhealth', 'pmo_schedulehealth',
  'pmo_issuehealth', 'pmo_budget', 'pmo_actualcost', 'pmo_forecast', 'pmo_benefits',
  'pmo_remainingbudget', 'pmo_budgetvariance', 'pmo_roi', 'pmo_prioritizationscore',
  'pmo_strategicalignment', 'pmo_strategicalignmentscore', 'pmo_improveemployeeretention',
  'pmo_improveemployeeretentionscore', 'pmo_lowercost', 'pmo_lowercostscore',
  'pmo_risk', 'pmo_riskscore', 'pmo_hoursperday', 'pmo_hoursperweek', 'pmo_dayspermonth',
  'pmo_cfrcategory', 'pmo_complexity', 'pmo_strategicpriority', 'pmo_legacyprojectid',
  'pmo_affectedsystems',
  'pmo_executivesummary', 'pmo_projectstatus',
  'statecode', 'statuscode', 'createdon', 'modifiedon',
  '_createdby_value', '_modifiedby_value',
  '_pmo_projectmanager_value', '_pmo_program_value', '_pmo_executivesponsor_value',
  '_pmo_manager_value', '_pmo_primaryteam_value', '_pmo_requestsource_value',
  '_pmo_payerinitiatives_hpiissue_value', '_pmo_payerinitiatives_strategicaccountexecutive_value',
  // SAE direct-AAD snapshot columns (plain text). scripts/add-sae-aad-columns.py.
  'pmo_payerinitiatives_saeaadobjectid', 'pmo_payerinitiatives_saedisplayname',
  'pmo_payerinitiatives_saeemail',
  // New Resource Model
  'pmo_forecastedlaborhours', 'pmo_currenttotalhours', 'pmo_currentcompletedhours',
  'pmo_usenewresourcemodel',
];

// pmo_ source column -> target field the Project model / UI reads. Same value,
// and we ALSO copy the `<col>@FormattedValue` annotation to `<target>@FormattedValue`.
const CHOICE_MAP: Record<string, string> = {
  pmo_stage: 'proj_stage', pmo_state: 'proj_state', pmo_priority: 'proj_priority',
  pmo_projecttype: 'proj_projecttype', pmo_businessunit: 'proj_businessunit',
  pmo_fundingsource: 'proj_fundingsource',
  pmo_overallhealth: 'proj_overallhealth', pmo_efforthealth: 'proj_efforthealth',
  pmo_financialhealth: 'proj_financialhealth', pmo_schedulehealth: 'proj_schedulehealth',
  pmo_issuehealth: 'proj_issuehealth',
  pmo_strategicalignment: 'proj_strategicalignment',
  pmo_improveemployeeretention: 'proj_improveemployeeretention',
  pmo_lowercost: 'proj_lowercost', pmo_risk: 'proj_risk',
  pmo_cfrcategory: 'pmo_cfrcategory', pmo_complexity: 'pmo_complexity',
  pmo_strategicpriority: 'pmo_strategicpriority',
  pmo_affectedsystems: 'pmo_affectedsystems',
  pmo_executivesummary: 'pmo_executivesummary',
  pmo_projectstatus: 'pmo_projectstatus',
};

const NUMERIC_MAP: Record<string, string> = {
  pmo_budget: 'proj_budget', pmo_actualcost: 'proj_actualcost', pmo_forecast: 'proj_forecast',
  pmo_benefits: 'proj_benefits', pmo_remainingbudget: 'proj_remainingbudget',
  pmo_budgetvariance: 'proj_budgetvariance', pmo_roi: 'proj_roi',
  pmo_prioritizationscore: 'proj_prioritizationscore',
  pmo_strategicalignmentscore: 'proj_strategicalignmentscore',
  pmo_improveemployeeretentionscore: 'proj_improveemployeeretentionscore',
  pmo_lowercostscore: 'proj_lowercostscore', pmo_riskscore: 'proj_riskscore',
  pmo_hoursperday: 'msdyn_hoursperday', pmo_hoursperweek: 'msdyn_hoursperweek',
  pmo_dayspermonth: 'msdyn_dayspermonth',
};

const BOOL_MAP: Record<string, string> = {
  pmo_fundingavailable: 'proj_fundingavailable', pmo_needsstaffing: 'proj_needsstaffing',
};

// pmo_ lookup _value -> target _value the UI reads (+ FormattedValue bridged).
const LOOKUP_MAP: Record<string, string> = {
  _pmo_projectmanager_value: '_msdyn_projectmanager_value',
  _pmo_program_value: '_msdyn_program_value',
  _pmo_executivesponsor_value: '_proj_executivesponsor_value',
  _pmo_manager_value: '_proj_manager_value',
  _pmo_primaryteam_value: '_pmo_primaryteam_value',
  _pmo_requestsource_value: '_pmo_requestsource_value',
  _pmo_payerinitiatives_hpiissue_value: '_pmo_payerinitiatives_hpiissue_value',
  _pmo_payerinitiatives_strategicaccountexecutive_value: '_pmo_payerinitiatives_strategicaccountexecutive_value',
};

/**
 * Normalize a pmo_project row into the `Project` shape the app consumes,
 * INCLUDING the FormattedValue annotations the list + detail pages render.
 */
export function normalizeCustomProject(row: PmoProjectRow): Project {
  const out: Record<string, unknown> = {
    msdyn_projectid: row.pmo_projectid,
    // Friendly display id (PROJ-#####) lives in the autonumber col.
    pmo_projectid: row.pmo_projectnumber ?? undefined,
    msdyn_subject: row.pmo_subject ?? '',
    statecode: row.statecode ?? 0,
    statuscode: row.statuscode ?? undefined,
    createdon: row.createdon,
    modifiedon: row.modifiedon,
    '_createdby_value': (row as Record<string, unknown>)['_createdby_value'] as string | undefined,
    '_createdby_value@OData.Community.Display.V1.FormattedValue': (row as Record<string, unknown>)['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined,
    '_modifiedby_value': (row as Record<string, unknown>)['_modifiedby_value'] as string | undefined,
    '_modifiedby_value@OData.Community.Display.V1.FormattedValue': (row as Record<string, unknown>)['_modifiedby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined,
    // Narrative
    msdyn_description: (row.pmo_description as string) ?? undefined,
    msdyn_businesscase: (row.pmo_businesscase as string) ?? undefined,
    msdyn_valuestatement: (row.pmo_valuestatement as string) ?? undefined,
    msdyn_comments: (row.pmo_comments as string) ?? undefined,
    // Dates: bare Edm.Date -> noon-UTC so renderers show the picked day.
    msdyn_scheduledstart: edmDateToNoonUtc(row.pmo_scheduledstart as string),
    msdyn_finish: edmDateToNoonUtc(row.pmo_finish as string),
    proj_scheduledcompletion: edmDateToNoonUtc(row.pmo_scheduledcompletion as string),
    proj_actualfinishdate: edmDateToNoonUtc(row.pmo_actualfinishdate as string),
    pmo_legacyprojectid: (row.pmo_legacyprojectid as string) ?? undefined,
    pmo_executivesummary: (row.pmo_executivesummary as string) ?? undefined,
    pmo_projectstatus: (row.pmo_projectstatus as number) ?? undefined,
    ['pmo_projectstatus' + FV]: (row['pmo_projectstatus' + FV] as string) ?? undefined,
    // SAE direct-AAD snapshot — same column names on pmo_project, straight copy.
    pmo_payerinitiatives_saeaadobjectid: (row.pmo_payerinitiatives_saeaadobjectid as string) ?? undefined,
    pmo_payerinitiatives_saedisplayname: (row.pmo_payerinitiatives_saedisplayname as string) ?? undefined,
    pmo_payerinitiatives_saeemail: (row.pmo_payerinitiatives_saeemail as string) ?? undefined,
    // New Resource Model fields.
    pmo_forecastedlaborhours: (row.pmo_forecastedlaborhours as number) ?? undefined,
    pmo_currenttotalhours: (row.pmo_currenttotalhours as number) ?? undefined,
    pmo_currentcompletedhours: (row.pmo_currentcompletedhours as number) ?? undefined,
    pmo_usenewresourcemodel: (row.pmo_usenewresourcemodel as boolean) ?? undefined,
  };

  // Choices: copy raw value + FormattedValue annotation to the target key.
  for (const [src, tgt] of Object.entries(CHOICE_MAP)) {
    if (row[src] != null) out[tgt] = row[src];
    const fv = row[`${src}${FV}`];
    if (fv != null) out[`${tgt}${FV}`] = fv;
  }
  // Numerics + booleans: value only.
  for (const [src, tgt] of Object.entries(NUMERIC_MAP)) if (row[src] != null) out[tgt] = row[src];
  for (const [src, tgt] of Object.entries(BOOL_MAP)) if (row[src] != null) out[tgt] = row[src];
  // Lookups: copy _value + its FormattedValue (the display name) to the target.
  for (const [src, tgt] of Object.entries(LOOKUP_MAP)) {
    if (row[src] != null) out[tgt] = row[src];
    const fv = row[`${src}${FV}`];
    if (fv != null) out[`${tgt}${FV}`] = fv;
  }
  // Passthrough for admin-discovered (Re-pull) columns that have no explicit
  // map entry above: copy any not-yet-present key + its FormattedValue straight
  // through so a newly-discovered pmo_ column renders generically in the grid
  // (data-table synthetic column) without a code change. Never overwrites a
  // value an explicit map already set.
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v == null) continue;
    if (k in out) continue;
    if (k.endsWith(FV)) continue; // handled alongside its base key below
    out[k] = v;
    const fv = (row as Record<string, unknown>)[`${k}${FV}`];
    if (fv != null && !(`${k}${FV}` in out)) out[`${k}${FV}`] = fv;
  }
  return out as unknown as Project;
}

// ── Read ─────────────────────────────────────────────────────────────────────

// Bound the $select union so the OData URL can't overflow the host gateway
// (0x80060888), same guard as projects.api buildListSelect.
const MAX_CUSTOM_SELECT_KEYS = 90;

/** Union BASE_SELECT with admin-discovered extra pmo_ column keys, deduped +
 *  bounded. Extras are the pmo_-native keys the custom source stores; the
 *  normalize passthrough surfaces them to the grid. */
function buildCustomSelect(extraKeys?: string[]): string[] {
  if (!extraKeys || extraKeys.length === 0) return BASE_SELECT;
  const seen = new Set(BASE_SELECT);
  const out = [...BASE_SELECT];
  for (const k of extraKeys) {
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(k);
    if (out.length >= MAX_CUSTOM_SELECT_KEYS) break;
  }
  return out;
}

export async function listCustomProjects(extraSelect?: string[]): Promise<Project[]> {
  const rows = await dv.list<PmoProjectRow>(SET, {
    $select: buildCustomSelect(extraSelect),
    $filter: 'statecode eq 0',
    $orderby: 'createdon desc',
  });
  return applyEffortRollups(rows.map(normalizeCustomProject));
}

// ── Project “touch” helpers ─────────────────────────────────────────────
// CONVENTION (REQUIRED): every project-CHILD create/update/delete must bump the
// parent project so modifiedon/modifiedby stay accurate (PIT 30-day SLA report
// reads project modifiedon). Dataverse stamps those only on a write to the row
// itself, so child edits leave the parent stale. Use these helpers, fire-and-
// forget (void), best-effort. Full guide + entity table:
// docs/project-touch-convention.md  (also summarized in CLAUDE.md).
/**
 * Resolve the parent project GUID from a CHILD record (via its project lookup
 * value field) and touch it. Used by update/delete paths that only receive the
 * child id. Best-effort; never throws. `projectValueField` is the child's lookup
 * value column, e.g. `_pmo_project_value` (or `_pmo_projectref_value` for buckets).
 */
export async function touchProjectFromChild(
  childSet: string,
  childId: string,
  ...projectValueFields: string[]
): Promise<void> {
  if (!childId || projectValueFields.length === 0) return;
  try {
    const row = await dv.get<Record<string, unknown>>(childSet, childId, projectValueFields);
    // Sidecar tables may carry either the custom (_pmo_projectref_value) or the
    // pss (_pmo_project_value) lookup depending on when/how the row was written;
    // take the first populated one.
    for (const f of projectValueFields) {
      const pid = row[f];
      if (typeof pid === 'string' && pid) { await touchCustomProject(pid); return; }
    }
  } catch (err) {
    console.warn('[touchProjectFromChild] could not resolve/touch project', childSet, childId, err);
  }
}

/**
 * Touch the project that owns a TASK. Resolves the task's project lookup
 * (_pmo_projectref_value) then bumps the project. For task-scoped children
 * (checklist items, task labels) whose own row has no project lookup. Best-effort.
 */
/**
 * Touch the owning project from a TASK-scoped child row (checklist item, task
 * label) that carries a _pmo_task_value but no project lookup. Two hops:
 * child -> task -> project. Best-effort.
 */
export async function touchProjectFromTaskChild(childSet: string, childId: string): Promise<void> {
  if (!childId) return;
  try {
    const row = await dv.get<Record<string, unknown>>(childSet, childId, ['_pmo_task_value']);
    const taskId = row['_pmo_task_value'];
    if (typeof taskId === 'string' && taskId) await touchProjectFromTask(taskId);
  } catch (err) {
    console.warn('[touchProjectFromTaskChild] could not resolve project', childSet, childId, err);
  }
}

export async function touchProjectFromTask(taskId: string): Promise<void> {
  if (!taskId) return;
  await touchProjectFromChild('pmo_tasks', taskId, '_pmo_projectref_value');
}

export async function touchCustomProject(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const row = await dv.get<{ pmo_subject?: string | null }>(SET, projectId, ['pmo_subject']);
    await dv.update(SET, projectId, { pmo_subject: row.pmo_subject ?? '' });
    // New Resource Model: recompute stored rollup columns when the toggle is ON.
    // Best-effort — runs inside the same try/catch so a rollup failure never
    // prevents the modifiedon bump from being logged.
    void recomputeAndSaveProjectRollups(projectId);
  } catch (err) {
    console.warn('[touchCustomProject] could not bump project modifiedon', projectId, err);
  }
}

export async function getCustomProject(id: string): Promise<Project> {
  const row = await dv.get<PmoProjectRow>(SET, id, BASE_SELECT);
  const [withRollup] = await applyEffortRollups([normalizeCustomProject(row)]);
  return withRollup;
}

// ── Write ─────────────────────────────────────────────────────────────────────

const CREATE_LOOKUP_MAP: Record<string, string> = {
  'msdyn_projectmanager@odata.bind': 'pmo_ProjectManager',
  'msdyn_Program@odata.bind': 'pmo_Program',
  'proj_ExecutiveSponsor@odata.bind': 'pmo_ExecutiveSponsor',
  'proj_Manager@odata.bind': 'pmo_Manager',
  'pmo_PrimaryTeam@odata.bind': 'pmo_PrimaryTeam',
  'pmo_RequestSource@odata.bind': 'pmo_RequestSource',
  'pmo_PayerInitiatives_HpiIssue@odata.bind': 'pmo_PayerInitiatives_HpiIssue',
  'pmo_PayerInitiatives_StrategicAccountExecutive@odata.bind': 'pmo_PayerInitiatives_StrategicAccountExecutive',
};

// ProjectUpdate scalar/choice/bool field -> pmo_ column.
const WRITE_SCALAR_MAP: Record<string, string> = {
  msdyn_subject: 'pmo_subject', msdyn_description: 'pmo_description',
  msdyn_businesscase: 'pmo_businesscase', msdyn_valuestatement: 'pmo_valuestatement',
  msdyn_comments: 'pmo_comments',
  proj_stage: 'pmo_stage', proj_priority: 'pmo_priority', proj_projecttype: 'pmo_projecttype',
  proj_businessunit: 'pmo_businessunit', proj_fundingavailable: 'pmo_fundingavailable',
  proj_fundingsource: 'pmo_fundingsource', proj_needsstaffing: 'pmo_needsstaffing',
  proj_budget: 'pmo_budget', proj_forecast: 'pmo_forecast', proj_actualcost: 'pmo_actualcost', proj_benefits: 'pmo_benefits',
  proj_overallhealth: 'pmo_overallhealth', proj_schedulehealth: 'pmo_schedulehealth',
  proj_efforthealth: 'pmo_efforthealth', proj_financialhealth: 'pmo_financialhealth',
  proj_issuehealth: 'pmo_issuehealth',
  pmo_cfrcategory: 'pmo_cfrcategory', pmo_complexity: 'pmo_complexity',
  pmo_strategicpriority: 'pmo_strategicpriority', pmo_affectedsystems: 'pmo_affectedsystems',
  pmo_projectstatus: 'pmo_projectstatus', pmo_executivesummary: 'pmo_executivesummary',
  // SAE direct-AAD write columns (identity — same name on pmo_project).
  pmo_payerinitiatives_saeaadobjectid: 'pmo_payerinitiatives_saeaadobjectid',
  pmo_payerinitiatives_saedisplayname: 'pmo_payerinitiatives_saedisplayname',
  pmo_payerinitiatives_saeemail: 'pmo_payerinitiatives_saeemail',
  // New Resource Model columns - pmo_project only, NOT on msdyn_project.
  pmo_forecastedlaborhours: 'pmo_forecastedlaborhours',
  pmo_currenttotalhours: 'pmo_currenttotalhours',
  pmo_currentcompletedhours: 'pmo_currentcompletedhours',
  pmo_usenewresourcemodel: 'pmo_usenewresourcemodel',
};

const DATE_MAP: Record<string, string> = {
  msdyn_scheduledstart: 'pmo_scheduledstart',
  msdyn_finish: 'pmo_finish',
  proj_scheduledcompletion: 'pmo_scheduledcompletion',
  proj_actualfinishdate: 'pmo_actualfinishdate',
};

/** Build a pmo_project PATCH/POST body from a ProjectUpdate. Pure — unit tested.
 *  Dates -> toEdmDate; lookup binds -> pmo_ nav props; unknown keys dropped. */
export function buildCustomProjectPayload(input: ProjectUpdate): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key in DATE_MAP) {
      p[DATE_MAP[key]] = value === null ? null : toEdmDate(value as string);
    } else if (key in WRITE_SCALAR_MAP) {
      p[WRITE_SCALAR_MAP[key]] = value;
    } else if (key.endsWith('@odata.bind') && key in CREATE_LOOKUP_MAP) {
      p[`${CREATE_LOOKUP_MAP[key]}@odata.bind`] = value;
    }
  }
  return p;
}

/**
 * Create a project on the custom source. Same-GUID msdyn_project SHELL first (so
 * child lookups resolve), then the full pmo_project row; roll back the shell on
 * failure. Returns the created Project (with friendly number populated).
 */
export async function createCustomProject(payload: ProjectUpdate): Promise<Project> {
  const id = crypto.randomUUID();
  const subject = (payload.msdyn_subject as string | undefined) ?? 'Untitled Project';

  // msdyn_project shell: only needed on the PSS path. As of the Tier-1/2/3
  // decoupling, custom-source children bind pmo_project directly (pmo_projectref
  // on tasks/buckets/etc., pmo_project on notes + monitor twins), so a custom
  // project needs NO shell. Skip it in custom mode to drop the msdyn_project
  // dependency (and its MS Project license surface). getCachedDataSource() is
  // set by useDataSource on render; createCustomProject only runs in custom mode
  // (useProjects gates it), so default-to-custom here is safe.
  const needShell = getCachedDataSource() !== 'custom';
  if (needShell) {
    await dv.create(SHELL_SET, { msdyn_projectid: id, msdyn_subject: subject });
  }

  try {
    const body = buildCustomProjectPayload(payload);
    body.pmo_projectid = id;
    if (body.pmo_subject === undefined) body.pmo_subject = subject;
    // Health defaults: PSS/Accelerator seeds ALL FIVE health fields to On Track
    // (189330000) on project create (verified on PROD + DEV — every project reads
    // O=E=F=S=I=189330000). The app's create payload only carries overallhealth
    // (from the wizard), so seed the other four (and overall, if unset) to match.
    for (const h of ['pmo_overallhealth', 'pmo_efforthealth', 'pmo_financialhealth', 'pmo_schedulehealth', 'pmo_issuehealth'] as const) {
      if (body[h] === undefined || body[h] === null) body[h] = OVERALL_HEALTH.OnTrack;
    }
    // Static schedule config: PSS seeds a standard Mon–Fri 8h workday on create
    // (verified on PROD: hoursperday=8, hoursperweek=40, dayspermonth=20). Seed
    // the same so effort/duration math + any downstream reporting line up.
    if (body.pmo_hoursperday === undefined) body.pmo_hoursperday = 8;
    if (body.pmo_hoursperweek === undefined) body.pmo_hoursperweek = 40;
    if (body.pmo_dayspermonth === undefined) body.pmo_dayspermonth = 20;
    // Every newly approved/created project starts at status 'New' (508640000)
    // per the intake rule (see deployment-runbook status mapping). Migration is
    // the only path that seeds a different starting status.
    if (body.pmo_projectstatus === undefined || body.pmo_projectstatus === null) body.pmo_projectstatus = 508640000;
    // New Labor Hours Model default (2026-09-17 operator decision): every NEWLY
    // created project defaults to the new model, regardless of team or source.
    // Only applies when the caller left the field unset — an explicit true/false
    // from a caller (future migration / admin override) still wins. Existing
    // projects are NEVER touched: this runs only on create.
    if (body.pmo_usenewresourcemodel === undefined) body.pmo_usenewresourcemodel = true;
    await dv.create<PmoProjectRow>(SET, body);
  } catch (err) {
    if (needShell) {
      try {
        await dv.remove(SHELL_SET, id);
      } catch {
        /* best-effort rollback */
      }
    }
    throw err;
  }

  return getCustomProject(id);
}

/** Update a project on the custom source (direct PATCH on pmo_project). */
export async function updateCustomProject(id: string, payload: ProjectUpdate): Promise<void> {
  const body = buildCustomProjectPayload(payload);
  if (Object.keys(body).length === 0) return;
  await dv.update(SET, id, body);
}

/** Soft-delete the pmo_project row. Shell + child cascade handled by cascadeDelete. */
export async function deleteCustomProject(id: string): Promise<void> {
  await dv.deactivate(SET, id);
}

// ── Effort / progress rollup (custom-source replacement for PSS aggregation) ───
//
// On msdyn_project, PSS aggregates task effort/progress onto the project. On the
// custom source we compute the same from the project's pmo_task rows: total
// effort = Σ task effort, completed = Σ hours-done, progress = completed/effort
// (0-1, matching how msdyn_progress is stored). Applied on READ so the list +
// detail always reflect live task data without a stored rollup that can drift.

export interface ProjectEffortRollup {
  effort: number;
  effortCompleted: number;
  effortRemaining: number;
  progress: number; // 0-1
  /** Earliest task start (noon-UTC ISO) — the custom-source msdyn_scheduledstart. */
  start?: string;
  /** Latest task due date (noon-UTC ISO) — the custom-source msdyn_finish. */
  finish?: string;
  /** Working-day span start→finish (PSS msdyn_duration semantics). */
  duration?: number;
}

/** Pure: fold a project's tasks into effort/progress/schedule rollups — the
 *  custom-source equivalent of the PSS-maintained project aggregates
 *  (effort/complete/remaining/progress + scheduledstart/finish/duration).
 *  Unit-tested. */
export function computeProjectEffortRollup(tasks: ProjectTask[]): ProjectEffortRollup {
  let effort = 0;
  let completed = 0;
  let earliestStart: string | undefined;
  let latestDue: string | undefined;
  for (const t of tasks) {
    effort += getTaskEffort(t) ?? 0;
    completed += getTaskHoursDone(t) ?? 0;
    // Project start = earliest task start; finish = latest task due (PSS derives
    // msdyn_scheduledstart / msdyn_finish this way).
    const start = t.msdyn_scheduledstart;
    if (start && (!earliestStart || start < earliestStart)) earliestStart = start;
    const due = t.msdyn_scheduledend ?? t.msdyn_finish;
    if (due && (!latestDue || due > latestDue)) latestDue = due;
  }
  const remaining = Math.max(0, effort - completed);
  const progress = effort > 0 ? Math.min(1, completed / effort) : 0;
  // Duration in working days across the project window (matches taskDuration /
  // PSS whole-weekday semantics). Undefined when the window is unknown.
  const duration = computeDurationDays(earliestStart, latestDue);
  return {
    effort, effortCompleted: completed, effortRemaining: remaining, progress,
    start: earliestStart, finish: latestDue, duration,
  };
}

/** Apply effort/progress rollups (computed from child pmo_task rows) onto a set
 *  of normalized custom projects. One batched multi-project task read. Best-effort
 *  — on failure the projects are returned unchanged (effort/progress just absent). */
export async function applyEffortRollups(projects: Project[]): Promise<Project[]> {
  if (projects.length === 0) return projects;
  const ids = projects.map((p) => p.msdyn_projectid);
  let tasks: ProjectTask[] = [];
  try {
    tasks = await listCustomTasksForProjects(ids);
  } catch {
    return projects; // rollup is best-effort; never break the list
  }
  const byProject = new Map<string, ProjectTask[]>();
  for (const t of tasks) {
    const pid = t['_msdyn_project_value'];
    if (!pid) continue;
    (byProject.get(pid) ?? byProject.set(pid, []).get(pid)!).push(t);
  }
  return projects.map((p) => {
    const kids = byProject.get(p.msdyn_projectid) ?? [];
    const r = computeProjectEffortRollup(kids);
    return {
      ...p,
      msdyn_effort: r.effort,
      msdyn_effortcompleted: r.effortCompleted,
      msdyn_effortremaining: r.effortRemaining,
      msdyn_progress: r.progress,
      // Task-derived schedule rollups (PSS maintains these on msdyn_project).
      // Only when the project has tasks — task-less projects keep their authored
      // msdyn_scheduledstart + the detail page's proj_scheduledcompletion finish
      // fallback. msdyn_finish is also persisted to pmo_finish on task writes
      // (see useProjectTaskMutations); this read path is the always-live view.
      ...(kids.length > 0 && r.start ? { msdyn_scheduledstart: r.start } : {}),
      ...(kids.length > 0 && r.finish ? { msdyn_finish: r.finish } : {}),
      ...(kids.length > 0 && r.duration != null ? { msdyn_duration: r.duration } : {}),
    };
  });
}

/**
 * PERSIST the task-derived project FINISH onto pmo_project.pmo_finish — the
 * custom equivalent of PSS keeping msdyn_finish current on the project as tasks
 * change. Call after any task create/update/delete on the custom source (see
 * useProjectTaskMutations). Writes the stored Edm.Date column (bare YYYY-MM-DD)
 * so the value survives + the reverse-sync can carry it. Best-effort — never
 * throws into the caller's (already-committed) task mutation.
 *
 * Only pmo_finish is persisted: pmo_scheduledstart is the user's AUTHORED intake
 * start and must not be clobbered (the read-rollup still surfaces a task-derived
 * start for display). Cleared to null when no dated tasks remain, so a project
 * that loses its last task doesn't keep a stale finish.
 */
export async function persistProjectSchedule(projectId: string): Promise<void> {
  try {
    const tasks = await listCustomTasksForProjects([projectId]);
    const r = computeProjectEffortRollup(tasks);
    await dv.update(SET, projectId, {
      pmo_finish: r.finish ? toEdmDate(r.finish) ?? null : null,
    });
  } catch {
    /* best-effort — the read-side rollup still shows the live value */
  }
}
