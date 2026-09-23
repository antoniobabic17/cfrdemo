/**
 * Setting-key → required-role map.
 *
 * Every write path against `pmo_appsetting` goes through this resolver.
 * Reads are unrestricted; writes are gated. The rule table is
 * longest-prefix wins; the fallback role for an unknown key is
 * `pmo_admin` so a new setting can't ship without a gate by accident.
 *
 * The fallback matters -- if a future developer introduces
 * `pmo.something_new` and forgets to add a rule here, the write will be
 * blocked for everyone except admins. That's a safe default: the admin
 * user testing the feature will discover the missing rule immediately.
 *
 * Every `team_lead`-scoped rule ships an `ownerFromKey` that extracts
 * the team-id from the key suffix so the guard can check whether the
 * caller leads THIS specific team (not just "any team").
 */

import {
  SETTING_TEAM_LEAD_PREFIX,
  SETTING_TEAM_ANNOUNCEMENT_PREFIX,
  SETTING_TEAM_TOGGLES_PREFIX,
  SETTING_TEAM_TABS_PREFIX,
  SETTING_TEAM_NRM_DEFAULT_PREFIX,
  SETTING_TEAM_NRM_SNAPSHOT_PREFIX,
  SETTING_ADMIN_PRINCIPALS,
} from './constants';
import { SIDEBAR_TEAM_NAME_SETTING_PREFIX } from './pmoTeams';

export type RequiredRole =
  | 'pmo_admin'
  | 'system_admin'
  | 'team_lead'
  | 'team_member'
  | 'any_authenticated';

export interface SettingKeyRule {
  prefix: string;
  role: RequiredRole;
  /** For team-scoped rules, extracts the team-id from the key so the
   *  guard can check "is this caller a lead of THIS team". */
  ownerFromKey?: (key: string) => string | undefined;
}

const teamIdFromSuffix = (prefix: string) => (key: string) => {
  if (!key.startsWith(prefix)) return undefined;
  const rest = key.slice(prefix.length);
  return rest ? rest.toLowerCase() : undefined;
};

