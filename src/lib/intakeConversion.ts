import type { ProjectRequest } from '../models/projectRequest.model';
import { projectBindLoose } from './projectLookupRef';
import { toDataverseDateOnly, todayLocalYmd } from './dateOnly';
import type { ConversionRule, StageArtifact } from './intakeValidation';
import * as dv from './dataverseClient';
import { ENTITY_SETS, CONVERSION_TARGET, P4W_GUIDS_BY_ENV, RESOURCE_METRIC_TYPE, type P4WEnvIds } from './constants';
import { getCachedEnvironmentId } from './deepLink';
import { getCachedP4WEnvIds } from './environmentConfig';
import { readExtras, EXTRAS_FIELD_LABELS, EXTRAS_FIELD_KEYS } from './intakeExtras';
import { saeWritePayload, hasSae } from './sae';
import {
  PAYER_INITIATIVES_TEAM_ID,
  PAYER_INITIATIVES_TEAM_NAMES,
} from '../features/teams/payer-initiatives/constants';

/**
 * Resolve the P4W env-pinned GUIDs (calendar, work-hours template,
 * organizational unit) for the current Power Apps environment.
 *
 * Returns undefined for environments we have not yet baked values for; the
 * caller should then omit those binds and let the legacy CFRIntakeToProject
 * flow populate them. See P4W_GUIDS_BY_ENV in constants.ts.
 */
export function getP4WEnvIds(): P4WEnvIds | undefined {
  // Prefer the admin override (pmo.p4w_env_guids_json) resolved by
  // ConfigurationProvider into the environmentConfig cache; a new environment can
  // supply its own P4W GUIDs via config without a code change. When unset, fall
  // back to the compiled per-env table keyed by the live environmentId -- EXACTLY
  // the legacy behavior.
  const override = getCachedP4WEnvIds();
  if (override) return override;
  const envId = getCachedEnvironmentId();
  if (!envId) return undefined;
  return P4W_GUIDS_BY_ENV[envId];
}

export interface ConversionResult {
  prefill: Record<string, unknown>;
  lockedFields: string[];
}

export function applyConversionRules(
  request: ProjectRequest,
  rulesJson: string | undefined,
): ConversionResult {
  const prefill: Record<string, unknown> = {};
  const lockedFields: string[] = [];

  if (!rulesJson) return { prefill, lockedFields };

  let rules: ConversionRule[];
  try {
    rules = JSON.parse(rulesJson);
    if (!Array.isArray(rules)) return { prefill, lockedFields };
  } catch {
    return { prefill, lockedFields };
  }

  for (const rule of rules) {
    const intakeValue = (request as unknown as Record<string, unknown>)[rule.intakeField];
    if (intakeValue === undefined || intakeValue === null || intakeValue === '') continue;

    if (rule.transform === 'odata_bind' && typeof intakeValue === 'string') {
      const entitySet = resolveEntitySetForField(rule.intakeField);
      if (entitySet) {
        prefill[rule.projectField] = `/${entitySet}(${intakeValue})`;
      }
    } else {
      prefill[rule.projectField] = intakeValue;
    }
    lockedFields.push(rule.projectField);
  }

  return { prefill, lockedFields };
}

function resolveEntitySetForField(intakeField: string): string | undefined {
  const fieldToEntity: Record<string, string> = {
    '_pmo_targetteam_value': 'teams',
    '_pmo_affectedsystem_value': 'cr87a_systems',
    '_pmo_requestedby_value': 'systemusers',
  };
  return fieldToEntity[intakeField];
}

export async function carryOverArtifacts(
  stageArtifactsJson: string | undefined,
  projectId: string,
  projectCategory: number | undefined,
): Promise<number> {
  if (!stageArtifactsJson) return 0;

  let stageArtifacts: StageArtifact[];
  try {
    stageArtifacts = JSON.parse(stageArtifactsJson);
    if (!Array.isArray(stageArtifacts)) return 0;
  } catch {
    return 0;
  }

  const artifactDefs = await dv.list<Record<string, unknown>>(ENTITY_SETS.requiredArtifact, {
    $select: ['pmo_requiredartifactid', 'pmo_artifacttype', 'pmo_cfrcategory', 'pmo_isrequired'],
    $filter: 'statecode eq 0 and pmo_isrequired eq true',
  });

  let carried = 0;
  for (const artifact of stageArtifacts) {
    const matchingDef = artifactDefs.find((d) => {
      const defType = d.pmo_artifacttype as number;
      const defCategory = d.pmo_cfrcategory as number | null;
      return defType === artifact.artifactType &&
        (defCategory == null || defCategory === projectCategory);
    });

    if (matchingDef) {
      await dv.create(ENTITY_SETS.projectArtifactStatus, {
        pmo_status: 893460122, // ARTIFACT_STATUS.Complete
        pmo_completeddate: toDataverseDateOnly(todayLocalYmd()),
        pmo_notes: `Carried over from intake (${artifact.fileName})`,
        ...projectBindLoose(projectId),
        'pmo_RequiredArtifact@odata.bind': `/pmo_requiredartifacts(${(matchingDef as Record<string, unknown>).pmo_requiredartifactid})`,
      });
      carried++;
    }
  }

  return carried;
}

