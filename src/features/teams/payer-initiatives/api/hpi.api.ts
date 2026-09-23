/**
 * HPI (Health Plan Issue) — Dataverse access for rcm_payerdeckissue.
 *
 * Many msdyn_project rows roll up to one HPI via the
 * pmo_payerinitiatives_hpiissue lookup (single-valued N:1 — same
 * cardinality the legacy cr87a_projects.rcm_payerdeckissue column encoded).
 * Lookup was renamed from pmo_hpiissue to follow the pmo_<team>_<feature>
 * convention. See docs/planning/old-project-migration.md.
 *
 * Schema notes (verified against PROD 2026-07-10):
 *   - rcm_issuenumber -- AutoNumber, format "M-{SEQNUM:1}". Never send
 *     on create; the platform assigns atomically.
 *   - rcm_analyst    -- Lookup to systemuser (SchemaName rcm_Analyst,
 *     Targets: ['systemuser']). Write via
 *     `rcm_Analyst@odata.bind = /systemusers({id})`. Read from
 *     `_rcm_analyst_value` + the FormattedValue annotation for the
 *     resolved fullname.
 */
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';
import { PAYER_INITIATIVES_TEAM_NAMES } from '../constants';
import type { DataSource } from '../../../../lib/taskSource';
import { usesCustomTables } from '../../../../lib/taskSource';

// On the custom source a project's authored data -- including the
// pmo_PayerInitiatives_HpiIssue lookup and _pmo_primaryteam_value -- lives in
// pmo_project, NOT the msdyn_project shell (which only carries msdyn_subject).
// So HPI<->project relate/read must target pmo_projects on custom. The lookup
// nav-prop (pmo_PayerInitiatives_HpiIssue) + FK column
// (_pmo_payerinitiatives_hpiissue_value) are identical on both tables (parity
// rebuild), so only the entity set + id/name columns differ.
interface ProjectTableRef { set: string; idCol: string; nameCol: string }
function projectTable(source: DataSource): ProjectTableRef {
  return usesCustomTables(source)
    ? { set: 'pmo_projects', idCol: 'pmo_projectid', nameCol: 'pmo_subject' }
    : { set: ENTITY_SETS.project, idCol: 'msdyn_projectid', nameCol: 'msdyn_subject' };
}

/**
 * cr87a_arrecoverytype option-set values.
 *
 * Bound to the GLOBAL option set cr87a_mnumberarrecoverytype on both DEV
 * and PROD (mirrored PROD -> DEV in Stage 2.1, 2026-07-13). Values are the
 * actual integers Dataverse stores; labels come back from the OData
 * FormattedValue annotation, but the map lives here as source of truth
 * for the UI's <select> options.
 */
export const AR_RECOVERY_TYPE = {
  Demand:       508640000,
  Project:      508640001,
  Settlement:   508640002,
  TrackingOnly: 508640003,
} as const;
export type ArRecoveryTypeValue = typeof AR_RECOVERY_TYPE[keyof typeof AR_RECOVERY_TYPE];

export const AR_RECOVERY_TYPE_OPTIONS: ReadonlyArray<{ value: ArRecoveryTypeValue; label: string }> = [
  { value: AR_RECOVERY_TYPE.Demand,       label: 'Demand' },
  { value: AR_RECOVERY_TYPE.Project,      label: 'Project' },
  { value: AR_RECOVERY_TYPE.Settlement,   label: 'Settlement' },
  { value: AR_RECOVERY_TYPE.TrackingOnly, label: 'Tracking Only' },
];

/**
 * rcm_risk option-set values.
 * DEV was mirrored to PROD's shape on 2026-07-13 via
 * scripts/mirror-rcm-risk-prod-to-dev.py. Both envs now agree on these
 * 4 clean-label values (plus 4 legacy trailing-space duplicates 100000000-3
 * retained for historical PROD rows). UI writes only these 4 clean values.
 */
export const RISK = {
  External:    909560000,
  Internal:    909560001,
  Shared:      909560002,
  Researching: 909560003,
} as const;
export type RiskValue = typeof RISK[keyof typeof RISK];

export const RISK_OPTIONS: ReadonlyArray<{ value: RiskValue; label: string }> = [
  { value: RISK.External,    label: 'External' },
  { value: RISK.Internal,    label: 'Internal' },
  { value: RISK.Shared,      label: 'Shared' },
  { value: RISK.Researching, label: 'Researching' },
];

