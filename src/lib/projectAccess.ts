/**
 * Project-level record sharing.
 *
 * The CFR PMO Team role grants Read at Global but defers Writes to ownership +
 * record sharing (see solution/src/Roles/CFR PMO Team.xml). That means a user
 * who's "on the project's team" in the app sense isn't automatically allowed
 * to PATCH the project at the Dataverse layer — Dataverse needs an explicit
 * share with that team.
 *
 * These helpers reconcile a project's shares to match its current Primary Team
 * + Contributing teams. Call after any mutation that changes which teams the
 * project belongs to (create, Primary Team change, Collaborate-tab add/remove).
 *
 * Idempotent: reads current shares first, only grants/revokes deltas.
 *
 * Best-effort: callers should wrap these in try/catch and log rather than
 * abort the parent flow on a share failure — the project mutation has
 * already succeeded by the time we get here.
 */
import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import { listProjectTeams } from '../api/projectTeams.api';
import { listProjectCollaborators } from '../api/projectCollaborators.api';
import { getProject } from '../api/projects.api';

/** Access mask granted to project teams. Read so they can see; Write so they
 *  can PATCH; Append so they can attach child records (notes, decisions); and
 *  AppendTo so other records can reference this project. */
const TEAM_PROJECT_ACCESS = 'ReadAccess, WriteAccess, AppendAccess, AppendToAccess';

function projectTarget(projectId: string): dv.AccessTarget {
  return {
    entitySet: ENTITY_SETS.project,
    recordId: projectId,
    logicalName: 'msdyn_project',
  };
}

function teamPrincipal(teamId: string): dv.AccessPrincipal {
  return { entitySet: 'teams', recordId: teamId, logicalName: 'team' };
}

function userPrincipal(systemUserId: string): dv.AccessPrincipal {
  return { entitySet: 'systemusers', recordId: systemUserId, logicalName: 'systemuser' };
}

/** Share a project with one team at the standard access mask. Safe to call
 *  even if the team already has access — falls back to modify when grant
 *  fails with a "principal already has access" error. */
export async function shareProjectWithTeam(projectId: string, teamId: string): Promise<void> {
  const target = projectTarget(projectId);
  const principal = teamPrincipal(teamId);
  try {
    await dv.grantAccess(target, principal, TEAM_PROJECT_ACCESS);
  } catch (err) {
    // The team may already have a different mask. Try modify instead. If that
    // also fails, surface the original error.
    try {
      await dv.modifyAccess(target, principal, TEAM_PROJECT_ACCESS);
    } catch {
      throw err;
    }
  }
}

/** Remove the project from a team's shared records (if shared). */
export async function revokeProjectFromTeam(projectId: string, teamId: string): Promise<void> {
  await dv.revokeAccess(projectTarget(projectId), teamPrincipal(teamId));
}

/** Share with a single user (used for the named accountability roles —
 *  Project Manager / Executive Sponsor / Manager — so they retain edit even
 *  if they aren't on the Primary Team). */
export async function shareProjectWithUser(projectId: string, systemUserId: string): Promise<void> {
  const target = projectTarget(projectId);
  const principal = userPrincipal(systemUserId);
  try {
    await dv.grantAccess(target, principal, TEAM_PROJECT_ACCESS);
  } catch (err) {
    try {
      await dv.modifyAccess(target, principal, TEAM_PROJECT_ACCESS);
    } catch {
      throw err;
    }
  }
}

/**
 * Compute desired team shares for a project: Primary Team + every active
 * Contributing team in the pmo_projectteam roster. Returns the set of team
 * GUIDs that should currently have access.
 */
export async function computeDesiredProjectTeamShares(projectId: string): Promise<Set<string>> {
  const [primary, roster] = await Promise.all([
    readPrimaryTeam(projectId),
    listProjectTeams(projectId).catch(() => [] as Awaited<ReturnType<typeof listProjectTeams>>),
  ]);
  const desired = new Set<string>();
  if (primary) desired.add(primary);
  for (const row of roster) {
    if (row.statecode !== 0) continue;
    const teamId = row['_pmo_team_value'];
    if (teamId) desired.add(teamId);
  }
  return desired;
}

/**
 * Read a project's primary-team id, source-agnostic. On the PSS source the
 * _pmo_primaryteam_value lives on msdyn_project; on the custom source it lives
 * on pmo_project (the msdyn_project shell has it empty). GUIDs are shared, so we
 * read pmo_projects first (only exists/populated on custom) and fall back to
 * msdyn_project. Best-effort — returns undefined if neither resolves.
 */