// ─── Auto-conversion helpers (called by StageApprovalPanel on final approval) ──

/**
 * Fields that must be populated on a request before it can auto-convert into
 * a project. Mirrors the createProject payload built by buildProjectPayload
 * below — keep the two in sync.
 *
 * Project requests need: name, primary team, start date, PM, sponsor,
 *                        complexity, strategic priority, CFR category.
 * Program requests need: name, start date, PM. (Program rows have a smaller
 *                        column surface — no sponsor / complexity / priority.)
 */
interface RequiredFieldSpec {
  /** Human-readable label shown in the missing-fields error. */
  label: string;
  /** Returns true when the value is present on the request. */
  isPresent: (req: ProjectRequest) => boolean;
}

/**
 * Detects whether the request's Primary Team is Payer Initiatives, by
 * either the historic custom Owner GUID or the AAD-team name (varies per
 * env). Kept local to the validator so the readiness rules can drop
 * fields the Payer Initiatives workflow considers not-applicable
 * (currently: CFR Category -- their projects use HPI + Payer Inquiries
 * as the category axis, not the CFR taxonomy).
 */
function isPayerInitiativesRequest(r: ProjectRequest): boolean {
  const teamId = r['_pmo_targetteam_value'];
  if (!teamId) return false;
  if (teamId.toLowerCase() === PAYER_INITIATIVES_TEAM_ID.toLowerCase()) return true;
  const label = r['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'];
  if (!label) return false;
  const namesLower = new Set(PAYER_INITIATIVES_TEAM_NAMES.map((n) => n.trim().toLowerCase()));
  return namesLower.has(label.trim().toLowerCase());
}

function projectRequiredFields(request: ProjectRequest): RequiredFieldSpec[] {
  const specs: RequiredFieldSpec[] = [
    { label: 'Request Name',          isPresent: (r) => !!r.pmo_name },
    { label: 'Primary Team',          isPresent: (r) => !!r['_pmo_targetteam_value'] },
    { label: 'Requested Start Date',  isPresent: (r) => !!r.pmo_requestedstartdate },
    { label: EXTRAS_FIELD_LABELS[EXTRAS_FIELD_KEYS.projectManagerId],   isPresent: (r) => !!readExtras(r).projectManagerId },
    { label: EXTRAS_FIELD_LABELS[EXTRAS_FIELD_KEYS.executiveSponsorId], isPresent: (r) => !!readExtras(r).executiveSponsorId },
    // Complexity + Strategic Priority removed from intake (2026-09) — no longer
    // asked and never required to create a project.
  ];
  // CFR Category is required for every team EXCEPT Payer Initiatives --
  // their projects are categorized by HPI / Payer Inquiries instead, and
  // asking approvers to pick a CFR bucket for them adds noise. Mirrors the
  // team-scoped optional-field policy in GovernedIntakeWizard
  // (PAYER_INITIATIVES_OPTIONAL_FIELDS).
  if (!isPayerInitiativesRequest(request)) {
    specs.push({
      label: EXTRAS_FIELD_LABELS[EXTRAS_FIELD_KEYS.cfrCategory],
      isPresent: (r) => readExtras(r).cfrCategory != null,
    });
  }
  return specs;
}

function programRequiredFields(): RequiredFieldSpec[] {
  // Program Manager IS required on program intake (collected on the Governance
  // Structure stage -- see GovernedIntakeWizard sortedStages injection). Maps
  // to proj_Manager on the program at conversion (buildProgramPayload).
  return [
    { label: 'Request Name',          isPresent: (r) => !!r.pmo_name },
    { label: 'Requested Start Date',  isPresent: (r) => !!r.pmo_requestedstartdate },
    { label: EXTRAS_FIELD_LABELS[EXTRAS_FIELD_KEYS.projectManagerId], isPresent: (r) => !!readExtras(r).projectManagerId },
  ];
}

