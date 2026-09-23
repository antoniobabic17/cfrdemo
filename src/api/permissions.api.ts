/**
 * Permissions admin queries.
 *
 * Two responsibilities:
 *   1. Monthly unique active users -- distinct-count of systemuserids that
 *      wrote a SessionPing telemetry row in each of the last 12 months.
 *   2. Per-user categorized project list -- given a systemuserid, return
 *      every project they can edit + the *reason(s)* they can edit it.
 *      Reasons stack; the effective scope is the highest of the applicable
 *      scopes.
 *
 * Effective-scope rules:
 *   admin / PM / ExecSponsor / Manager / PrimaryTeamLead / PrimaryTeamMember
 *      => 'full' (edit anything)
 *   collaborator with scope=FullProject
 *      => 'full'
 *   collaborator with scope=TasksAndNotes
 *      => 'tasks-and-notes'
 *
 * The 'tasks-and-notes' scope is only meaningful once Part B ships the
 * pmo_projectcollaborator table. Until then this resolver only returns the
 * team/named-role reasons.
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, SETTING_TEAM_LEAD_PREFIX } from '../lib/constants';
import type { DataSource } from '../lib/taskSource';
import { SESSION_PING_EVENT_TYPE } from '../hooks/useSessionPing';
import { usesCustomTables } from '../lib/taskSource';

// ── Monthly unique users ─────────────────────────────────────────────────

/** Shape of a SessionPing telemetry row after Web API $select. */
export interface SessionPingRow {
  createdon: string;
  pmo_payload?: string | null;
  _createdby_value?: string | null;
}

/**
 * Bucket SessionPing rows into YYYY-MM month keys → (userId → best-known name).
 *
 * User-id resolution order (per row):
 *   1. Parse pmo_payload as JSON and use `actorUserId` when present. This is
 *      what useSessionPing writes and matches the real interactive user even
 *      when the row's `createdby` is a proxy (e.g. an S2S account).
 *   2. Fall back to `_createdby_value` (Dataverse's lookup for the creator).
 *
 * Name resolution (per row) is a best-effort optimization so the UI can render
 * a real name without a separate systemuser round-trip:
 *   - If the payload carries `actorFullName` (useSessionPing writes it since
 *     day one), we cache it against the id. This is critical because in some
 *     Power Apps runtime contexts a follow-up $filter=systemuserid eq X call
 *     against `systemusers` silently returns partial results and the id ends
 *     up rendered as a raw GUID (root cause for the 2026-07-14 PROD sighting
 *     of `936a6d1e-...` = Weir, Patrick). Preferring the in-payload name
 *     eliminates that entire failure class.
 *   - If a later row for the same id carries a name and the earlier row
 *     didn't, we upgrade.
 *
 * All ids are lowercased before dedup so the same user counted via both paths
 * within a month is still a single distinct license.
 *
 * Exported so we can unit-test the bucketing without mocking dv.list.
 */
export function bucketRowsByMonth(rows: SessionPingRow[]): Map<string, Map<string, string | null>> {
  const byMonth = new Map<string, Map<string, string | null>>();
  for (const r of rows) {
    if (!r.createdon) continue;
    let userId: string | undefined;
    let fullName: string | undefined;
    if (r.pmo_payload) {
      try {
        const p = JSON.parse(r.pmo_payload) as { actorUserId?: unknown; actorFullName?: unknown };
        if (typeof p.actorUserId === 'string' && p.actorUserId) {
          userId = p.actorUserId.toLowerCase();
        }
        if (typeof p.actorFullName === 'string' && p.actorFullName.trim()) {
          fullName = p.actorFullName;
        }
      } catch {
        /* fall through to createdby */
      }
    }
    if (!userId && r._createdby_value) userId = r._createdby_value.toLowerCase();
    if (!userId) continue;

    const d = new Date(r.createdon);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let bucket = byMonth.get(key);
    if (!bucket) { bucket = new Map(); byMonth.set(key, bucket); }
    // Prefer a real name over null; never overwrite an already-known name
    // (all rows for the same user should carry the same name; if they
    // don't, first-seen wins deterministically).
    const existing = bucket.get(userId);
    if (existing === undefined) {
      bucket.set(userId, fullName ?? null);
    } else if (existing === null && fullName) {
      bucket.set(userId, fullName);
    }
  }
  return byMonth;
}

