/**
 * Primary-team change cascade (2026-07-22).
 *
 * When a user changes msdyn_project._pmo_primaryteam_value via the Governance
 * tab, the app also needs to keep the pmo_projectteam roster in sync so
 * project-side pickers (task assignees, decision owners, etc.) actually
 * surface the new team's members. Historically these two representations
 * drifted:
 *
 *   * Lookup: msdyn_project._pmo_primaryteam_value  ← governance dropdown
 *   * Roster: pmo_projectteam[pmo_role=Primary]     ← intake / onboarding only
 *
 * useProjectScopedUsers reads the ROSTER, not the lookup. So a governance
 * change alone leaves every project-scoped picker showing the OLD team's
 * members (Tracey Gallicchio hit this on 2026-07-22).
 *
 * This helper is the missing cascade:
 *   1. Demote the old TEAM_ROLE.Primary roster row to Contributing
 *      (kept, not deleted -- preserves existing assignees).
 *   2. Ensure a TEAM_ROLE.Primary roster row exists for the new team
 *      (create if missing, promote a Contributing row if present).
 *   3. Reconcile record-level shares via the existing syncProjectTeamShares
 *      helper so the new team gets Read/Write/Append/AppendTo on the
 *      project.
 *   4. Invalidate the React-Query caches feeding the pickers so the UI
 *      refreshes immediately.
 *
 * The lookup itself (_pmo_primaryteam_value) is written by the caller BEFORE
 * this helper runs, via the existing onSave path in EditProjectDialog. This
 * helper is the roster + share side effect that used to be missing.
 */
import type { QueryClient } from '@tanstack/react-query';
import { TEAM_ROLE, ENTITY_SETS } from './constants';
import * as dv from './dataverseClient';
import { listProjectTeams, createProjectTeam } from '../api/projectTeams.api';
import { getCachedDataSource } from './taskSource';
import { syncProjectTeamShares } from './projectAccess';
import { logAppError } from './errorLog';

export interface PrimaryTeamChangeArgs {
  projectId: string;
  oldTeamId: string | null | undefined;
  newTeamId: string | null | undefined;
  /** Optional QueryClient for cache invalidation. When provided, the helper
   *  invalidates the roster + scopedUsers + project-row + team-name caches
   *  after the cascade lands so the UI refreshes without a full reload. */
  qc?: QueryClient;
}

export interface PrimaryTeamChangeResult {
  demoted: string | null;  // roster row id that flipped Primary -> Contributing
  createdOrPromoted: string | null;  // roster row id that is now Primary
  shareSync: { granted: number; revoked: number; errors: number };
}

export async function applyPrimaryTeamChange(
  args: PrimaryTeamChangeArgs,
): Promise<PrimaryTeamChangeResult> {
  const { projectId, oldTeamId, newTeamId, qc } = args;

  const result: PrimaryTeamChangeResult = {
    demoted: null,
    createdOrPromoted: null,
    shareSync: { granted: 0, revoked: 0, errors: 0 },
  };

  // 1. Load current roster.
  const roster = await listProjectTeams(projectId);

  // 2. Demote the old primary roster row (if any) to Contributing.
  if (oldTeamId) {
    const oldRow = roster.find(
      (r) => r._pmo_team_value === oldTeamId && r.pmo_role === TEAM_ROLE.Primary,
    );
    if (oldRow) {
      try {
        await dv.update(ENTITY_SETS.projectTeam, oldRow.pmo_projectteamid, {
          pmo_role: TEAM_ROLE.Contributing,
        });
        result.demoted = oldRow.pmo_projectteamid;
      } catch (err) {
        // Non-fatal -- log and continue. The lookup on the project row has
        // already moved; leaving the old roster row as Primary means the app
        // will see TWO Primary rows briefly. useProjectScopedUsers unions
        // members from every roster row regardless of role, so pickers still
        // work; only the Primary pill in the Collaborate tab looks off.
        logAppError({
          message: `Failed to demote old primary team roster row: ${err instanceof Error ? err.message : String(err)}`,
          action: 'primary-team-change: demote old',
          entityType: 'pmo_projectteam',
          entityId: oldRow.pmo_projectteamid,
          parentProjectId: projectId,
        });
      }
    }
  }

  // 3. Ensure the new team has a Primary roster row.
  if (newTeamId) {
    const existing = roster.find((r) => r._pmo_team_value === newTeamId);
    if (existing && existing.pmo_role === TEAM_ROLE.Primary) {
      // Already Primary; nothing to do.
      result.createdOrPromoted = existing.pmo_projectteamid;
    } else if (existing) {
      // Present but Contributing -- promote to Primary.
      try {
        await dv.update(ENTITY_SETS.projectTeam, existing.pmo_projectteamid, {
          pmo_role: TEAM_ROLE.Primary,
        });
        result.createdOrPromoted = existing.pmo_projectteamid;
      } catch (err) {
        logAppError({
          message: `Failed to promote existing roster row to primary: ${err instanceof Error ? err.message : String(err)}`,
          action: 'primary-team-change: promote existing',
          entityType: 'pmo_projectteam',
          entityId: existing.pmo_projectteamid,
          parentProjectId: projectId,
        });
      }
    } else {
      // Missing entirely -- create it. Uses the existing helper which also
      // fires a Contributing-scoped GrantAccess when the new row is created
      // as Contributing; for Primary we DON'T rely on that (it early-returns
      // for Primary rows -- share reconciliation happens via
      // syncProjectTeamShares below).
      try {
        const created = await createProjectTeam({
          'pmo_Project@odata.bind': `/${ENTITY_SETS.project}(${projectId})`,
          'pmo_Team@odata.bind': `/${ENTITY_SETS.team}(${newTeamId})`,
          pmo_role: TEAM_ROLE.Primary,
        }, getCachedDataSource());
        result.createdOrPromoted = created.pmo_projectteamid;
      } catch (err) {
        logAppError({
          message: `Failed to create new primary team roster row: ${err instanceof Error ? err.message : String(err)}`,
          action: 'primary-team-change: create new',
          entityType: 'pmo_projectteam',
          parentProjectId: projectId,
        });
      }
    }
  }

  // 4. Reconcile record-level shares. Best-effort -- reads current shares +
  //    diffs against the new Primary + Contributing set. See
  //    lib/projectAccess.ts for the full contract.
  try {
    const sync = await syncProjectTeamShares(projectId);
    result.shareSync.granted = sync.granted.length;
    result.shareSync.revoked = sync.revoked.length;
    result.shareSync.errors = sync.errors.length;
    if (sync.errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[primaryTeamChange] share-sync had errors', sync.errors);
    }
  } catch (err) {
    result.shareSync.errors = 1;
    logAppError({
      message: `Share-sync after primary-team change failed: ${err instanceof Error ? err.message : String(err)}`,
      action: 'primary-team-change: share sync',
      parentProjectId: projectId,
    });
  }

  // 5. Invalidate the caches feeding project-side pickers so the UI refreshes.
  if (qc) {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['projectTeams', projectId] }),
      qc.invalidateQueries({ queryKey: ['projectScopedUsers', projectId] }),
      qc.invalidateQueries({ queryKey: ['project', projectId] }),
      qc.invalidateQueries({ queryKey: ['team', 'name', newTeamId ?? ''] }),
      qc.invalidateQueries({ queryKey: ['team', 'name', oldTeamId ?? ''] }),
    ]);
  }

  return result;
}
