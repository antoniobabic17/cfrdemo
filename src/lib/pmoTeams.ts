import * as dv from './dataverseClient';
import { ENTITY_SETS } from './constants';
import { PAYER_INITIATIVES_TEAM_ID, PAYER_INITIATIVES_TEAM_NAMES } from '../features/teams/payer-initiatives/constants';

/**
 * Team types in Dataverse. The sidebar picker restricts to (2, 3) so admins
 * can only add teams whose membership auto-syncs from Azure AD / M365,
 * matching the cybersecurity requirement that "each team has to be linked
 * to either o365 or azure ad, no custom teams."
 *   0 - Owner Team           (manually managed, does NOT auto-sync)
 *   1 - Access Team          (per-record share, not a people container)
 *   2 - AAD Security Group   (auto-syncs from Azure AD security group)
 *   3 - AAD Office Group     (auto-syncs from Microsoft 365 group)
 */
export const TEAM_TYPE = { Owner: 0, Access: 1, SecurityGroup: 2, OfficeGroup: 3 } as const;
export const SIDEBAR_ELIGIBLE_TEAM_TYPES = [TEAM_TYPE.SecurityGroup, TEAM_TYPE.OfficeGroup] as const;

export function teamTypeLabel(t: number): string {
  switch (t) {
    case TEAM_TYPE.Owner: return 'Owner (custom)';
    case TEAM_TYPE.Access: return 'Access (record share)';
    case TEAM_TYPE.SecurityGroup: return 'AAD Security Group';
    case TEAM_TYPE.OfficeGroup: return 'AAD Office Group (M365)';
    default: return `Type ${t}`;
  }
}

/**
 * Shorter type label for the team detail page header ("Team Name - Office
 * Group" / "Team Name - Security Group"). Only the two AAD-linked types
 * are named here; other types return an empty string so the caller can
 * decide whether to omit the suffix.
 */
export function teamTypeHeaderLabel(t: number): string {
  switch (t) {
    case TEAM_TYPE.OfficeGroup: return 'Office Group';
    case TEAM_TYPE.SecurityGroup: return 'Security Group';
    default: return '';
  }
}

/**
 * Tenant-scoped display prefix that the org has been using on every AAD-
 * linked team name (e.g. "Coram Finance RevCycle - Business Intelligence").
 * The prefix duplicates context that's obvious inside the app -- everyone
 * viewing the sidebar knows they're in the CFR PMO app -- so we strip it
 * at render time to keep pill labels short and readable. The raw team
 * `name` in Dataverse is unchanged; only the UI presentation drops the
 * prefix.
 */
export const TENANT_TEAM_NAME_PREFIX = 'Coram Finance RevCycle - ';

/**
 * Strip the tenant prefix if present, otherwise return the name unchanged.
 * Case-insensitive on the prefix so a lowercase-typed variant still matches.
 *
 * This is now used only as the DEFAULT suggestion when an admin adds a team
 * to the sidebar via Admin > Sidebar Teams. At runtime the actual display
 * name comes from `pmo_appsetting[sidebar.teamName.<teamid>]` (see
 * SIDEBAR_TEAM_NAME_SETTING_KEY / resolveSidebarTeamName below) so operators
 * have final say over how each team's pill reads.
 */
export function displayTeamName(name: string | undefined | null): string {
  if (!name) return '';
  const lower = name.toLowerCase();
  const prefixLower = TENANT_TEAM_NAME_PREFIX.toLowerCase();
  if (lower.startsWith(prefixLower)) {
    return name.slice(TENANT_TEAM_NAME_PREFIX.length);
  }
  return name;
}

/**
 * pmo_appsetting key format for the per-team sidebar override.
 *
 * When an admin adds a team via Admin > Sidebar Teams they're prompted for
 * a display name; that value is stored at `sidebar.teamName.<teamid>` and
 * read here. When absent, callers fall back to the team's raw
 * Dataverse name so nothing breaks on team records that haven't been
 * given an override yet.
 */
export const SIDEBAR_TEAM_NAME_SETTING_PREFIX = 'sidebar.teamName.';
/** pmo.sidebar_team_order: JSON array of team GUIDs in the admin-defined display
 *  order. Drives the left-nav Teams section for every user (admins + members).
 *  Teams absent from the array appear after the ordered ones, alphabetically. */
export const SIDEBAR_TEAM_ORDER_SETTING_KEY = 'pmo.sidebar_team_order';
export function sidebarTeamNameSettingKey(teamId: string): string {
  return `${SIDEBAR_TEAM_NAME_SETTING_PREFIX}${teamId.toLowerCase()}`;
}

/**
 * Given the current pmo_appsetting rows and a team, return the display name
 * to render in the sidebar pills / team lists / team detail header. Prefers
 * the admin-configured override, falls back to the raw Dataverse name.
 * Never auto-strips -- the operator is in control.
 */
