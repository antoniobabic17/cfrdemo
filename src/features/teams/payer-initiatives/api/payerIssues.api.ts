/**
 * Payer Issues — Dataverse access for cr87a_payerissue.
 *
 * This is the FULL Payer Issue catalog — distinct from rcm_payerdeckissue
 * (HPI / Health Plan Issue) which is its own table on a different cadence.
 * Both surface in the Payer Initiatives feature pack.
 *
 * Cardinality note: the existing cr87a_payerissue.cr87a_projects lookup
 * points at the LEGACY cr87a_projects table (display name "Project"), not
 * at msdyn_project that this app uses. Until a cr87a_payerissue →
 * msdyn_project lookup (or junction table) lands in the schema, the
 * intake conversion path stores selections in extras.payerIssueIds for
 * intent capture only — no relational write back to cr87a_payerissue
 * happens yet. See docs/expand-legacy-cfr-roles-plan.md follow-up.
 */
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';

/** True when the error is Dataverse's "entity does not exist in this org"
 *  signal — used to short-circuit Payer Inquiries reads gracefully in
 *  environments (e.g. CFR DEV) where the cr87a_payerissue table isn't
 *  imported. Lets the gallery + picker render empty instead of erroring. */
function isEntityNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('0x80040217')
    || /Could not find an entity with specified entity logicalname/.test(msg)
    || /Resource not found for the segment/.test(msg);
}

// cr87a_payername is an auto-denormalization of the cr87a_payer lookup —
// Dataverse exposes it in metadata but it's NOT valid in $select (the OData
// engine rejects it with 0x80060888). Read the payer name from the lookup
// value's auto-returned FormattedValue annotation instead.
const PAYER_ISSUE_SELECT = [
  'cr87a_payerissueid',
  'cr87a_name',
  'cr87a_payerissueidauto',
  'cr87a_shortdescription',
  'cr87a_detailedissue',
  '_cr87a_payer_value',
  'cr87a_payerissuestatus',
  'cr87a_payerissuetype',
  // Modern lookup to msdyn_project, added via
  // scripts/add-payerinitiatives-msdynproject-on-payerissue.py.
  '_pmo_payerinitiatives_msdynproject_value',
  // NEW canonical lookup -> pmo_project (custom source). Migration + new writes
  // use this; the msdyn one is kept only for legacy rows not yet re-pointed.
  '_pmo_payerinitiatives_project_value',
  // Assigned analyst (systemuser lookup) — mirrors HPI's rcm_analyst. Powers
  // the Payer Inquiries analyst filter/tile/form. DEV catch-up column added
  // 2026-08-17 to match PROD (scripts/add-assignedanalyst-on-payerissue-dev.py).
  '_cr87a_assignedanalyst_value',
  'createdon',
  'modifiedon',
  'statecode',
  'statuscode',
  // Legacy File-column attachment names (from the old model-driven app). The
  // File columns themselves return only a GUID pointer; the `_name` companion
  // tells us which of the 7 slots are populated. Download via
  // payerIssueFiles.openLegacyFile (SDK downloadFileFromRecord). Read-only.
  '_createdby_value',
  'rcm_accepteddate',
  'cr87a_response',
  'cr87a_supportingdocumentation_name',
  'cr87a_patientdocument1_name',
  'cr87a_patientdocument2_name',
  'cr87a_patientdocument3_name',
  'cr87a_patientdocument4_name',
  'cr87a_patientdocument5_name',
  'cr87a_patientdocument6_name',
];

export interface PayerIssue {
  cr87a_payerissueid: string;
  cr87a_name?: string;
  cr87a_payerissueidauto?: string;
  cr87a_shortdescription?: string;
  '_cr87a_payer_value'?: string;
  '_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'?: string;
  cr87a_payerissuestatus?: number;
  cr87a_payerissuetype?: number;
  'cr87a_payerissuestatus@OData.Community.Display.V1.FormattedValue'?: string;
  'cr87a_payerissuetype@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_payerinitiatives_msdynproject_value'?: string;
  '_pmo_payerinitiatives_msdynproject_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_pmo_payerinitiatives_project_value'?: string;
  '_pmo_payerinitiatives_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_cr87a_assignedanalyst_value'?: string;
  '_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'?: string;
  cr87a_detailedissue?: string;
  createdon?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  rcm_accepteddate?: string;
  cr87a_response?: string;
  modifiedon?: string;
  statecode?: 0 | 1;
  statuscode?: number;
  // Legacy File-column attachment names (read-only; download via payerIssueFiles).
  cr87a_supportingdocumentation_name?: string;
  cr87a_patientdocument1_name?: string;
  cr87a_patientdocument2_name?: string;
  cr87a_patientdocument3_name?: string;
  cr87a_patientdocument4_name?: string;
  cr87a_patientdocument5_name?: string;
  cr87a_patientdocument6_name?: string;
}

