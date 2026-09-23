/**
 * Intake "extras" holding pen.
 *
 * Until the corresponding Dataverse columns exist on pmo_projectrequest, the
 * fields needed to auto-convert an approved request into a project (PM, Sponsor,
 * Complexity, Strategic Priority, CFR Category) live inside the existing
 * pmo_extractedfieldsjson column under a namespaced sub-object.
 *
 * Layout written to pmo_extractedfieldsjson:
 *   {
 *     // top-level keys owned by the AI extractor (kept untouched):
 *     cfrCategory: 893460053,
 *     ...other AI-extracted keys...,
 *
 *     // namespaced sub-object owned by the intake form / approval gate:
 *     aip_intakeExtras: {
 *       projectManagerId:   '<systemuser guid>',
 *       executiveSponsorId: '<systemuser guid>',
 *       complexity:         893460062,
 *       strategicPriority:  893460070,
 *       cfrCategory:        893460053,   // mirrors the AI value if user confirms/overrides
 *     }
 *   }
 *
 * When real columns get added, this helper is the single read/write surface
 * to swap — every caller goes through readExtras / writeExtras.
 */

import type { ProjectRequest } from '../models/projectRequest.model';
import type { SaeValue } from './sae';

const NAMESPACE = 'aip_intakeExtras';

export interface IntakeExtras {
  projectManagerId?: string;
  executiveSponsorId?: string;
  complexity?: number;
  strategicPriority?: number;
  cfrCategory?: number;
  /** Optional msdyn_projectprogram GUID. Stamped on the created project as
   *  msdyn_Program@odata.bind during conversion so the project lands under
   *  the chosen program from day one. Only meaningful for project flows;
   *  ignored when the request type is New Program. */
  targetProgramId?: string;
  /** Optional list of cr87a_system GUIDs. The intake's pmo_AffectedSystem
   *  column is a single-row lookup so multi-select state lives here in the
   *  extras holding pen. The first id in the array is also written to the
   *  real lookup column for back-compat with everything that currently
   *  reads pmo_AffectedSystem (display chip on detail page, etc.). */
  affectedSystemIds?: string[];
  /** Optional rcm_payerdeckissue GUID. Visible on the Project Setup stage
   *  ONLY when the requester picked Payer Initiatives as Primary Team; the
   *  conversion path stamps it on the resulting msdyn_project as
   *  pmo_PayerInitiatives_HpiIssue@odata.bind. Lives in the holding pen
   *  because the HPI lookup column doesn't exist on pmo_projectrequest
   *  in PROD (it lives only on msdyn_project). */
  hpiIssueId?: string;
  /** Optional list of cr87a_payerissue GUIDs the requester picked. Visible
   *  on Project Setup ONLY when Payer Initiatives is the selected Primary
   *  Team. INTENT CAPTURE ONLY today — the existing cr87a_projects lookup
   *  on cr87a_payerissue points at the legacy cr87a_projects table, not
   *  msdyn_project, so the conversion path does not write a relational
   *  link yet. Once a cr87a_payerissue → msdyn_project lookup (or junction
   *  table) lands in the schema, the conversion path stamps each selected
   *  payer issue with the new project id. */
  payerIssueIds?: string[];
  /** Optional Strategic Account Executive identity (Payer Initiatives team
   *  feature). Visible on the Project Setup stage ONLY when Payer Initiatives
   *  is the selected Primary Team. Stored as a direct AAD snapshot (object id
   *  + name + email) rather than a systemuser lookup -- most SAEs have no
   *  systemuser row. Conversion stamps the three pmo_payerinitiatives_sae*
   *  columns on the resulting msdyn_project via saeWritePayload(). See
   *  docs/planning/sae-systemuser-to-aad-transition-plan.md. */
  strategicAccountExecutive?: SaeValue;
  /** Optional systemuser GUID chosen by a cross-team requester to receive the
   *  request notification (instead of the whole target team). Visibility on the
   *  queue stays team-wide; only the notification narrows to this person. */
  requestedForUserId?: string;
}