export interface MonthlyBucket {
  /** YYYY-MM (local time). */
  month: string;
  /** Distinct systemuserids that pinged in that month. */
  distinctUsers: number;
  /** Systemuserids (deduped). Order = ascending. */
  userIds: string[];
  /** Best-known fullname per userId, harvested from the SessionPing payload
   *  (`actorFullName`) at write time. `null` when the payload did not carry
   *  a name and the UI should fall back to its own resolve path. */
  userNames: Record<string, string | null>;
}

/**
 * Aggregate SessionPing rows by month over the last N months (default 12).
 * Client-side aggregation because Dataverse Web API doesn't do
 * COUNT DISTINCT natively. The row count is capped by page size (200 per
 * page) so we walk pagination via listSessionPingRaw.
 */
export async function fetchMonthlyUniqueUsers(months = 12): Promise<MonthlyBucket[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  cutoff.setDate(1);
  cutoff.setHours(0, 0, 0, 0);

  const rows = await dv.list<SessionPingRow>(
    ENTITY_SETS.telemetryEvent,
    {
      $select: ['pmo_telemetryeventid', 'createdon', 'pmo_payload', '_createdby_value'],
      $filter: `pmo_eventtype eq '${SESSION_PING_EVENT_TYPE}' and createdon ge ${cutoff.toISOString()}`,
      $orderby: 'createdon asc',
    },
  );

  const byMonth = bucketRowsByMonth(rows);

  // Emit the last N months even if empty, so charts don't have gaps.
  const out: MonthlyBucket[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = byMonth.get(key);
    const users = bucket ? Array.from(bucket.keys()) : [];
    users.sort();
    const userNames: Record<string, string | null> = {};
    if (bucket) for (const [uid, name] of bucket) userNames[uid] = name;
    out.push({ month: key, distinctUsers: users.length, userIds: users, userNames });
  }
  return out;
}

// ── Per-user categorized project list ────────────────────────────────────

export type PermissionReason =
  | 'admin'
  | 'project_manager'
  | 'executive_sponsor'
  | 'manager'
  | 'primary_team_lead'
  | 'primary_team_member'
  | 'collaborator_full'
  | 'collaborator_tasks_and_notes';

export type EffectiveScope = 'full' | 'tasks-and-notes' | 'read-only';

export interface ProjectWithReasons {
  projectId: string;
  projectName: string;
  reasons: PermissionReason[];
  effectiveScope: EffectiveScope;
}

export interface UserPermissionsResult {
  isAdmin: boolean;
  /** Deduped list of projects the user can edit + why. */
  projects: ProjectWithReasons[];
}

/**
 * Compute the categorized project-permission list for a user. Read-only.
 * Not called on hot paths; renders on the Permissions admin page.
 *
 * Note: Part A ONLY covers admin / PM / sponsor / manager / team-lead /
 * primary-team-member reasons. Collaborator reasons hydrate once Part B
 * ships pmo_projectcollaborator. Guard the collaborator query so its
 * absence doesn't break the whole resolver in DEV before Part B lands.
 */