const HPI_SELECT = [
  'rcm_payerdeckissueid',
  'rcm_name',
  'rcm_issuenumber',
  // rcm_analyst is a lookup -- read the FK column + the FormattedValue
  // annotation for the resolved fullname (dv.list already emits
  // Prefer: odata.include-annotations="*").
  '_rcm_analyst_value',
  'rcm_reservebucketpayer',
  'rcm_risk',
  'rcm_statusdetails',
  'cr87a_credentialing',
  'cr87a_pathforward',
  'cr87a_arrecoverytype',
  'cr87a_aigeneratedprojectsummary',
  'createdon',
  'modifiedon',
  'statecode',
  'statuscode',
  'ownerid',
];

export interface HpiIssue {
  rcm_payerdeckissueid: string;
  rcm_name?: string;
  /** Auto-numbered by Dataverse via AutoNumberFormat "M-{SEQNUM:1}". */
  rcm_issuenumber?: string;
  /** Systemuser id backing the rcm_Analyst lookup. */
  _rcm_analyst_value?: string;
  /** Resolved analyst fullname; populated by the FormattedValue annotation. */
  '_rcm_analyst_value@OData.Community.Display.V1.FormattedValue'?: string;
  rcm_reservebucketpayer?: string;
  rcm_risk?: number;
  'rcm_risk@OData.Community.Display.V1.FormattedValue'?: string;
  rcm_statusdetails?: string;
  cr87a_credentialing?: boolean;
  'cr87a_credentialing@OData.Community.Display.V1.FormattedValue'?: string;
  cr87a_pathforward?: boolean;
  'cr87a_pathforward@OData.Community.Display.V1.FormattedValue'?: string;
  cr87a_arrecoverytype?: ArRecoveryTypeValue;
  'cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue'?: string;
  cr87a_aigeneratedprojectsummary?: string;
  createdon?: string;
  modifiedon?: string;
  statecode?: 0 | 1;
  statuscode?: number;
  ownerid?: string;
  '_ownerid_value@OData.Community.Display.V1.FormattedValue'?: string;
}

/**
 * The human-facing "name" of an HPI.
 *
 * rcm_name is NOT usable as a title: a pre-existing RCM Power Automate flow
 * ("RCM - Payer Issue Number - New Entry Added", created 2025-06-19) fires
 * asynchronously on every create and overwrites rcm_name with the M- issue
 * number, so it always just equals rcm_issuenumber. We don't own that flow, so
 * instead of fighting it we surface rcm_statusdetails as the descriptive name
 * (that's where the real "what is this issue" text lives). The create/edit
 * forms write the user's "Name" input into rcm_statusdetails for the same
 * reason. Falls back to the issue number, then a placeholder.
 */
export function hpiDisplayName(issue: Pick<HpiIssue, 'rcm_statusdetails' | 'rcm_issuenumber' | 'rcm_name'>): string {
  const details = issue.rcm_statusdetails?.trim();
  if (details) return details;
  const num = issue.rcm_issuenumber?.trim();
  if (num) return num;
  const name = issue.rcm_name?.trim();
  if (name) return name;
  return '(unnamed)';
}

export type HpiStateFilter = 'active' | 'inactive' | 'all';

/**
 * List HPI rows. Pass 'active' (statecode=0), 'inactive' (statecode=1),
 * or 'all' for both. Gallery default is 'active' to match the historical
 * behavior and the way admins usually want to look at the catalog.
 */
export async function listHpiIssues(stateFilter: HpiStateFilter = 'active', extraSelect: string[] = []): Promise<HpiIssue[]> {
  const stateClause =
    stateFilter === 'active' ? 'statecode eq 0'
    : stateFilter === 'inactive' ? 'statecode eq 1'
    : undefined;
  return dv.list<HpiIssue>(ENTITY_SETS.hpiIssue, {
    $select: dv.boundedSelect(HPI_SELECT, extraSelect),
    ...(stateClause ? { $filter: stateClause } : {}),
    $orderby: 'createdon desc',
  });
}

/** @deprecated Use listHpiIssues('active') -- kept for existing callers. */
export async function listActiveHpiIssues(): Promise<HpiIssue[]> {
  return listHpiIssues('active');
}