/** Field-key catalog used by the stage form + approval gate. Stable strings so
 *  IntakeStageEditor admins can opt-in fields per stage by name. */
export const EXTRAS_FIELD_KEYS = {
  projectManagerId:   'extras.projectManagerId',
  executiveSponsorId: 'extras.executiveSponsorId',
  complexity:         'extras.complexity',
  strategicPriority:  'extras.strategicPriority',
  cfrCategory:        'extras.cfrCategory',
  targetProgramId:    'extras.targetProgramId',
  affectedSystemIds:  'extras.affectedSystemIds',
  hpiIssueId:         'extras.hpiIssueId',
  payerIssueIds:      'extras.payerIssueIds',
  strategicAccountExecutive: 'extras.strategicAccountExecutive',
} as const;

export type ExtrasFieldKey = typeof EXTRAS_FIELD_KEYS[keyof typeof EXTRAS_FIELD_KEYS];

/** Display labels for the holding-pen fields (used by IntakeStageEditor + StageForm). */
export const EXTRAS_FIELD_LABELS: Record<ExtrasFieldKey, string> = {
  [EXTRAS_FIELD_KEYS.projectManagerId]:   'Project Manager',
  [EXTRAS_FIELD_KEYS.executiveSponsorId]: 'Executive Sponsor',
  [EXTRAS_FIELD_KEYS.complexity]:         'Complexity',
  [EXTRAS_FIELD_KEYS.strategicPriority]:  'Strategic Priority',
  [EXTRAS_FIELD_KEYS.cfrCategory]:        'CFR Category',
  [EXTRAS_FIELD_KEYS.targetProgramId]:    'Program (optional)',
  [EXTRAS_FIELD_KEYS.affectedSystemIds]:  'Affected Systems',
  // Team-specific extras follow the "<Team Display Name>: <Feature>" naming
  // convention — see docs/team-feature-conventions.md. Always-optional
  // fields carry "(Optional)" in the title rather than as hint text.
  [EXTRAS_FIELD_KEYS.hpiIssueId]:                 'Payer Initiative Team: HPI (Optional)',
  [EXTRAS_FIELD_KEYS.payerIssueIds]:              'Payer Initiative Team: Payer Inquiries (Optional)',
  [EXTRAS_FIELD_KEYS.strategicAccountExecutive]: 'Payer Initiative Team: Strategic Account Executive (Optional)',
};

/** Map an extras-field key to its IntakeExtras property name. */
export function extrasKeyToProp(key: ExtrasFieldKey): keyof IntakeExtras {
  switch (key) {
    case EXTRAS_FIELD_KEYS.projectManagerId:   return 'projectManagerId';
    case EXTRAS_FIELD_KEYS.executiveSponsorId: return 'executiveSponsorId';
    case EXTRAS_FIELD_KEYS.complexity:         return 'complexity';
    case EXTRAS_FIELD_KEYS.strategicPriority:  return 'strategicPriority';
    case EXTRAS_FIELD_KEYS.cfrCategory:        return 'cfrCategory';
    case EXTRAS_FIELD_KEYS.targetProgramId:    return 'targetProgramId';
    case EXTRAS_FIELD_KEYS.affectedSystemIds:  return 'affectedSystemIds';
    case EXTRAS_FIELD_KEYS.hpiIssueId:          return 'hpiIssueId';
    case EXTRAS_FIELD_KEYS.payerIssueIds:       return 'payerIssueIds';
    case EXTRAS_FIELD_KEYS.strategicAccountExecutive: return 'strategicAccountExecutive';
  }
}

/** True if `key` is one of the synthetic extras.* keys handled by this module. */
export function isExtrasKey(key: string): key is ExtrasFieldKey {
  return key.startsWith('extras.');
}