// Payer Issue status / type option-set values (verified live on PROD 2026-08-13).
// Labels come from the OData FormattedValue annotation; these maps are the UI
// source of truth for the edit form's <select> options.
/** cr87a_payerissuestatus option value for "New" — drives the yellow row fill +
 *  the "Requires action" queue on the Payer Inquiries list. */
export const PAYER_ISSUE_STATUS_NEW = 508640005;

export const PAYER_ISSUE_STATUS_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 508640000, label: 'Approved' },
  { value: 508640001, label: 'Not Approved' },
  { value: 508640002, label: 'Pending' },
  { value: 508640003, label: 'Completed' },
  { value: 508640004, label: 'Additional Information Required' },
  { value: 508640005, label: 'New' },
];
export const PAYER_ISSUE_TYPE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 508640000, label: '837 Issue' },
  { value: 508640001, label: 'NCPDP Issue' },
  { value: 508640002, label: 'Billing Related' },
  { value: 508640005, label: 'Auth/No Auth Discrepancy' },
  { value: 508640006, label: 'NPI/Credentialing/Enrollment Related' },
  { value: 508640007, label: 'Nurse Visits Not Billed Related' },
];

export type PayerIssueStateFilter = 'active' | 'inactive' | 'all';

/** List payer issues by lifecycle state. 'active' (statecode=0), 'inactive'
 *  (statecode=1), or 'all'. Mirrors listHpiIssues. */
export async function listPayerIssues(
  stateFilter: PayerIssueStateFilter = 'active',
  extraSelect: string[] = [],
): Promise<PayerIssue[]> {
  const stateClause =
    stateFilter === 'active' ? 'statecode eq 0'
    : stateFilter === 'inactive' ? 'statecode eq 1'
    : undefined;
  try {
    return await dv.list<PayerIssue>(ENTITY_SETS.payerIssue, {
      // Base curated columns + any view-driven columns (bounded to dodge the
      // 0x80060888 URL-length limit) so a column added to a view actually fetches.
      $select: dv.boundedSelect(PAYER_ISSUE_SELECT, extraSelect),
      ...(stateClause ? { $filter: stateClause } : {}),
      $orderby: 'createdon desc',
    });
  } catch (err) {
    if (isEntityNotFoundError(err)) {
      console.warn('[payerIssues] cr87a_payerissue table not present in this env; returning empty list.');
      return [];
    }
    throw err;
  }
}

/** @deprecated Use listPayerIssues('active'). */
export async function listActivePayerIssues(): Promise<PayerIssue[]> {
  return listPayerIssues('active');
}

/** Deactivate a payer issue (statecode=1). */
export async function deactivatePayerIssue(id: string): Promise<void> {
  return dv.deactivate(ENTITY_SETS.payerIssue, id);
}

/** Reactivate a payer issue (statecode=0, statuscode=1). */
export async function reactivatePayerIssue(id: string): Promise<void> {
  return dv.update(ENTITY_SETS.payerIssue, id, { statecode: 0, statuscode: 1 });
}

/** Hard-delete a payer issue. Admin only in the UI. */
export async function deletePayerIssue(id: string): Promise<void> {
  return dv.remove(ENTITY_SETS.payerIssue, id);
}

export async function getPayerIssue(id: string): Promise<PayerIssue> {
  return dv.get<PayerIssue>(ENTITY_SETS.payerIssue, id, PAYER_ISSUE_SELECT);
}