/** Deactivate an HPI (statecode=1, statuscode=2). Payer Initiatives
 *  members and admins may call this. Related projects keep their HPI
 *  lookup pointing at the deactivated row; the row simply moves out of
 *  the default 'Active' view. */
export async function deactivateHpiIssue(id: string): Promise<void> {
  return dv.deactivate(ENTITY_SETS.hpiIssue, id);
}

/** Reactivate an HPI (statecode=0, statuscode=1). Admin only in the UI
 *  today; kept alongside deactivate as the natural inverse. */
export async function reactivateHpiIssue(id: string): Promise<void> {
  return dv.update(ENTITY_SETS.hpiIssue, id, { statecode: 0, statuscode: 1 });
}

/** Hard-delete an HPI row. Admin only. Any msdyn_project rows still
 *  pointing at this HPI will have their pmo_PayerInitiatives_HpiIssue
 *  lookup automatically nulled by Dataverse cascade (RemoveLink). */
export async function deleteHpiIssue(id: string): Promise<void> {
  return dv.remove(ENTITY_SETS.hpiIssue, id);
}

export async function getHpiIssue(id: string): Promise<HpiIssue> {
  return dv.get<HpiIssue>(ENTITY_SETS.hpiIssue, id, HPI_SELECT);
}

export interface HpiCreateInput {
  /** Optional/legacy. The RCM autonumber flow overwrites rcm_name with the
   *  M- issue number on create, so callers store the human title in
   *  rcm_statusdetails instead. Kept for back-compat but no longer sent. */
  rcm_name?: string;
  /** Systemuser id for the analyst lookup. Optional. */
  analystSystemUserId?: string;
  rcm_reservebucketpayer?: string;
  rcm_risk?: RiskValue;
  rcm_statusdetails?: string;
  cr87a_credentialing?: boolean;
  cr87a_pathforward?: boolean;
  cr87a_arrecoverytype?: ArRecoveryTypeValue;
}

/** Translate an HpiCreateInput into the OData payload. Never emits
 *  rcm_issuenumber -- Dataverse autonumber owns it. */
function buildHpiPayload(input: Partial<HpiCreateInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.rcm_name !== undefined)              payload.rcm_name = input.rcm_name;
  if (input.rcm_reservebucketpayer !== undefined) payload.rcm_reservebucketpayer = input.rcm_reservebucketpayer;
  if (input.rcm_risk !== undefined)              payload.rcm_risk = input.rcm_risk;
  if (input.rcm_statusdetails !== undefined)     payload.rcm_statusdetails = input.rcm_statusdetails;
  if (input.cr87a_credentialing !== undefined)   payload.cr87a_credentialing = input.cr87a_credentialing;
  if (input.cr87a_pathforward !== undefined)     payload.cr87a_pathforward = input.cr87a_pathforward;
  if (input.cr87a_arrecoverytype !== undefined)  payload.cr87a_arrecoverytype = input.cr87a_arrecoverytype;
  if (input.analystSystemUserId !== undefined) {
    payload['rcm_Analyst@odata.bind'] = input.analystSystemUserId
      ? `/systemusers(${input.analystSystemUserId})`
      : null;
  }
  return payload;
}

export async function createHpiIssue(input: HpiCreateInput): Promise<HpiIssue> {
  return dv.create<HpiIssue>(ENTITY_SETS.hpiIssue, buildHpiPayload(input));
}

export async function updateHpiIssue(id: string, patch: Partial<HpiCreateInput>): Promise<void> {
  return dv.update(ENTITY_SETS.hpiIssue, id, buildHpiPayload(patch));
}

/**
 * List the msdyn_project rows currently pointing at this HPI via the
 * pmo_payerinitiatives_hpiissue lookup. Requires the column to exist in
 * the environment; missing-column failures bubble up so the caller can
 * show a helpful "schema not yet imported" message.
 */
export async function listProjectsForHpi(hpiId: string, source: DataSource = 'pss'): Promise<RelatedProject[]> {
  const t = projectTable(source);
  const rows = await dv.list<Record<string, unknown>>(t.set, {
    $select: [t.idCol, t.nameCol, 'statecode'],
    $filter: `_pmo_payerinitiatives_hpiissue_value eq '${hpiId}'`,
    $orderby: `${t.nameCol} asc`,
  });
  // Normalize back to the msdyn_* RelatedProject shape the UI consumes (the id
  // is the same GUID on both tables; subject comes from the source's name col).
  return rows.map((r) => ({
    msdyn_projectid: r[t.idCol] as string,
    msdyn_subject: (r[t.nameCol] as string) ?? undefined,
    statecode: r.statecode as 0 | 1 | undefined,
  }));
}