export function resolveSidebarTeamName(
  teamId: string,
  rawName: string,
  settings: { pmo_key?: string; pmo_value?: string | null }[] | undefined,
): string {
  if (!settings) return rawName;
  // Case-insensitive lookup so the "teamName" camelCase in the setting key
  // still matches lowercased pmo_key values in the response. Without both
  // sides lowercased the compare was always failing because the LHS was
  // ".teamname." (all-lower after toLowerCase) but the RHS was
  // ".teamName." (capital N from SIDEBAR_TEAM_NAME_SETTING_PREFIX).
  const key = sidebarTeamNameSettingKey(teamId).toLowerCase();
  const row = settings.find((s) => (s.pmo_key ?? '').toLowerCase() === key);
  const override = (row?.pmo_value ?? '').trim();
  return override || rawName;
}

/**
 * Fetches teams flagged with the configured PMO team boolean field. Used by
 * the sidebar and the project/roster pickers. No teamtype filter here so
 * legacy flagged Owner Teams still appear during the transition to AAD-only;
 * admins remove them via the "Sidebar Teams" section in Admin Settings.
 *
 * Falls back to all owner teams (teamtype eq 0) when the field does not exist
 * in the current environment, so queries work across DEV/UAT/prod regardless
 * of which publisher prefix the field carries.
 */
export async function fetchPmoTeams<T>(
  pmoTeamField: string,
  select: string[],
): Promise<T[]> {
  const withField = [...new Set([...select, pmoTeamField])];
  try {
    const all = await dv.list<T>(ENTITY_SETS.team, {
      $select: withField,
      $orderby: 'name asc',
    });
    return all.filter((t) => (t as Record<string, unknown>)[pmoTeamField] === true);
  } catch {
    // Field likely doesn't exist in this environment — return all owner teams
    const baseSelect = select.filter((f) => f !== pmoTeamField);
    const all = await dv.list<T>(ENTITY_SETS.team, {
      $select: baseSelect,
      $filter: 'teamtype eq 0',
      $orderby: 'name asc',
    });
    return all;
  }
}

/**
 * Return every team that's eligible to appear in the sidebar picker — i.e.
 * every AAD-synced team (Security Group + Office Group) regardless of the
 * current pmo_pmoteam flag. The admin UI splits these into "currently in
 * sidebar" (flag=true) vs "available to add" (flag=false) using this
 * single dataset.
 *
 * Deliberately does NOT include Owner Teams (teamtype=0) — the operator's
 * policy is that every team in the sidebar must be backed by an AAD group
 * so membership stays in lockstep with the source of truth in Azure AD /
 * Microsoft 365.
 */
export interface EligibleSidebarTeam {
  teamid: string;
  name: string;
  teamtype: number;
  /** True when this team is currently in the sidebar. */
  flagged: boolean;
  /** True when this team's membership is auto-managed by AAD (always true
   *  for the eligible types, but kept explicit for readability at call sites). */
  aadManaged: true;
}

export async function fetchSidebarEligibleTeams(
  pmoTeamField: string,
): Promise<EligibleSidebarTeam[]> {
  const rows = await dv.list<Record<string, unknown>>(ENTITY_SETS.team, {
    $select: ['teamid', 'name', 'teamtype', pmoTeamField],
    $filter: `teamtype eq ${TEAM_TYPE.SecurityGroup} or teamtype eq ${TEAM_TYPE.OfficeGroup}`,
    $orderby: 'name asc',
    $top: 500,
  });
  return rows.map((r) => ({
    teamid: String(r.teamid),
    name: String(r.name ?? ''),
    teamtype: Number(r.teamtype ?? 0),
    flagged: r[pmoTeamField] === true,
    aadManaged: true as const,
  }));
}

/**
 * Return every currently-flagged team so the admin section can show
 * "In the sidebar right now" and offer Remove buttons — including legacy
 * Owner Teams that were flagged before the AAD-only policy so the admin
 * can retire them cleanly.
 */
export interface FlaggedSidebarTeam {
  teamid: string;
  name: string;
  teamtype: number;
}

export async function fetchFlaggedSidebarTeams(
  pmoTeamField: string,
): Promise<FlaggedSidebarTeam[]> {
  const rows = await dv.list<Record<string, unknown>>(ENTITY_SETS.team, {
    $select: ['teamid', 'name', 'teamtype', pmoTeamField],
    $orderby: 'name asc',
    $top: 500,
  });
  return rows
    .filter((r) => r[pmoTeamField] === true)
    .map((r) => ({
      teamid: String(r.teamid),
      name: String(r.name ?? ''),
      teamtype: Number(r.teamtype ?? 0),
    }));
}

