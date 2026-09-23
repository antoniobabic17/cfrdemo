/**
 * Per-team nav-tab ALLOWLIST (initiative #4).
 *
 * An admin can restrict which left-nav tabs a team may see. Storage is one
 * `pmo_appsetting` row per team: `pmo.team_tabs.<teamId>` = JSON string[] of the
 * nav `toggleKey`s that team is ALLOWED to see (e.g. ["nav.projects","nav.intakeQueue"]).
 *
 * Semantics (intentional):
 *  - Setting ABSENT (or unparseable) => `null` => NO restriction for that team;
 *    the team sees the normal global set (minus any existing team_toggles OFF).
 *    This is what keeps the feature net-neutral until an admin opts a team in.
 *  - Setting PRESENT (an array, possibly empty) => the team is restricted to
 *    exactly those toggleKeys. An empty array means "no nav.* tabs allowed"
 *    (the admin UI treats clearing as delete-the-setting, so an empty array is
 *    only reachable deliberately).
 *  - A user on MULTIPLE teams sees the UNION of their teams' allowlists. A team
 *    with no allowlist does NOT constrain the user (only teams WITH an allowlist
 *    contribute); if none of the user's teams has an allowlist, there is no
 *    restriction at all.
 *
 * Enforcement lives in Sidebar.tsx; admins bypass the allowlist entirely so an
 * admin never loses core tabs. Only `nav.*` items are subject to the allowlist —
 * items with no toggleKey (e.g. Dashboard) and the Admin section are exempt.
 */
import { SETTING_TEAM_TABS_PREFIX } from './constants';

export function teamTabsKey(teamId: string): string {
  return `${SETTING_TEAM_TABS_PREFIX}${teamId}`;
}

export function extractTeamIdFromTabsKey(key: string): string | null {
  if (!key.startsWith(SETTING_TEAM_TABS_PREFIX)) return null;
  return key.slice(SETTING_TEAM_TABS_PREFIX.length);
}

/**
 * Parse a stored allowlist value. Returns `null` when unset/blank/malformed
 * (meaning "no restriction"), or a de-duplicated string[] of toggleKeys.
 */
export function parseTeamTabs(value: string | null | undefined): string[] | null {
  if (value == null || value.trim() === '') return null;
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) return null;
    const keys = raw.filter((k): k is string => typeof k === 'string');
    return Array.from(new Set(keys));
  } catch {
    return null;
  }
}

/** Serialize a selection to the stored JSON form. */
export function serializeTeamTabs(keys: string[]): string {
  return JSON.stringify(Array.from(new Set(keys)));
}

type SettingRow = { pmo_key: string | null; pmo_value: string | null };

/**
 * Compute the effective allowlist for a viewer, given the app settings and the
 * set of team ids the viewer belongs to. Returns:
 *   - `null` when NO restriction applies (no team of the viewer's has an
 *     allowlist) — callers must treat this as "show everything as normal".
 *   - a `Set<string>` of allowed toggleKeys (the union) when at least one of the
 *     viewer's teams has an allowlist.
 */
export function resolveAllowedNavKeys(
  settings: ReadonlyArray<SettingRow> | undefined,
  viewerTeamIds: ReadonlySet<string> | null | undefined,
): Set<string> | null {
  if (!settings || !viewerTeamIds || viewerTeamIds.size === 0) return null;
  let anyAllowlist = false;
  const union = new Set<string>();
  for (const row of settings) {
    if (!row.pmo_key) continue;
    const teamId = extractTeamIdFromTabsKey(row.pmo_key);
    if (!teamId || !viewerTeamIds.has(teamId)) continue;
    const list = parseTeamTabs(row.pmo_value);
    if (list == null) continue; // this team has no restriction
    anyAllowlist = true;
    for (const k of list) union.add(k);
  }
  return anyAllowlist ? union : null;
}

/**
 * Decide whether a single nav item is visible under an allowlist.
 * - `allowed === null` => no restriction => always visible.
 * - items with no toggleKey (structural, e.g. Dashboard) => always visible.
 * - otherwise visible iff the toggleKey is in the allowed set.
 */
export function isNavItemAllowed(allowed: Set<string> | null, toggleKey: string | undefined): boolean {
  if (allowed === null) return true;
  if (!toggleKey) return true;
  return allowed.has(toggleKey);
}
