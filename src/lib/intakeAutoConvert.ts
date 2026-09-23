/**
 * intakeAutoConvert — shared helper that takes an approved (or auto-approved)
 * project request and:
 *
 *   1. Appends an "approved" entry to the approval chain.
 *   2. Audits the intake approval (so /admin/change-history shows it even if
 *      the project is later deleted).
 *   3. Creates the project (or program) via the appropriate mutation.
 *   4. For project conversions: creates the primary-team membership row,
 *      applies the resolved template, and carries over stage artifacts.
 *      All three are best-effort and log a warning rather than aborting.
 *   5. PATCHes the request to bind ConvertedProject/Program, flips status
 *      to Converted, writes the converted-date, and persists the chain.
 *      Throws a HALF_CONVERTED error if this final step fails so the caller
 *      can surface a loud "created (id) but request not updated" toast.
 *
 * Extracted from StageApprovalPanel.handleApprove so the GovernedIntakeWizard
 * can reuse the same sequence when the intake.bypassApproval admin toggle is
 * on. Keep this function pure of UI concerns — callers own toasts, dialogs,
 * and navigation.
 */

import { updateProjectRequest } from '../api/projectRequests.api';
import { createProjectTeam } from '../api/projectTeams.api';
import { createProjectBucket } from '../api/projectBuckets.api';
import { createCustomBucket } from '../api/customBuckets.api';
import type { DataSource } from './taskSource';
import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import { readExtras } from './intakeExtras';
import { emitRoleAssigned } from './notify';
import { attachPayerIssuesToProject } from '../features/teams/payer-initiatives/api/payerIssues.api';
import { carryIntakeDocsToRecord } from './sharePointFiles';
import {
  buildProjectPayload, buildProgramPayload, carryOverArtifacts,
} from './intakeConversion';
import {
  REQUEST_STATUS, CONVERSION_TARGET, TEAM_ROLE,
} from './constants';
import type { ProjectRequest } from '../models/projectRequest.model';
import type { ApprovalAction } from './intakeValidation';
import type { AppSetting } from '../api/appSettings.api';
import type { ProjectTemplate } from '../models/projectTemplate.model';
import type { useCreateProject } from '../hooks/useProjects';
import type { useCreateProgram } from '../hooks/usePrograms';
import type { useChangeAudit } from '../hooks/useChangeAudit';
import { toDataverseDateOnly, todayLocalYmd } from '../lib/dateOnly';
import { usesCustomTables } from './taskSource';