/**
 * Toggle the pmo_pmoteam flag on a specific team. Written straight to the
 * team record via Dataverse PATCH; no solution-layer plumbing needed.
 */
export async function setTeamSidebarFlag(
  teamId: string,
  pmoTeamField: string,
  flagged: boolean,
): Promise<void> {
  return dv.update(ENTITY_SETS.team, teamId, { [pmoTeamField]: flagged });
}

/**
 * Ensure the given team has the `CFR PMO Team` role assigned. Idempotent --
 * if the team already has the role this is a no-op. Called from
 * SidebarTeamsSection whenever an admin adds a team to the sidebar so new
 * members inherit the User-scope CRUD privileges required for bucket / task
 * / operation-set creation on projects their team is assigned to.
 *
 * Deliberately does NOT assign CFR PMO Administrator -- that's a separate
 * global-scope role that stays on a small, tightly-controlled team. Team
 * members only get the record-level access their team's shares grant.
 *
 * Uses associateRecordsAsync (via the SDK) against the
 * teams(id)/teamroles_association N:N. Errors are logged and returned so
 * the caller can surface them; a role-assignment failure should not
 * block flipping the pmo_pmoteam flag itself.
 */
export interface EnsureTeamRoleResult {
  attempted: boolean;
  alreadyAssigned: boolean;
  success: boolean;
  error?: string;
}

export async function ensureTeamHasCfrPmoRole(
  teamId: string,
): Promise<EnsureTeamRoleResult> {
  const CFR_PMO_TEAM_ROLE_NAME = 'CFR PMO Team';
  try {
    // 1. Look up the role by name -- same lookup the assign-role script uses
    //    so DEV / UAT / PROD each pick up their own roleid.
    const roles = await dv.list<{ roleid: string; name: string }>('roles', {
      $select: ['roleid', 'name'],
      $filter: `name eq '${CFR_PMO_TEAM_ROLE_NAME}'`,
      $top: 1,
    });
    const role = roles[0];
    if (!role) {
      return { attempted: true, alreadyAssigned: false, success: false, error: `Role '${CFR_PMO_TEAM_ROLE_NAME}' not found in this environment.` };
    }
    // 2. Try to associate directly. The Power Apps SDK doesn't allow
    //    reading nav-property paths like `teams(id)/teamroles_association`
    //    as a data source, so we can't cheaply pre-check "already
    //    assigned". Instead we attempt the associate and treat the
    //    Dataverse "association already exists" error as a soft success.
    try {
      await dv.associate('teams', teamId, 'teamroles_association', 'roles', role.roleid);
      return { attempted: true, alreadyAssigned: false, success: true };
    } catch (associateErr) {
      const msg = associateErr instanceof Error ? associateErr.message : String(associateErr);
      const ml = msg.toLowerCase();
      // Dataverse phrases this as any of the following depending on layer:
      //   "cannot insert duplicate key"
      //   "an association already exists"
      //   "a duplicate record ... was found"
      //   error code 0x80048d19 (cannot associate two records already associated)
      if (
        ml.includes('already exists') ||
        ml.includes('duplicate') ||
        ml.includes('0x80048d19') ||
        ml.includes('cannot associate') ||
        ml.includes('already associated')
      ) {
        return { attempted: true, alreadyAssigned: true, success: true };
      }
      throw associateErr;
    }
  } catch (err) {
    return {
      attempted: true,
      alreadyAssigned: false,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * True when `teamId` is the Payer Initiatives team. Matches the immutable
 * PAYER_INITIATIVES_TEAM_ID GUID directly, OR resolves the id through the
 * supplied raw team option list and matches its label against the immutable
 * PAYER_INITIATIVES_TEAM_NAMES pack. The AAD migration made the team GUID
 * environment-specific, so name-based matching via the raw (un-resolved,) 
 * Dataverse-named team list is required as a fallback. Pass the RAW team
 * options (labels = Dataverse names), NOT sidebar-admin-resolved labels.
 *
 * Extracted from GovernedIntakeWizard so multiple call sites (intake wizard,
 * projects grid Issue Number gate) share one detection source.
 */
export function isPayerInitiativesTeamId(
  teamId: string | undefined | null,
  rawTeams: { value: string; label?: string }[],
): boolean {
  if (!teamId) return false;
  const lower = teamId.toLowerCase();
  if (lower === PAYER_INITIATIVES_TEAM_ID.toLowerCase()) return true;
  const namesLower = new Set(PAYER_INITIATIVES_TEAM_NAMES.map((n) => n.trim().toLowerCase()));
  const match = rawTeams.find((t) => t.value.toLowerCase() === lower);
  return !!match && namesLower.has((match.label ?? '').trim().toLowerCase());
}
