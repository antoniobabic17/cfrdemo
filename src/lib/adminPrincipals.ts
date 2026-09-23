/**
 * Configurable admin identity (initiative #4).
 *
 * Historically admin (`pmo_admin`) was granted ONLY by matching Dataverse
 * security-role names ('CFR PMO Administrator' etc.) in resolveAdminRole().
 * That is not portable — a new tenant has different roles/teams. This adds a
 * config-driven ADDITIVE grant: `pmo.admin_principals_json` lists principals
 * who should also be treated as admins.
 *
 * Shape (all fields optional; absent => empty):
 *   {
 *     "teamIds":        ["<dataverse team guid>", ...],  // any member is admin
 *     "userObjectIds":  ["<aad object id>", ...],        // this user is admin
 *     "groupObjectIds": ["<aad group object id>", ...]   // members are admin
 *   }
 *
 * ADDITIVE + SAFE: the role-name checks still run first and still grant admin.
 * A malformed or absent list simply grants nobody extra — it can NEVER remove
 * an existing admin. Seeded at first-time setup with the current admin team GUID.
 */
import { SETTING_ADMIN_PRINCIPALS } from './constants';

export { SETTING_ADMIN_PRINCIPALS };

export interface AdminPrincipals {
  teamIds: string[];
  userObjectIds: string[];
  groupObjectIds: string[];
}

export const EMPTY_ADMIN_PRINCIPALS: AdminPrincipals = {
  teamIds: [],
  userObjectIds: [],
  groupObjectIds: [],
};

const lc = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map(lc).filter((x): x is string => x !== null)));
}

/** Parse the stored value. Malformed/absent => EMPTY (grants nobody extra). */
export function parseAdminPrincipals(value: string | null | undefined): AdminPrincipals {
  if (value == null || value.trim() === '') return { ...EMPTY_ADMIN_PRINCIPALS };
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return {
      teamIds: strArray(raw.teamIds),
      userObjectIds: strArray(raw.userObjectIds),
      groupObjectIds: strArray(raw.groupObjectIds),
    };
  } catch {
    return { ...EMPTY_ADMIN_PRINCIPALS };
  }
}

export function serializeAdminPrincipals(p: AdminPrincipals): string {
  return JSON.stringify({
    teamIds: strArray(p.teamIds),
    userObjectIds: strArray(p.userObjectIds),
    groupObjectIds: strArray(p.groupObjectIds),
  });
}

/** True iff the principals list names at least one principal. */
export function hasAnyAdminPrincipal(p: AdminPrincipals): boolean {
  return p.teamIds.length > 0 || p.userObjectIds.length > 0 || p.groupObjectIds.length > 0;
}

/**
 * Does the caller match the admin principals list?
 * @param p              parsed principals
 * @param userObjectId   caller's AAD object id (may be null in dev)
 * @param teamIds        caller's Dataverse team GUIDs
 * @param groupObjectIds caller's AAD group object ids (best-effort; may be empty)
 */
export function matchesAdminPrincipal(
  p: AdminPrincipals,
  userObjectId: string | null | undefined,
  teamIds: Iterable<string> | null | undefined,
  groupObjectIds?: Iterable<string> | null | undefined,
): boolean {
  const uid = lc(userObjectId);
  if (uid && p.userObjectIds.includes(uid)) return true;
  if (teamIds) {
    const teamSet = new Set(p.teamIds);
    for (const t of teamIds) { const l = lc(t); if (l && teamSet.has(l)) return true; }
  }
  if (groupObjectIds && p.groupObjectIds.length > 0) {
    const groupSet = new Set(p.groupObjectIds);
    for (const g of groupObjectIds) { const l = lc(g); if (l && groupSet.has(l)) return true; }
  }
  return false;
}