export async function fetchUserProjectPermissions(
  userId: string,
  opts: { isAdmin?: boolean; source?: DataSource } = {},
): Promise<UserPermissionsResult> {
  if (!userId) return { isAdmin: !!opts.isAdmin, projects: [] };
  const userIdLc = userId.toLowerCase();
  // On the custom source, project attributes live on pmo_projects, not the
  // msdyn_project shell. GUIDs are shared; only the entity set + id/name/lookup
  // FK column names differ. `P` centralizes them so queries + mapping stay correct.
  const custom = opts.source != null ? usesCustomTables(opts.source) : false;
  const P = {
    set: custom ? 'pmo_projects' : ENTITY_SETS.project,
    id: custom ? 'pmo_projectid' : 'msdyn_projectid',
    name: custom ? 'pmo_subject' : 'msdyn_subject',
    pm: custom ? '_pmo_projectmanager_value' : '_msdyn_projectmanager_value',
    sponsor: custom ? '_pmo_executivesponsor_value' : '_proj_executivesponsor_value',
    manager: custom ? '_pmo_manager_value' : '_proj_manager_value',
  };

  // (a) Named-role projects: user is PM, ExecSponsor, or Manager.
  const namedRoleFilter =
    `${P.pm} eq ${userId} or ${P.sponsor} eq ${userId} or ${P.manager} eq ${userId}`;
  const namedRoleRaw = await dv.list<Record<string, unknown>>(P.set, {
    $select: [P.id, P.name, P.pm, P.sponsor, P.manager, '_pmo_primaryteam_value', 'statecode'],
    $filter: `(${namedRoleFilter}) and statecode eq 0`,
    $orderby: `${P.name} asc`,
  });
  const namedRoleProjects = namedRoleRaw.map((r) => ({
    projectId: r[P.id] as string,
    projectName: (r[P.name] as string) ?? '(untitled)',
    pm: (r[P.pm] as string | undefined)?.toLowerCase(),
    sponsor: (r[P.sponsor] as string | undefined)?.toLowerCase(),
    manager: (r[P.manager] as string | undefined)?.toLowerCase(),
  }));

  // (b) Primary-team-member projects: user is on the primary team.
  //     Uses the teammembership_association N:N -- same pattern as
  //     hooks/useCurrentUserTeams.ts:49.
  const memberTeams = await dv.list<{ teamid: string }>('teams', {
    $select: ['teamid'],
    $filter: `teammembership_association/any(u: u/systemuserid eq '${userId}')`,
    $top: 500,
  });
  const teamIds = new Set<string>();
  for (const t of memberTeams) teamIds.add(t.teamid.toLowerCase());

  let teamProjects: { projectId: string; projectName: string }[] = [];
  if (teamIds.size > 0) {
    const inClause = Array.from(teamIds)
      .map((id) => `_pmo_primaryteam_value eq ${id}`)
      .join(' or ');
    const raw = await dv.list<Record<string, unknown>>(P.set, {
      $select: [P.id, P.name, '_pmo_primaryteam_value'],
      $filter: `(${inClause}) and statecode eq 0`,
      $orderby: `${P.name} asc`,
    });
    teamProjects = raw.map((r) => ({ projectId: r[P.id] as string, projectName: (r[P.name] as string) ?? '(untitled)' }));
  }

  // (c) Primary-team-lead projects: user's id matches
  //     pmo_appsetting[pmo.team_lead.<primaryTeamId>].
  const leadRows = await dv.list<{
    pmo_key: string;
    pmo_value: string;
  }>(ENTITY_SETS.appSetting, {
    $select: ['pmo_key', 'pmo_value'],
    $filter:
      `startswith(pmo_key, '${SETTING_TEAM_LEAD_PREFIX}') and ` +
      `pmo_value eq '${userId}' and statecode eq 0`,
  });
  const leadTeamIds = new Set<string>();
  for (const r of leadRows) {
    const id = r.pmo_key.slice(SETTING_TEAM_LEAD_PREFIX.length).toLowerCase();
    if (id) leadTeamIds.add(id);
  }
  let leadProjects: { projectId: string; projectName: string }[] = [];
  if (leadTeamIds.size > 0) {
    const inClause = Array.from(leadTeamIds)
      .map((id) => `_pmo_primaryteam_value eq ${id}`)
      .join(' or ');
    const raw = await dv.list<Record<string, unknown>>(P.set, {
      $select: [P.id, P.name, '_pmo_primaryteam_value'],
      $filter: `(${inClause}) and statecode eq 0`,
      $orderby: `${P.name} asc`,
    });
    leadProjects = raw.map((r) => ({ projectId: r[P.id] as string, projectName: (r[P.name] as string) ?? '(untitled)' }));
  }

  // (d) Collaborator projects -- deferred to Part B. Left as an empty
  //     bucket for now so the shape is stable.
  const collaboratorProjects: {
    projectId: string;
    projectName: string;
    scope: 'FullProject' | 'TasksAndNotes';
  }[] = [];

  // Combine into ProjectWithReasons rows.
  const byProject = new Map<string, ProjectWithReasons>();
  const upsert = (id: string, name: string, reason: PermissionReason) => {
    const key = id.toLowerCase();
    let row = byProject.get(key);
    if (!row) {
      row = { projectId: id, projectName: name, reasons: [], effectiveScope: 'read-only' };
      byProject.set(key, row);
    }
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
  };

  for (const p of namedRoleProjects) {
    if (p.pm === userIdLc) upsert(p.projectId, p.projectName, 'project_manager');
    if (p.sponsor === userIdLc) upsert(p.projectId, p.projectName, 'executive_sponsor');
    if (p.manager === userIdLc) upsert(p.projectId, p.projectName, 'manager');
  }
  for (const p of teamProjects) upsert(p.projectId, p.projectName, 'primary_team_member');
  for (const p of leadProjects) upsert(p.projectId, p.projectName, 'primary_team_lead');
  for (const c of collaboratorProjects) {
    upsert(c.projectId, c.projectName,
      c.scope === 'FullProject' ? 'collaborator_full' : 'collaborator_tasks_and_notes');
  }

  // Effective scope: full unless the ONLY reason is collaborator_tasks_and_notes.
  for (const row of byProject.values()) {
    row.effectiveScope = deriveEffectiveScope(row.reasons);
  }

  const projects = Array.from(byProject.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName));

  return { isAdmin: !!opts.isAdmin, projects };
}