export class HalfConvertedError extends Error {
  createdId: string;
  kind: 'project' | 'program';
  constructor(createdId: string, kind: 'project' | 'program', cause?: unknown) {
    super(
      `${kind === 'program' ? 'Program' : 'Project'} created (${createdId}) but request not updated. ` +
      `Refresh and re-run conversion or contact admin.`,
    );
    this.name = 'HalfConvertedError';
    this.createdId = createdId;
    this.kind = kind;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface AutoApproveAndConvertArgs {
  request: ProjectRequest;
  /** Persisted approval chain to append the new "approved" entry to. */
  approvalChain: ApprovalAction[];
  /** Stage order to record on the new chain entry (use current stage index). */
  stageOrder: number;
  /** Current systemuserid. Falls back to empty string if unresolved. */
  currentUserId: string;
  /** Rationale text persisted on the chain entry. Distinguishes manual
   *  approval from the auto-bypass path in change history. */
  approvalRationale: string;
  /** App settings array (for template resolution). */
  settings: AppSetting[] | undefined;
  /** Project templates (for template resolution). */
  templates: ProjectTemplate[] | undefined;
  /** Mutation hook returned from useCreateProject(). */
  createProject: ReturnType<typeof useCreateProject>;
  /** Mutation hook returned from useCreateProgram(). */
  createProgram: ReturnType<typeof useCreateProgram>;
  /** Audit hook returned from useChangeAudit(). */
  auditChange: ReturnType<typeof useChangeAudit>;
  /** Active data source. On 'custom' the post-create bucket + template writes go
   *  direct to pmo_* (instant) instead of the slow/racy PSS paths -- otherwise a
   *  custom-source project submit still pays the PSS bucket + template latency
   *  (the ~10s 'Submit Project' delay). Defaults to 'pss' when omitted. */
  dataSource?: DataSource;
}

export interface AutoApproveAndConvertResult {
  createdId: string;
  kind: 'project' | 'program';
}

export async function autoApproveAndConvert(
  args: AutoApproveAndConvertArgs,
): Promise<AutoApproveAndConvertResult> {
  const {
    request, approvalChain, stageOrder, currentUserId, approvalRationale,
    createProject, createProgram, auditChange,
    dataSource = 'pss',
  } = args;

  const isProgram = request.pmo_conversiontarget === CONVERSION_TARGET.Program;
  const entityName = request.pmo_name ?? 'Untitled Request';

  // 1) Build and append the approval-chain entry.
  const newEntry: ApprovalAction = {
    stageOrder,
    action: 'approved',
    actorId: currentUserId,
    actorName: 'Current User',
    timestamp: new Date().toISOString(),
    rationale: approvalRationale,
  };
  const chain = [...approvalChain, newEntry];

  // 2) Audit the intake approval itself.
  auditChange({
    entityType: 'intake',
    entityId: request.pmo_projectrequestid,
    entityName,
    action: 'approve',
    changes: [
      { kind: 'field', field: 'pmo_status', label: 'Status',    old: 'Submitted', new: 'Approved' },
      { kind: 'field', field: 'rationale',  label: 'Rationale', old: null,        new: approvalRationale },
    ],
  });

  // 3) Create the project or program.
  let createdId: string;
  const kind: 'project' | 'program' = isProgram ? 'program' : 'project';

  if (isProgram) {
    const program = await createProgram.mutateAsync(buildProgramPayload(request));
    createdId = program.msdyn_projectprogramid;
    // Carry the intake request's documents (charter, etc.) onto the new program
    // (re-tag in place, show on both). Best-effort; never blocks conversion.
    void carryIntakeDocsToRecord(request.pmo_projectrequestid, 'Program', createdId)
      .catch((e) => console.warn('Intake doc carry-over (program) failed (non-fatal):', e));
    {
      const ex = readExtras(request);
      const actor = dv.getCurrentUserId();
      if (ex.projectManagerId) void emitRoleAssigned({ assigneeUserId: ex.projectManagerId, actorUserId: actor, role: 'Program Manager', entityKind: 'program', entityId: createdId, entityName: entityName });
    }
    auditChange({
      entityType: 'program',
      entityId: createdId,
      entityName,
      action: 'create',
    });
  } else {
    // pmo_usenewresourcemodel now defaults to TRUE for every new project inside
    // createCustomProject (customProjects.api.ts, 2026-09-17). The previous
    // per-team opt-in override was removed here because the New Labor Hours Model
    // is the default regardless of team. Admin → Resourcing still bulk-applies to
    // EXISTING projects when the operator asks for that separately.
    const projectPayload = buildProjectPayload(request);
    const project = await createProject.mutateAsync(projectPayload);
    createdId = project.msdyn_projectid;
    // Carry the intake request's documents (charter, SOW, etc.) onto the new
    // project (re-tag in place, show on both). Best-effort; never blocks convert.
    void carryIntakeDocsToRecord(request.pmo_projectrequestid, 'Project', createdId)
      .catch((e) => console.warn('Intake doc carry-over (project) failed (non-fatal):', e));
    {
      const ex = readExtras(request);
      const actor = dv.getCurrentUserId();
      if (ex.projectManagerId) void emitRoleAssigned({ assigneeUserId: ex.projectManagerId, actorUserId: actor, role: 'Project Manager', entityKind: 'project', entityId: createdId, entityName: entityName });
      if (ex.executiveSponsorId) void emitRoleAssigned({ assigneeUserId: ex.executiveSponsorId, actorUserId: actor, role: 'Executive Sponsor', entityKind: 'project', entityId: createdId, entityName: entityName });
    }
    auditChange({
      entityType: 'project',
      entityId: createdId,
      entityName,
      action: 'create',
      parentProjectId: createdId,
      parentProjectName: entityName,
    });

    // 4) Post-create side-effects. These four steps are mutually independent —
    // each only needs the resolved createdId and writes to a DISTINCT entity
    // (bucket / project-team row / carried documents / payer-issue links); none
    // reads another's output, so they run concurrently to cut the convert wall
    // time. Every step keeps its own try/catch so one failure can't reject the
    // batch (they are all best-effort and must never block the convert). The
    // final "mark Converted" PATCH (step 5) still runs AFTER this batch settles.
    await Promise.all([
      // 4a) Default "General" bucket so the Plan tab opens with somewhere to put
      // tasks. PSS path is racy against a fresh project (PROD 2026-07-14), so PSS
      // first then a direct msdyn_projectbuckets write fallback.
      (async () => {
        if (usesCustomTables(dataSource)) {
          // Custom source: direct OData create on pmo_bucket -- instant, no PSS lag.
          try {
            await createCustomBucket(createdId, 'General', 1);
          } catch (err) {
            console.warn('Default General bucket (custom) failed (non-fatal):', err);
          }
        } else {
          try {
            await createProjectBucket(createdId, 'General', 1);
          } catch (err) {
            console.warn('Default General bucket via PSS failed; falling back to direct Dataverse write:', err);
            try {
              await dv.create(ENTITY_SETS.projectBucket, {
                msdyn_name: 'General',
                msdyn_displayorder: 1,
                'msdyn_project@odata.bind': `/msdyn_projects(${createdId})`,
              });
            } catch (fallbackErr) {
              console.warn('Default General bucket direct-write also failed (non-fatal):', fallbackErr);
            }
          }
        }
      })(),

      // 4b) Primary-team membership row (best effort).
      (async () => {
        const teamId = request['_pmo_targetteam_value'];
        if (!teamId) return;
        try {
          await createProjectTeam({
            // createProjectTeam rebinds the project by dataSource; pass the created
            // project id via the msdyn bind key (extractIdFromBind reads either).
            'pmo_Project@odata.bind': `/msdyn_projects(${createdId})`,
            'pmo_Team@odata.bind': `/teams(${teamId})`,
            pmo_role: TEAM_ROLE.Primary,
            pmo_joineddate: toDataverseDateOnly(todayLocalYmd()),
          }, dataSource);
        } catch (err) {
          console.warn('Primary-team row creation failed (non-fatal):', err);
        }
      })(),

      // 4c) Template task seeding REMOVED 2026-07-31 (operator directive): a
      // newly-converted project must start with NO tasks.

      // 4d) Artifact carry-over (best effort).
      (async () => {
        if (!request.pmo_stageartifactsjson) return;
        try {
          await carryOverArtifacts(
            request.pmo_stageartifactsjson,
            createdId,
            readExtras(request).cfrCategory,
          );
        } catch (err) {
          console.warn('Artifact carry-over failed (non-fatal):', err);
        }
      })(),

      // 4e) Payer Initiatives — attach selected payer issues to the new project.
      // The HPI single-valued lookup was already written by buildProjectPayload
      // via @odata.bind; the multi-valued payer issues need post-create PATCHes.
      (async () => {
        try {
          const extras = readExtras(request);
          if (extras.payerIssueIds && extras.payerIssueIds.length > 0) {
            await attachPayerIssuesToProject(extras.payerIssueIds, createdId);
          }
        } catch (err) {
          console.warn('Payer issue attach failed (non-fatal):', err);
        }
      })(),
    ]);
  }

  // 5) PATCH the request — bind converted project/program, status=Converted.
  try {
    // Program always binds the msdyn program (program decoupling out of scope).
    // Custom project binds the pmo_project ref lookup (no shell exists in custom);
    // pss project keeps the msdyn shell bind.
    const customProject = !isProgram && usesCustomTables(dataSource);
    const bindKey = isProgram
      ? 'pmo_ConvertedProgram@odata.bind'
      : customProject ? 'pmo_ConvertedProjectRef@odata.bind' : 'pmo_ConvertedProject@odata.bind';
    const bindEntity = isProgram ? 'msdyn_projectprograms'
      : customProject ? 'pmo_projects' : 'msdyn_projects';
    const patchPayload: Record<string, unknown> = {
      pmo_approvalchain: JSON.stringify(chain),
      pmo_currentstagenumber: stageOrder,
      pmo_status: REQUEST_STATUS.Converted,
      pmo_converteddate: toDataverseDateOnly(todayLocalYmd()),
      [bindKey]: `/${bindEntity}(${createdId})`,
    };
    await updateProjectRequest(request.pmo_projectrequestid, patchPayload);
  } catch (patchErr) {
    console.error('Half-converted request:', request.pmo_projectrequestid, patchErr);
    throw new HalfConvertedError(createdId, kind, patchErr);
  }

  return { createdId, kind };
}