async function readPrimaryTeam(projectId: string): Promise<string | undefined> {
  try {
    const rows = await dv.list<{ _pmo_primaryteam_value?: string }>('pmo_projects', {
      $select: ['_pmo_primaryteam_value'],
      $filter: `pmo_projectid eq ${projectId}`,
      $top: 1,
    });
    const v = rows[0]?.['_pmo_primaryteam_value'];
    if (v) return v;
  } catch { /* pmo_projects may not exist / no row — fall through to PSS */ }
  try {
    const project = await getProject(projectId);
    return project?.['_pmo_primaryteam_value'] ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconcile a project's team shares to match its current Primary Team +
 * Contributing team roster. Grants missing, revokes stale. Does NOT touch
 * user-level shares (those are managed separately for named roles).
 *
 * Best-effort: logs and resolves to {granted, revoked, errors} on partial
 * failure rather than throwing. Caller can decide whether to surface a toast.
 */
export async function syncProjectTeamShares(projectId: string): Promise<{
  granted: string[];
  revoked: string[];
  errors: Array<{ teamId: string; op: 'grant' | 'revoke'; message: string }>;
}> {
  const target = projectTarget(projectId);
  const errors: Array<{ teamId: string; op: 'grant' | 'revoke'; message: string }> = [];
  const granted: string[] = [];
  const revoked: string[] = [];

  let desired: Set<string>;
  try {
    desired = await computeDesiredProjectTeamShares(projectId);
  } catch (err) {
    return { granted, revoked, errors: [{ teamId: '*', op: 'grant', message: err instanceof Error ? err.message : String(err) }] };
  }

  let current: Awaited<ReturnType<typeof dv.retrieveSharedPrincipals>>;
  try {
    current = await dv.retrieveSharedPrincipals(target);
  } catch (err) {
    // Fall back: just try to grant the desired set without revoking anything.
    // Better to be over-permissive than to leave the project unwriteable.
    for (const teamId of desired) {
      try {
        await shareProjectWithTeam(projectId, teamId);
        granted.push(teamId);
      } catch (e) {
        errors.push({ teamId, op: 'grant', message: e instanceof Error ? e.message : String(e) });
      }
    }
    errors.push({ teamId: '*', op: 'revoke', message: `retrieveSharedPrincipals failed: ${err instanceof Error ? err.message : String(err)}` });
    return { granted, revoked, errors };
  }

  const currentTeamIds = new Set<string>(
    current.filter((p) => p.principal.entityName === 'team').map((p) => p.principal.recordId),
  );

  // Grant any desired teams that don't already have access.
  for (const teamId of desired) {
    if (currentTeamIds.has(teamId)) continue;
    try {
      await shareProjectWithTeam(projectId, teamId);
      granted.push(teamId);
    } catch (err) {
      errors.push({ teamId, op: 'grant', message: err instanceof Error ? err.message : String(err) });
    }
  }
  // Revoke any team shares that no longer correspond to a project team.
  for (const teamId of currentTeamIds) {
    if (desired.has(teamId)) continue;
    try {
      await revokeProjectFromTeam(projectId, teamId);
      revoked.push(teamId);
    } catch (err) {
      errors.push({ teamId, op: 'revoke', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { granted, revoked, errors };
}

/**
 * Revoke a project's individual Dataverse share from one user.
 * Mirrors revokeProjectFromTeam but for a systemuser principal.
 */
export async function revokeProjectFromUser(projectId: string, systemUserId: string): Promise<void> {
  await dv.revokeAccess(projectTarget(projectId), userPrincipal(systemUserId));
}

/**
 * Sync per-user shares for Individual-mode collaborators.
 * Reads all active pmo_projectcollaborator rows and grants/revokes user shares
 * as needed to match. Does NOT touch team shares (those are managed by
 * syncProjectTeamShares). Best-effort — logs and resolves on partial failure.
 */
export async function syncProjectCollaboratorShares(projectId: string): Promise<{
  granted: string[];
  revoked: string[];
  errors: Array<{ userId: string; op: 'grant' | 'revoke'; message: string }>;
}> {
  const target = projectTarget(projectId);
  const errors: Array<{ userId: string; op: 'grant' | 'revoke'; message: string }> = [];
  const granted: string[] = [];
  const revoked: string[] = [];

  let desired: Set<string>;
  try {
    const rows = await listProjectCollaborators(projectId).catch(() => []);
    desired = new Set(
      rows
        .filter((r) => r.statecode === 0 && r['_pmo_user_value'])
        .map((r) => r['_pmo_user_value'] as string),
    );
  } catch (err) {
    return { granted, revoked, errors: [{ userId: '*', op: 'grant', message: err instanceof Error ? err.message : String(err) }] };
  }

  let current: Awaited<ReturnType<typeof dv.retrieveSharedPrincipals>>;
  try {
    current = await dv.retrieveSharedPrincipals(target);
  } catch {
    // Fall back: just grant the desired set without revoking.
    for (const userId of desired) {
      try {
        await shareProjectWithUser(projectId, userId);
        granted.push(userId);
      } catch (e) {
        errors.push({ userId, op: 'grant', message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { granted, revoked, errors };
  }

  const currentUserIds = new Set<string>(
    current.filter((p) => p.principal.entityName === 'systemuser').map((p) => p.principal.recordId),
  );

  for (const userId of desired) {
    if (currentUserIds.has(userId)) continue;
    try {
      await shareProjectWithUser(projectId, userId);
      granted.push(userId);
    } catch (err) {
      errors.push({ userId, op: 'grant', message: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const userId of currentUserIds) {
    if (desired.has(userId)) continue;
    try {
      await revokeProjectFromUser(projectId, userId);
      revoked.push(userId);
    } catch (err) {
      errors.push({ userId, op: 'revoke', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { granted, revoked, errors };
}