export const SETTING_KEY_ROLES: SettingKeyRule[] = [
  // Team-scoped settings a team lead can write for their own team.
  // Announcements are open to any member of the team (2026-07-17 --
  // operator loosened the gate so members can post announcements
  // without waiting on a lead). Feature toggles below stay lead-only.
  { prefix: SETTING_TEAM_ANNOUNCEMENT_PREFIX, role: 'team_member', ownerFromKey: teamIdFromSuffix(SETTING_TEAM_ANNOUNCEMENT_PREFIX) },
  { prefix: SETTING_TEAM_TOGGLES_PREFIX,      role: 'team_lead', ownerFromKey: teamIdFromSuffix(SETTING_TEAM_TOGGLES_PREFIX) },
  // Per-team nav-tab allowlist is an ADMIN visibility policy (not team-lead
  // self-service), so it is pmo_admin-gated, unlike team_toggles.
  { prefix: SETTING_TEAM_TABS_PREFIX,         role: 'pmo_admin' },
  // Per-team New Resource Model default + snapshot (Resourcing → Labor Hours).
  // Admin policy that affects every member's projects, so pmo_admin-gated.
  { prefix: SETTING_TEAM_NRM_DEFAULT_PREFIX,  role: 'pmo_admin' },
  { prefix: SETTING_TEAM_NRM_SNAPSHOT_PREFIX, role: 'pmo_admin' },
  // Collaboration mode for the project Collaborate tab.
  // Controls whether teams or individuals are added to projects. pmo_admin-gated.
  { prefix: 'pmo.collaboration_mode',         role: 'pmo_admin' },
  // Sidebar team-name overrides are admin-only (they show up in every
  // user's sidebar, not just members' -- treat as global config).
  { prefix: SIDEBAR_TEAM_NAME_SETTING_PREFIX, role: 'pmo_admin' },
  // Designating a lead is admin-only -- a lead cannot appoint themselves
  // or reassign leadership.
  { prefix: SETTING_TEAM_LEAD_PREFIX,         role: 'pmo_admin' },
  // Environment / integration constants -- system_admin only. Keep this
  // list conservative; the fallback below is pmo_admin so anything not
  // named here rolls up to PMO Administrator.
  { prefix: 'pmo.tenant_id',                  role: 'system_admin' },
  { prefix: 'pmo.pmo_team_field',             role: 'system_admin' },
  // Environment identity overrides (initiative #2 -- transferability). Same tier
  // as tenant_id: these define the environment's identity. system_admin only.
  { prefix: 'pmo.environment_label',          role: 'system_admin' },
  { prefix: 'pmo.p4w_env_guids_json',         role: 'system_admin' },
  // Configurable admin identity — who is granted pmo_admin beyond role names.
  { prefix: SETTING_ADMIN_PRINCIPALS,         role: 'system_admin' },
  { prefix: 'pmo.environment_badge_color',     role: 'system_admin' },
  // Branding overrides — sidebar name, header title, greeting. system_admin only.
  { prefix: 'pmo.brand_sidebar_name',          role: 'system_admin' },
  { prefix: 'pmo.brand_app_title',             role: 'system_admin' },
  { prefix: 'pmo.brand_greeting',              role: 'system_admin' },
  { prefix: 'pmo.mira_agent_url',             role: 'system_admin' },
  { prefix: 'pmo.mira_config_json',           role: 'system_admin' },
  // Option-C migration flag. Governs whether the app reads/writes tasks
  // via PSS (msdyn_projecttask) or via our custom pmo_task tables. See
  // docs/pss-decoupling-c-design.md.
  //   'pss'    -> Microsoft PSS msdyn tables (default)
  //   'custom' -> read + write via pmo_* tables; manual end-of-day sync to msdyn
  // pmo.data_source is the unified flag (projects+tasks+programs). pmo.task_source
  // is the legacy key kept writable during the migration window (Stage 1).
  { prefix: 'pmo.data_source',                role: 'pmo_admin' },
  { prefix: 'pmo.task_source',                role: 'pmo_admin' },
  // Governs whether the in-house FS dependency cascade runs after date
  // writes on pmo_task. Ships in Phase 3.5. Kill-switch if the cascade
  // misbehaves. See docs/pss-decoupling-c-design.md.
  { prefix: 'pmo.standard_capacity_hours',    role: 'pmo_admin' },
  { prefix: 'pmo.fs_cascade_enabled',         role: 'pmo_admin' },
  // Kill-switch for the pmo -> msdyn ETL plugin (PmoTaskEtlPlugin).
  // Ships in Phase 4. When false, the plugin exits early on every
  // invocation; msdyn_projecttask stops receiving updates from our
  // side. Users can force a re-sync afterward via the Admin > Data
  // > ETL Bulk Catchup card (pmo_EtlBulkCatchup CustomAPI).
  { prefix: 'pmo.etl_enabled',                role: 'pmo_admin' },
  // Governs where the Strategic Account Executive picker searches for
  // people ('systemuser' Dataverse table | 'o365' Entra directory via the
  // Office 365 Users connector). See lib/peopleSource.ts.
  { prefix: 'pmo.people_source',              role: 'pmo_admin' },
  // Governs where uploaded documents live for EVERY file surface (project /
  // task / program / intake-request / user-feedback / payer-inquiry):
  //   'dataverse'  -> Dataverse annotations (default)
  //   'sharepoint' -> Nexus-PMO / AppDocuments SharePoint library
  // One flag flips storage + links app-wide. See lib/fileSource.ts.
  { prefix: 'pmo.file_source',                role: 'pmo_admin' },
  // Displayed SharePoint library URL (config.spLibraryBaseUrl). Drives the
  // library URL shown for documents; the upload/read connector target is bound
  // at provisioning time. Made explicit (was falling through to the pmo_admin
  // default) so the gate is documented. See lib/sharePointConfig.ts.
  { prefix: 'pmo.sp_library_base_url',        role: 'pmo_admin' },
  // SharePoint site URL for the GENERAL-DATA backend (pmo.data_source='sharepoint').
  // Display/provisioning-script use only — the connector binding is provisioning-time.
  // See lib/sharePointData.ts and the Architecture & Templates admin UI.
  { prefix: 'pmo.sp_data_site_url',           role: 'pmo_admin' },
  // Persisted display-order for sidebar teams: JSON array of team GUIDs in the
  // order the admin dragged them. Drives the left-nav Teams section for all users.
  { prefix: 'pmo.sidebar_team_order',          role: 'pmo_admin' },
  // Admin-managed list of available Tracking Label values (JSON string array).
  // The actual tracking rows live in pmo_tracking (Global CRUD for all users);
  // only the admin-defined label vocabulary is gated here. pmo_admin only.
  { prefix: 'pmo.tracking_labels_json',        role: 'pmo_admin' },
];

export interface ResolvedRole {
  role: RequiredRole;
  /** For team-scoped rules, the specific team-id extracted from the key
   *  suffix. Guard should verify the caller leads this team. */
  teamId?: string;
  /** Which rule matched -- 'default' when nothing matched and we fell
   *  through to the safe pmo_admin fallback. */
  matchedPrefix: string | 'default';
}

/**
 * Longest-prefix match against SETTING_KEY_ROLES. Fall-through role for
 * unmatched keys is `pmo_admin`. Exported for tests.
 */
export function resolveRequiredRole(key: string): ResolvedRole {
  let best: SettingKeyRule | undefined;
  for (const rule of SETTING_KEY_ROLES) {
    if (key.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  if (!best) return { role: 'pmo_admin', matchedPrefix: 'default' };
  const teamId = best.ownerFromKey?.(key);
  return { role: best.role, teamId, matchedPrefix: best.prefix };
}
