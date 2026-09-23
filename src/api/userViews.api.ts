import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { UserView, UserViewCreate } from '../models/userView.model';

const SET = ENTITY_SETS.userView;
const FIELDS: (keyof UserView)[] = [
  'pmo_userviewid', 'pmo_name', 'pmo_tablekey', 'pmo_config',
  'pmo_isdefault', 'pmo_scope', '_pmo_user_value', '_pmo_team_value',
  'statecode', 'createdon',
];

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function bareGuid(v: string): string {
  return v.replace(/[{}]/g, '').trim().toLowerCase();
}

/**
 * List views visible to the current user: everything they own (personal +
 * their own team views), PLUS team-scoped views for any team they belong to.
 * Guards against the pre-resolution `anonymous` user id (same trap as
 * listNotifications) — returns [] rather than building an invalid OData filter.
 */
export async function listUserViews(userId: string, teamIds: string[] = []): Promise<UserView[]> {
  const id = bareGuid(userId ?? '');
  if (!GUID_RE.test(id)) return [];
  const validTeams = teamIds.map(bareGuid).filter((t) => GUID_RE.test(t));
  const clauses = [`_pmo_user_value eq ${id}`];
  if (validTeams.length) {
    const teamOr = validTeams.map((t) => `_pmo_team_value eq ${t}`).join(' or ');
    clauses.push(`(pmo_scope eq 'team' and (${teamOr}))`);
  }
  return dv.list<UserView>(SET, {
    $select: FIELDS,
    $filter: `(${clauses.join(' or ')}) and statecode eq 0`,
    $orderby: 'createdon asc',
    $top: 400,
  });
}

export async function createUserView(payload: UserViewCreate): Promise<UserView> {
  return dv.create<UserView>(SET, payload);
}

export async function updateUserViewConfig(id: string, config: string): Promise<void> {
  return dv.update(SET, id, { pmo_config: config });
}

export async function updateUserViewName(id: string, name: string): Promise<void> {
  return dv.update(SET, id, { pmo_name: name });
}

/** Update a view's name + config JSON (+ optional scope/team) in one PATCH.
 *  Passing team=null clears the team lookup (used when switching to personal). */
export async function updateUserView(
  id: string,
  name: string,
  config: string,
  scope?: string,
  teamId?: string | null,
): Promise<void> {
  const payload: Record<string, unknown> = { pmo_name: name, pmo_config: config };
  if (scope !== undefined) payload.pmo_scope = scope;
  if (teamId !== undefined) {
    payload['pmo_Team@odata.bind'] = teamId ? `/teams(${teamId.replace(/[{}]/g, '')})` : null;
  }
  return dv.update(SET, id, payload);
}

export async function deleteUserView(id: string): Promise<void> {
  return dv.remove(SET, id);
}

/**
 * Admin-only: list ALL custom views for a table regardless of owner.
 * Includes the owner's display name (`_pmo_user_value@OData...FormattedValue`)
 * so the admin can see who created each view, and the team display name for
 * team-scoped views. Deliberately does NOT filter by user — only the admin
 * Table Views editor calls this.
 */
export async function listAllViewsForTable(tableKey: string): Promise<UserView[]> {
  if (!tableKey) return [];
  // Annotation FormattedValue keys are returned automatically by Dataverse
  // when the underlying lookup column is selected; they must NOT appear in
  // the $select list (the SDK rejects them as invalid attribute names).
  return dv.list<UserView>(SET, {
    $select: FIELDS,
    $filter: `pmo_tablekey eq '${tableKey.replace(/'/g, "''")}' and statecode eq 0`,
    $orderby: 'createdon asc',
    $top: 2000,
  });
}