export interface RelatedProject {
  msdyn_projectid: string;
  msdyn_subject?: string;
  pmo_legacyprojectid?: string;
  statecode?: 0 | 1;
}

/**
 * Returns a map of hpiId -> summary of the active project(s) currently
 * pointing at it. Per the 2026-07-13 operator constraint the UI only allows
 * one project per HPI; if a legacy PROD row has multiple we surface the
 * alphabetically-first subject on the card and expose the total count so
 * callers can flag the (rare) multi-related state.
 *
 * Used by HpiCard to render the related project's actual name on the
 * gallery tile.
 */
export interface HpiProjectSummary {
  projectId: string;
  subject: string;
  legacyProjectId?: string;
  count: number;
}

export async function listHpiProjectSummaries(source: DataSource = 'pss'): Promise<Map<string, HpiProjectSummary>> {
  const t = projectTable(source);
  const rows = await dv.list<Record<string, unknown>>(t.set, {
    $select: [t.idCol, t.nameCol, '_pmo_payerinitiatives_hpiissue_value'],
    $filter: "_pmo_payerinitiatives_hpiissue_value ne null and statecode eq 0",
    $orderby: `${t.nameCol} asc`,
  });
  const out = new Map<string, HpiProjectSummary>();
  for (const row of rows) {
    const hpiId = row._pmo_payerinitiatives_hpiissue_value as string | undefined;
    if (!hpiId) continue;
    const existing = out.get(hpiId);
    if (existing) { existing.count += 1; continue; }
    out.set(hpiId, {
      projectId: row[t.idCol] as string,
      subject: (row[t.nameCol] as string) ?? '(untitled)',
      count: 1,
    });
  }
  return out;
}

/** Bind or clear the HPI lookup on a project. Pass null to unrelate. */
export async function relateProjectToHpi(projectId: string, hpiId: string | null, source: DataSource = 'pss'): Promise<void> {
  const t = projectTable(source);
  const payload: Record<string, unknown> = {
    'pmo_PayerInitiatives_HpiIssue@odata.bind': hpiId ? `/${ENTITY_SETS.hpiIssue}(${hpiId})` : null,
  };
  return dv.update(t.set, projectId, payload);
}

/**
 * List active msdyn_projects owned by the Payer Initiatives team,
 * formatted as options for the HPI create/edit project picker.
 * Pre-populated so operators do not have to type letters to search.
 *
 * Team is resolved by name (PAYER_INITIATIVES_TEAM_NAMES) so the same
 * client works in DEV (custom-Owner GUID) and PROD (AAD team) where
 * the team GUID differs. Projects are filtered by
 * _pmo_primaryteam_value matching one of those team ids.
 *
 * Missing / renamed team is treated as "no matches" (returns []) so
 * the picker degrades gracefully instead of throwing.
 */
export interface PayerInitiativeProjectOption {
  msdyn_projectid: string;
  msdyn_subject?: string;
  pmo_legacyprojectid?: string;
}

export async function listPayerInitiativeProjects(source: DataSource = 'pss'): Promise<PayerInitiativeProjectOption[]> {
  const nameClauses = PAYER_INITIATIVES_TEAM_NAMES
    .map((n) => `name eq '${n.replace(/'/g, "''")}'`)
    .join(' or ');
  const teams = await dv.list<{ teamid: string }>(ENTITY_SETS.team, {
    $select: ['teamid', 'name'],
    $filter: nameClauses,
    $top: 10,
  });
  if (teams.length === 0) return [];
  const teamClause = teams
    .map((t) => `_pmo_primaryteam_value eq ${t.teamid}`)
    .join(' or ');
  const tbl = projectTable(source);
  const rows = await dv.list<Record<string, unknown>>(tbl.set, {
    $select: [tbl.idCol, tbl.nameCol],
    $filter: `statecode eq 0 and (${teamClause})`,
    $orderby: `${tbl.nameCol} asc`,
    $top: 500,
  });
  return rows.map((r) => ({
    msdyn_projectid: r[tbl.idCol] as string,
    msdyn_subject: (r[tbl.nameCol] as string) ?? undefined,
  }));
}