/** List active payer issues currently linked to a given msdyn_project. */
export async function listPayerIssuesForProject(projectId: string): Promise<PayerIssue[]> {
  try {
    return await dv.list<PayerIssue>(ENTITY_SETS.payerIssue, {
      $select: PAYER_ISSUE_SELECT,
      $filter: `statecode eq 0 and _pmo_payerinitiatives_project_value eq '${projectId}'`,
      $orderby: 'createdon desc',
    });
  } catch (err) {
    if (isEntityNotFoundError(err)) {
      console.warn('[payerIssues] cr87a_payerissue table not present in this env; returning empty list.');
      return [];
    }
    throw err;
  }
}

/** Bind a single payer issue to a project. Pass null to clear. */
export async function setPayerIssueProject(payerIssueId: string, projectId: string | null): Promise<void> {
  const payload: Record<string, unknown> = {
    'pmo_PayerInitiatives_Project@odata.bind': projectId
      ? `/pmo_projects(${projectId})`
      : null,
  };
  return dv.update(ENTITY_SETS.payerIssue, payerIssueId, payload);
}

/** Attach a list of payer issues to a project (best-effort, sequential). */
export async function attachPayerIssuesToProject(payerIssueIds: string[], projectId: string): Promise<void> {
  for (const id of payerIssueIds) {
    await setPayerIssueProject(id, projectId);
  }
}

export interface PayerIssueCreateInput {
  cr87a_name: string;
  cr87a_shortdescription?: string;
  cr87a_detailedissue?: string;
  /** Optional assigned analyst (systemuserid) bound at create. */
  analystSystemUserId?: string | null;
}

/** Create a new payer issue. Minimal-field create — additional columns
 *  (status / type picklists, lookups to payer master, etc.) can be added
 *  later via the source-of-truth Nexus Revenue Cycle Manager app or via
 *  a future enrichment dialog. */
export async function createPayerIssue(input: PayerIssueCreateInput): Promise<PayerIssue> {
  const { analystSystemUserId, ...rest } = input;
  const payload: Record<string, unknown> = { ...rest };
  if (analystSystemUserId) {
    payload['cr87a_AssignedAnalyst@odata.bind'] = `/systemusers(${analystSystemUserId.replace(/[{}]/g, '')})`;
  }
  return dv.create<PayerIssue>(ENTITY_SETS.payerIssue, payload);
}

export interface PayerIssueUpdateInput {
  cr87a_name?: string;
  cr87a_shortdescription?: string;
  cr87a_detailedissue?: string;
  cr87a_payerissuestatus?: number | null;
  cr87a_payerissuetype?: number | null;
  // Accepted Date — ISO datetime (noon-UTC) or null to clear.
  rcm_accepteddate?: string | null;
  // Response / reason (Memo) — text or null to clear.
  cr87a_response?: string | null;
  // systemuserid of the assigned analyst, or null to clear. Bound to the
  // cr87a_AssignedAnalyst lookup (mirrors HPI's rcm_Analyst).
  analystSystemUserId?: string | null;
}

/** Patch editable fields on a payer issue. Only provided keys are sent. */
export async function updatePayerIssue(id: string, patch: PayerIssueUpdateInput): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.cr87a_name !== undefined) payload.cr87a_name = patch.cr87a_name;
  if (patch.cr87a_shortdescription !== undefined) payload.cr87a_shortdescription = patch.cr87a_shortdescription;
  if (patch.cr87a_detailedissue !== undefined) payload.cr87a_detailedissue = patch.cr87a_detailedissue;
  if (patch.cr87a_payerissuestatus !== undefined) payload.cr87a_payerissuestatus = patch.cr87a_payerissuestatus;
  if (patch.cr87a_payerissuetype !== undefined) payload.cr87a_payerissuetype = patch.cr87a_payerissuetype;
  if (patch.rcm_accepteddate !== undefined) payload.rcm_accepteddate = patch.rcm_accepteddate;
  if (patch.cr87a_response !== undefined) payload.cr87a_response = patch.cr87a_response;
  // Analyst is a systemuser lookup: bind by nav prop, or clear with null.
  if (patch.analystSystemUserId !== undefined) {
    payload['cr87a_AssignedAnalyst@odata.bind'] = patch.analystSystemUserId
      ? `/systemusers(${patch.analystSystemUserId.replace(/[{}]/g, '')})`
      : null;
  }
  return dv.update(ENTITY_SETS.payerIssue, id, payload);
}