/**
 * Validate a request is ready to auto-convert. Returns a list of
 * missing-field labels — empty list means the request can be converted now.
 */
export function validateConversionReadiness(request: ProjectRequest): string[] {
  const isProgram = request.pmo_conversiontarget === CONVERSION_TARGET.Program;
  const specs = isProgram ? programRequiredFields() : projectRequiredFields(request);
  return specs.filter((s) => !s.isPresent(request)).map((s) => s.label);
}

/**
 * Build the createProject payload from an approved request. Reads both
 * standard columns and the holding-pen extras, returns a ready-to-POST object
 * for `createProject`. Caller is responsible for the post-create side-effects
 * (primary-team membership row, template application, artifact carry-over).
 */
export function buildProjectPayload(request: ProjectRequest): Record<string, unknown> {
  const extras = readExtras(request);
  const payload: Record<string, unknown> = {
    msdyn_subject: request.pmo_name,
  };

  // P4W env-pinned lookups (calendar, work-hours template, contracting org
  // unit). Same code runs in DEV and PROD - schema names are stock Microsoft
  // Project for the Web and identical across environments. Only the GUIDs
  // differ per env (selected by getP4WEnvIds()).
  //
  // Each lookup needs THREE matching pieces:
  //   1. Nav property name (left of @odata.bind) - case-sensitive
  //   2. Entity set name (inside the URL parentheses)
  //   3. The GUID itself
  // Get any of them wrong and Dataverse rejects with 0x80048d19 (undeclared
  // property) or 0x80060888 (resource not found for the segment).
  //
  // Names verified against:
  //   solution/src/Other/Relationships/msdyn_workhourtemplate.xml
  //   solution/src/Other/Relationships/msdyn_organizationalunit.xml
  // If you change these, re-verify both files first.
  //
  // For envs we have not baked GUIDs for (e.g. UAT today) we omit these
  // fields entirely so the legacy CFRIntakeToProject flow can still set them.
  const envIds = getP4WEnvIds();
  if (envIds) {
    // msdyn_calendarid is a *string* column on msdyn_project, not a lookup,
    // so it goes in directly (no @odata.bind).
    payload.msdyn_calendarid = envIds.calendarId;

    // Work-hours template: nav property = 'msdyn_workhourtemplate' (no Id
    // suffix), entity set = 'msdyn_workhourtemplates' (singular 'hour', not
    // 'hours'). Earlier typo 'msdyn_workhourstemplates' failed in PROD.
    payload['msdyn_workhourtemplate@odata.bind'] =
      `/msdyn_workhourtemplates(${envIds.workHoursTemplateId})`;

    // Contracting org unit: nav property = PascalCase
    // 'msdyn_ContractOrganizationalUnitId' (WITH Id suffix - different
    // convention from work-hours template). Entity set =
    // 'msdyn_organizationalunits'.
    payload['msdyn_ContractOrganizationalUnitId@odata.bind'] =
      `/msdyn_organizationalunits(${envIds.orgUnitId})`;
  }

  // Description prefers the verbatim submission text, falls back to pmo_description.
  const desc = request.pmo_submissiontext ?? request.pmo_description;
  if (desc) payload.msdyn_description = desc;

  if (request.pmo_requestedstartdate) payload.msdyn_scheduledstart = toDataverseDateOnly(request.pmo_requestedstartdate);
  // Persist the requester's target completion date on the project itself as
  // `proj_scheduledcompletion` so the Details tab can show the original ask
  // alongside the PSS-owned `msdyn_finish`. Do NOT write msdyn_finish here --
  // Project for the Web owns that column and computes it from task dates.
  // Writing to msdyn_finish on create previously either got clobbered by PSS
  // or was silently discarded; either way it was the wrong source of truth
  // for the requester's target date. See docs/planning/PMOCFRSolution__
  // ImplementationPlan__WorkingDocument.md 2026-07-07 for the split-schedule
  // rework rationale.
  if (request.pmo_targetcompletiondate) payload.proj_scheduledcompletion = toDataverseDateOnly(request.pmo_targetcompletiondate);
  if (typeof request.pmo_estimatedbudget === 'number') payload.proj_budget = request.pmo_estimatedbudget;
  // New Resource Model: carry the requester's top-down labor-hours estimate
  // onto the created project. Written to pmo_project only (custom-source
  // table) -- Forecasted Labor Hours is a New-Resource-Model concept, not
  // part of the PSS/msdyn_project schema.
  if (typeof request.pmo_forecastedlaborhours === 'number') {
    payload.pmo_forecastedlaborhours = request.pmo_forecastedlaborhours;
  }
  // Resource Metric Type: Labor (default) vs Financial. Carried onto the new
  // pmo_project. Default to Labor when the request has no explicit value, so
  // every converted project starts labor-based (business rule).
  payload.pmo_resourcemetrictype = typeof request.pmo_resourcemetrictype === 'number'
    ? request.pmo_resourcemetrictype
    : RESOURCE_METRIC_TYPE.Labor;

  if (extras.cfrCategory != null)       payload.pmo_cfrcategory = extras.cfrCategory;
  if (extras.complexity != null)        payload.pmo_complexity = extras.complexity;
  if (extras.strategicPriority != null) payload.pmo_strategicpriority = extras.strategicPriority;

  // Affected Systems — carry the standardized multi-select Choice from the
  // request onto the new project. Direct value (comma-joined option values);
  // the column exists on both msdyn_project (PSS) and pmo_project (custom).
  if (request.pmo_affectedsystems) payload.pmo_affectedsystems = request.pmo_affectedsystems;

  // Lookup binds — use NavigationPropertyName (PascalCase schema name).
  const teamId = request['_pmo_targetteam_value'];
  if (teamId) payload['pmo_PrimaryTeam@odata.bind'] = `/teams(${teamId})`;
  if (extras.projectManagerId)   payload['msdyn_projectmanager@odata.bind']  = `/systemusers(${extras.projectManagerId})`;
  if (extras.executiveSponsorId) payload['proj_ExecutiveSponsor@odata.bind'] = `/systemusers(${extras.executiveSponsorId})`;
  // Optional program parent. When the requester picked a program on the
  // intake's Project Setup step (or an admin added the field to an earlier
  // stage), bind the new project to it so it shows up on the program's
  // roll-up from day one. Schema name = msdyn_Program (lookup on
  // msdyn_project pointing at msdyn_projectprogram).
  if (extras.targetProgramId) payload['msdyn_Program@odata.bind'] = `/msdyn_projectprograms(${extras.targetProgramId})`;

  // Carry over the Payer Initiatives HPI lookup if the requester picked one
  // on the wizard's Project Setup stage. Source is the holding-pen
  // extras.hpiIssueId — the HPI lookup column doesn't exist on
  // pmo_projectrequest in PROD, only on msdyn_project, so we never wrote
  // the value to a column on the intake row. Schema name =
  // pmo_PayerInitiatives_HpiIssue (renamed from pmo_HpiIssue to follow the
  // pmo_<team>_<feature> convention).
  if (extras.hpiIssueId) {
    payload['pmo_PayerInitiatives_HpiIssue@odata.bind'] = `/rcm_payerdeckissues(${extras.hpiIssueId})`;
  }

  // Strategic Account Executive (Payer Initiatives team feature). Stored as a
  // direct AAD identity snapshot across three pmo_payerinitiatives_sae*
  // columns rather than a systemuser lookup -- see
  // docs/planning/sae-systemuser-to-aad-transition-plan.md.
  if (hasSae(extras.strategicAccountExecutive)) {
    Object.assign(payload, saeWritePayload(extras.strategicAccountExecutive));
  }

  return payload;
}

/**
 * Build the createProgram payload from an approved request. Programs use a
 * different schema (msdyn_name, proj_programstart/due, fewer classification
 * columns) so this is intentionally separate from buildProjectPayload.
 */
export function buildProgramPayload(request: ProjectRequest): Record<string, unknown> {
  const extras = readExtras(request);
  const payload: Record<string, unknown> = {
    msdyn_name: request.pmo_name,
  };

  const desc = request.pmo_submissiontext ?? request.pmo_description;
  if (desc) payload.msdyn_description = desc;

  if (request.pmo_requestedstartdate) payload.proj_programstart = request.pmo_requestedstartdate;
  if (request.pmo_targetcompletiondate) payload.proj_programdue = toDataverseDateOnly(request.pmo_targetcompletiondate);
  if (typeof request.pmo_estimatedbudget === 'number') payload.msdyn_budget = request.pmo_estimatedbudget;

  // Programs reuse Project Manager as the program manager (proj_Manager).
  if (extras.projectManagerId) payload['proj_Manager@odata.bind'] = `/systemusers(${extras.projectManagerId})`;

  return payload;
}