function parseExtractedJson(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Read holding-pen extras from a request. Falls back to top-level cfrCategory
 * (written by the AI extractor) if the namespaced cfrCategory is absent.
 */
export function readExtras(request: Pick<ProjectRequest, 'pmo_extractedfieldsjson'>): IntakeExtras {
  const root = parseExtractedJson(request.pmo_extractedfieldsjson);
  const ns = (root[NAMESPACE] as Record<string, unknown> | undefined) ?? {};

  const out: IntakeExtras = {};
  if (typeof ns.projectManagerId === 'string')   out.projectManagerId   = ns.projectManagerId;
  if (typeof ns.executiveSponsorId === 'string') out.executiveSponsorId = ns.executiveSponsorId;
  if (typeof ns.complexity === 'number')         out.complexity         = ns.complexity;
  if (typeof ns.strategicPriority === 'number')  out.strategicPriority  = ns.strategicPriority;
  if (typeof ns.cfrCategory === 'number')        out.cfrCategory        = ns.cfrCategory;
  else if (typeof root.cfrCategory === 'number') out.cfrCategory        = root.cfrCategory;
  if (typeof ns.targetProgramId === 'string')    out.targetProgramId    = ns.targetProgramId;
  if (Array.isArray(ns.affectedSystemIds)) {
    const ids = (ns.affectedSystemIds as unknown[]).filter((v): v is string => typeof v === 'string');
    if (ids.length > 0) out.affectedSystemIds = ids;
  }
  if (typeof ns.hpiIssueId === 'string')          out.hpiIssueId          = ns.hpiIssueId;
  if (Array.isArray(ns.payerIssueIds)) {
    const ids = (ns.payerIssueIds as unknown[]).filter((v): v is string => typeof v === 'string');
    if (ids.length > 0) out.payerIssueIds = ids;
  }
  if (ns.strategicAccountExecutive && typeof ns.strategicAccountExecutive === 'object') {
    const sae = ns.strategicAccountExecutive as Record<string, unknown>;
    const v: SaeValue = {};
    if (typeof sae.aadId === 'string') v.aadId = sae.aadId;
    if (typeof sae.displayName === 'string') v.displayName = sae.displayName;
    if (typeof sae.email === 'string') v.email = sae.email;
    if (v.aadId || v.displayName || v.email) out.strategicAccountExecutive = v;
  }

  if (typeof ns.requestedForUserId === 'string') out.requestedForUserId = ns.requestedForUserId;

  return out;
}

/**
 * Merge a patch into the holding pen and return a new pmo_extractedfieldsjson
 * string. The AI extractor's top-level keys are preserved untouched. Callers
 * pass the result to updateProjectRequest({ pmo_extractedfieldsjson: ... }).
 *
 * Pass `undefined` for a property to leave it unchanged. Pass `null` (cast) to
 * delete it. Empty strings on lookup IDs delete the key as well.
 */
export function writeExtras(
  request: Pick<ProjectRequest, 'pmo_extractedfieldsjson'>,
  patch: Partial<IntakeExtras>,
): string {
  const root = parseExtractedJson(request.pmo_extractedfieldsjson);
  const ns: Record<string, unknown> = { ...((root[NAMESPACE] as Record<string, unknown>) ?? {}) };

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === '' || v === null) { delete ns[k]; continue; }
    if (Array.isArray(v) && v.length === 0) { delete ns[k]; continue; }
    // Empty SaeValue object (all fields blank) clears the field.
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => !x)) {
      delete ns[k]; continue;
    }
    ns[k] = v;
  }

  // Mirror confirmed cfrCategory back to the top level so the existing
  // ProjectOnboardingWizard prefill (which reads root.cfrCategory directly)
  // keeps working without refactoring every consumer.
  if (typeof ns.cfrCategory === 'number') {
    root.cfrCategory = ns.cfrCategory;
  }

  root[NAMESPACE] = ns;
  return JSON.stringify(root);
}