/** Given a user's reasons on a project, return the effective scope.
 *  Exported for unit-test coverage of every permutation. */
export function deriveEffectiveScope(reasons: PermissionReason[]): EffectiveScope {
  if (reasons.length === 0) return 'read-only';
  const fullSources: PermissionReason[] = [
    'admin', 'project_manager', 'executive_sponsor', 'manager',
    'primary_team_lead', 'primary_team_member', 'collaborator_full',
  ];
  if (reasons.some((r) => fullSources.includes(r))) return 'full';
  if (reasons.includes('collaborator_tasks_and_notes')) return 'tasks-and-notes';
  return 'read-only';
}

/**
 * Resolve which PMO teams each user in the given list belongs to.
 * Returns a map of lowercase userId → array of teamids.
 * Uses the same teammembership_association/any(…) pattern and 50-id chunking
 * as fetchUserProjectPermissions.
 */
export async function resolveUserTeams(
  userIds: string[],
  pmoTeamField: string,
): Promise<Record<string, string[]>> {
  if (userIds.length === 0) return {};
  const out: Record<string, string[]> = {};
  // One query per user — this is called for at most DRILL_VISIBLE_CAP (~25) users on
  // an admin-only page. Uses the same teammembership_association/any(…) pattern as
  // fetchUserProjectPermissions so no new query shapes are introduced.
  //
  // pmoTeamField MUST be the runtime-resolved PMO-team flag column
  // (usePmoTeamField() -> pmo.pmo_team_field setting, default pmo_pmoteam).
  // It is env-specific: hardcoding it caused every query here to 400 in PROD
  // ("Could not find a property named 'pmo_ispmogroup'"), which silently
  // returned [] for every user and made the team filter match nothing.
  await Promise.all(userIds.map(async (userId) => {
    const uid = userId.toLowerCase();
    try {
      const teams = await dv.list<{ teamid: string }>('teams', {
        $select: ['teamid'],
        $filter: `${pmoTeamField} eq true and teammembership_association/any(u: u/systemuserid eq '${uid}')`,
        $top: 500,
      });
      out[uid] = teams.map((t) => t.teamid);
    } catch {
      out[uid] = [];
    }
  }));
  return out;
}

/** Human-readable label for each reason. Used by the Permissions page. */
export function reasonLabel(r: PermissionReason): string {
  switch (r) {
    case 'admin': return 'Administrator (global)';
    case 'project_manager': return 'Project Manager';
    case 'executive_sponsor': return 'Executive Sponsor';
    case 'manager': return 'Manager';
    case 'primary_team_lead': return 'Primary Team Lead';
    case 'primary_team_member': return 'Primary Team member';
    case 'collaborator_full': return 'Collaborator — Full project access';
    case 'collaborator_tasks_and_notes': return 'Collaborator — Tasks + Notes only';
  }
}
