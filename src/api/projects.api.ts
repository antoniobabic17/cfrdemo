import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { Project, ProjectUpdate } from '../models/project.model';
import type { ODataParams } from '../models/common.model';

const SET = ENTITY_SETS.project;

// Long narrative columns are detail-page-only. Listing them on every record in
// list queries pushed the OData URL past the Power Apps host gateway limit and
// produced 0x80060888 ($select truncation). Lists use LIST_SELECT; getProject
// uses DETAIL_SELECT for the full record. FormattedValue annotations are
// returned automatically by the SDK and must NOT appear in $select.
const LIST_SELECT: string[] = [
  // ── Core ─────────────────────────────────────────────────────────────────
  'msdyn_projectid',
  'msdyn_subject',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
  '_createdby_value',
  '_modifiedby_value',
  'ownerid',
  // ── Schedule ─────────────────────────────────────────────────────────────
  'msdyn_scheduledstart',
  'msdyn_finish',
  'proj_scheduledcompletion',
  'proj_actualfinishdate',
  'msdyn_progress',
  'msdyn_duration',
  'msdyn_effort',
  'msdyn_effortcompleted',
  'msdyn_effortremaining',
  'msdyn_hoursperday',
  'msdyn_hoursperweek',
  'msdyn_dayspermonth',
  'msdyn_schedulemode',
  // ── Lookups ──────────────────────────────────────────────────────────────
  '_msdyn_msprojectdocument_value',
  '_msdyn_projectmanager_value',
  '_msdyn_program_value',
  '_proj_executivesponsor_value',
  '_proj_manager_value',
  '_pmo_primaryteam_value',
  '_pmo_requestsource_value',
  // ── Accelerator classification ────────────────────────────────────────────
  'proj_stage',
  'proj_state',
  'proj_priority',
  'proj_projecttype',
  'proj_businessunit',
  'proj_fundingavailable',
  'proj_fundingsource',
  'proj_needsstaffing',
  // ── Accelerator health ────────────────────────────────────────────────────
  'proj_overallhealth',
  'proj_efforthealth',
  'proj_financialhealth',
  'proj_schedulehealth',
  'proj_issuehealth',
  'proj_activerisks',
  'proj_activeissues',
  'proj_activechanges',
  // ── Accelerator financials ────────────────────────────────────────────────
  'proj_budget',
  'proj_actualcost',
  'proj_forecast',
  'proj_remainingbudget',
  'proj_budgetvariance',
  'proj_benefits',
  'proj_roi',
  'proj_prioritizationscore',
  // ── Accelerator strategic scoring ─────────────────────────────────────────
  'proj_strategicalignment',
  'proj_strategicalignmentscore',
  'proj_improveemployeeretention',
  'proj_improveemployeeretentionscore',
  'proj_lowercost',
  'proj_lowercostscore',
  'proj_risk',
  'proj_riskscore',
  // ── CFR custom ───────────────────────────────────────────────────────────
  'pmo_projectid',          // PROJ-{SEQNUM:00000}, auto-populated on Create.
  'pmo_legacyprojectid',    // Project 1.0 PROJ-XXXX, populated only on migrated rows.
  'pmo_cfrcategory',
  'pmo_affectedsystems',
  'pmo_complexity',
  'pmo_strategicpriority',
  // HPI lookup — renamed from pmo_hpiissue to pmo_payerinitiatives_hpiissue
  // to follow the pmo_<team>_<feature> naming convention. Old column left
  // orphaned in PROD; data migrated. See
  // scripts/rename-hpiissue-to-payerinitiatives-hpiissue.py.
  '_pmo_payerinitiatives_hpiissue_value',
  // Payer Initiatives team-feature lookup — legacy SAE systemuser lookup,
  // kept as a read fallback. scripts/add-payerinitiatives-sae-column.py.
  '_pmo_payerinitiatives_strategicaccountexecutive_value',
  // SAE direct-AAD snapshot columns. scripts/add-sae-aad-columns.py.
  'pmo_payerinitiatives_saeaadobjectid',
  'pmo_payerinitiatives_saedisplayname',
  'pmo_payerinitiatives_saeemail',
];

const DETAIL_SELECT: string[] = [
  ...LIST_SELECT,
  'msdyn_description',
  'msdyn_businesscase',
  'msdyn_valuestatement',
  'msdyn_comments',
];

// Hard cap on $select size. The Power Apps host gateway truncates very long
// OData URLs (error 0x80060888), so the config-driven union of LIST_SELECT +
// admin-discovered visible columns is bounded. LIST_SELECT is ~55 keys; the
// visible extras a user can show on top are few, but cap defensively.
const MAX_SELECT_KEYS = 90;

/**
 * Union LIST_SELECT with caller-supplied extra column keys (from the active
 * view's admin-discovered columns), deduped, order-stable, and bounded so the
 * OData URL never overflows the gateway limit. Empty/unknown extras are no-ops.
 */
export function buildListSelect(extraKeys?: string[]): string[] {
  if (!extraKeys || extraKeys.length === 0) return LIST_SELECT;
  const seen = new Set(LIST_SELECT);
  const out = [...LIST_SELECT];
  for (const k of extraKeys) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= MAX_SELECT_KEYS) break;
  }
  return out;
}

export async function listProjects(params?: ODataParams): Promise<Project[]> {
  // A caller-supplied $select is treated as EXTRA columns to union onto
  // LIST_SELECT (not a replacement), so the curated core is always present.
  const { $select: extra, ...rest } = params ?? {};
  return dv.list<Project>(SET, {
    $select: buildListSelect(extra),
    $orderby: 'createdon desc',
    ...rest,
  });
}

export async function listActiveProjects(): Promise<Project[]> {
  return dv.list<Project>(SET, {
    $select: LIST_SELECT,
    $filter: 'statecode eq 0',
    $orderby: 'msdyn_subject asc',
  });
}

export async function getProject(id: string): Promise<Project> {
  return dv.get<Project>(SET, id, DETAIL_SELECT);
}

export async function createProject(payload: object): Promise<Project> {
  return dv.create<Project>(SET, payload);
}

export async function updateProject(id: string, payload: ProjectUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}
