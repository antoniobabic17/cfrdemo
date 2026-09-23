/**
 * Batch admin-detection helper.
 *
 * resolveAdminRole() in ConfigurationProvider resolves ONLY the current
 * session user. This module provides a batch variant for filtering lists of
 * OTHER users (e.g. team member lists on the Collaborate tab).
 *
 * A user is considered an admin if either:
 *   (a) They are directly or team-assigned the 'System Administrator',
 *       'CFR PMO Administrator', or 'PMO Administrator' Dataverse role.
 *   (b) They appear in pmo.admin_principals_json (userObjectIds or teamIds).
 *
 * Returns a Set<string> of lowercase systemuserids that are admins.
 * Never throws — on error returns an empty set (safe: shows more users,
 * does not silently grant access).
 */
import * as dv from './dataverseClient';
import { ENTITY_SETS, SETTING_ADMIN_PRINCIPALS } from './constants';
import { parseAdminPrincipals, matchesAdminPrincipal } from './adminPrincipals';

const ADMIN_ROLE_NAMES = ['System Administrator', 'CFR PMO Administrator', 'PMO Administrator'];

/** Fetch all Dataverse role copies for the admin role names. Returns their roleids. */
async function fetchAdminRoleIds(): Promise<string[]> {
  const nameFilter = ADMIN_ROLE_NAMES.map((n) => `name eq '${n.replace(/'/g, "''")}'`).join(' or ');
  const roles = await dv.list<{ roleid: string }>('roles', {
    $select: ['roleid'],
    $filter: `(${nameFilter})`,
  });
  return roles.map((r) => r.roleid);
}

/**
 * Given a list of systemuserids, return the subset that are app admins.
 * Uses Promise.all per-user (same pattern as resolveUserTeams in permissions.api.ts).
 * Capped at 100 ids to avoid OData filter length limits.
 */
export async function getAdminUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const idsToCheck = userIds.slice(0, 100).map((id) => id.toLowerCase());

  try {
    // (a) Role-name check: fetch all admin roleids, then check which users hold any.
    const adminRoleIds = await fetchAdminRoleIds();
    const adminSet = new Set<string>();

    if (adminRoleIds.length > 0) {
      // Build an OData filter: user has any admin role directly OR via a team they belong to.
      const roleFilter = adminRoleIds
        .map((rid) => `r/roleid eq ${rid}`)
        .join(' or ');
      const teamRoleFilter = adminRoleIds
        .map((rid) => `tr/roleid eq ${rid}`)
        .join(' or ');

      // Fetch in batches of 20 users to avoid URL length limits.
      const BATCH = 20;
      for (let i = 0; i < idsToCheck.length; i += BATCH) {
        const batch = idsToCheck.slice(i, i + BATCH);
        const userFilter = batch.map((id) => `systemuserid eq '${id}'`).join(' or ');
        const filter =
          `(${userFilter}) and (` +
          `systemuserroles_association/any(r: ${roleFilter}) or ` +
          `teammembership_association/any(t: t/teamroles_association/any(tr: ${teamRoleFilter}))` +
          `)`;
        const admins = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
          $select: ['systemuserid'],
          $filter: filter,
        });
        for (const a of admins) adminSet.add(a.systemuserid.toLowerCase());
      }
    }

    // (b) admin_principals_json check.
    const principalRows = await dv.list<{ pmo_value: string | null }>(ENTITY_SETS.appSetting, {
      $select: ['pmo_value'],
      $filter: `pmo_key eq '${SETTING_ADMIN_PRINCIPALS}' and statecode eq 0`,
      $top: 1,
    });
    const principals = parseAdminPrincipals(principalRows[0]?.pmo_value ?? undefined);

    if (principals.userObjectIds.length > 0 || principals.teamIds.length > 0) {
      // We need the AAD object id + team memberships for each candidate user.
      const remaining = idsToCheck.filter((id) => !adminSet.has(id));
      if (remaining.length > 0) {
        await Promise.all(remaining.map(async (uid) => {
          try {
            const userRows = await dv.list<{ azureactivedirectoryobjectid?: string }>(ENTITY_SETS.systemUser, {
              $select: ['azureactivedirectoryobjectid'],
              $filter: `systemuserid eq '${uid}'`,
              $top: 1,
            });
            const aadId = userRows[0]?.azureactivedirectoryobjectid ?? null;

            let teamIds: string[] = [];
            if (principals.teamIds.length > 0) {
              const teams = await dv.list<{ teamid: string }>(ENTITY_SETS.team, {
                $select: ['teamid'],
                $filter: `teammembership_association/any(u: u/systemuserid eq '${uid}')`,
              });
              teamIds = teams.map((t) => t.teamid);
            }

            if (matchesAdminPrincipal(principals, aadId, teamIds)) {
              adminSet.add(uid);
            }
          } catch {
            // Per-user failure: skip, don't block the whole list.
          }
        }));
      }
    }

    return adminSet;
  } catch {
    // On total failure, return empty set (show all users — err on the side of not hiding).
    return new Set();
  }
}
