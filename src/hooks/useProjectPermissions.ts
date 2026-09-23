/**
 * Project-level permission hooks.
 *
 * Permission model (per the May 2026 overhaul):
 *   - Admins (effective role !== 'none') can always edit.
 *   - Projects without a Primary Team are NOT editable by anyone except
 *     admins — admin must assign a team first.
 *   - Otherwise, a user can edit the project if they are a member of the
 *     project's Primary Team OR any of its Contributing teams (the rows in
 *     pmo_projectteam with statecode=0).
 *
 * All API mutations (project update, task create/update/delete, project-team
 * roster changes) should additionally guard via assertCanEditProject for
 * defense in depth, so the gate is not just UI hiding.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffectiveAdminRole } from '../providers/ConfigurationProvider';
import { useCurrentUserId } from './useCurrentUserId';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { listProjectTeams } from '../api/projectTeams.api';
import { listProjectCollaborators } from '../api/projectCollaborators.api';
import { useProject } from './useProjects';

export interface ProjectTeamIds {
  /** GUID of the project's Primary Team, or undefined if no team is assigned. */
  primaryTeamId?: string;
  /** GUIDs of all teams on the project (primary + contributing). */
  allTeamIds: Set<string>;
}

export function useProjectTeamIds(projectId: string | undefined): ProjectTeamIds | undefined {
  const { data: project } = useProject(projectId ?? '');
  const { data: roster } = useQuery({
    queryKey: ['projectTeams', projectId],
    enabled: !!projectId,
    queryFn: () => listProjectTeams(projectId!),
  });

  if (!projectId || !project || !roster) return undefined;

  // Primary team comes from the project row itself (pmo_PrimaryTeam lookup).
  // The roster table mirrors it as a TEAM_ROLE.Primary entry, but the project
  // row is the source of truth — read it directly.
  const primaryTeamId = project['_pmo_primaryteam_value'] ?? undefined;
  const allTeamIds = new Set<string>();
  if (primaryTeamId) allTeamIds.add(primaryTeamId);
  for (const row of roster) {
    const teamId = row['_pmo_team_value'];
    if (teamId) allTeamIds.add(teamId);
  }
  return { primaryTeamId, allTeamIds };
}

export interface ProjectEditPermission {
  /** True when the current user is allowed to edit this project. */
  canEdit: boolean;
  /** Why not (for read-only banner copy). undefined when canEdit is true or still loading. */
  reason?: 'no_primary_team' | 'not_on_team';
  /** True while any of the underlying queries are still resolving. */
  loading: boolean;
}

/**
 * Short user-facing copy for the read-only state. Use everywhere edits are
 * gated (button tooltips, banners, dialog footers) so the wording stays
 * consistent.
 *
 * Multiple teams can work on a project at once via the Collaborate tab, so
 * we phrase this in terms of "assignment" rather than "team membership".
 */
export const READ_ONLY_TOOLTIP = "You aren't assigned to this project. Ask the Primary Team to add your team in the Collaborate tab.";
export const READ_ONLY_TOOLTIP_SHORT = "You aren't assigned to this project.";
export const READ_ONLY_NO_PRIMARY_TEAM_TOOLTIP = 'This project has no Primary Team assigned. An admin must assign one before edits are possible.';

export function readOnlyReasonCopy(reason: ProjectEditPermission['reason']): string {
  if (reason === 'no_primary_team') return READ_ONLY_NO_PRIMARY_TEAM_TOOLTIP;
  return READ_ONLY_TOOLTIP;
}

export function useCanEditProject(projectId: string | undefined): ProjectEditPermission {
  const role = useEffectiveAdminRole();
  const userId = useCurrentUserId();
  const userTeams = useCurrentUserTeams();
  const teamIds = useProjectTeamIds(projectId);
  const { data: project } = useProject(projectId ?? '');
  // Also check for individual collaborator grants (Individual mode). These stay
  // active regardless of the current global collaboration mode setting, so a
  // toggle flip never revokes existing individual access (operator requirement).
  const { data: collaborators } = useQuery({
    queryKey: ['projectCollaborators', projectId],
    enabled: !!projectId && !!userId,
    queryFn: () => listProjectCollaborators(projectId!),
  });

  const loading = !projectId || teamIds === undefined || userTeams === undefined;

  // Admins always edit. Check this after `loading` so the UI doesn't flash
  // a read-only banner for an admin while the roster query is in flight.
  if (role !== 'none') return { canEdit: true, loading: false };

  // Named-role override: the Project Manager / Executive Sponsor / Manager
  // can edit the project regardless of team membership. These are explicit
  // accountability roles - if the org appointed you to one of them, you
  // shouldn't be locked out of your own project just because your team
  // isn't on the roster.
  if (userId && project) {
    const pm = project['_msdyn_projectmanager_value']?.replace(/[{}]/g, '').toLowerCase();
    const sp = project['_proj_executivesponsor_value']?.replace(/[{}]/g, '').toLowerCase();
    const mg = project['_proj_manager_value']?.replace(/[{}]/g, '').toLowerCase();
    const me = userId.replace(/[{}]/g, '').toLowerCase();
    if (pm === me || sp === me || mg === me) {
      return { canEdit: true, loading: false };
    }
  }

  // Individual-mode collaborator grant. Checked BEFORE the primary-team gate
  // and regardless of the current global collaboration mode setting -- an
  // individually-granted user keeps edit access even if their team isn't the
  // primary team, and even after an admin flips the mode setting back to
  // team-based (operator requirement: switching modes never revokes existing
  // individual grants).
  if (userId && collaborators) {
    const meLc = userId.replace(/[{}]/g, '').toLowerCase();
    const hasCollaboratorGrant = collaborators.some(
      (c) => c.statecode === 0 && (c['_pmo_user_value'] ?? '').toLowerCase() === meLc,
    );
    if (hasCollaboratorGrant) return { canEdit: true, loading: false };
  }

  if (loading) return { canEdit: false, loading: true };

  if (!teamIds.primaryTeamId) {
    return { canEdit: false, reason: 'no_primary_team', loading: false };
  }

  const overlap = [...teamIds.allTeamIds].some((id) => userTeams.has(id));
  if (overlap) return { canEdit: true, loading: false };
  return { canEdit: false, reason: 'not_on_team', loading: false };
}

/**
 * Throw if the current permission state would not allow editing. Use in
 * mutation hooks (defense in depth) so the API call is refused even if the
 * UI gate is somehow bypassed.
 *
 * The caller passes a resolved ProjectEditPermission rather than calling
 * the hook again, because hooks cannot run inside mutationFn closures.
 */
export function assertCanEditProject(perm: ProjectEditPermission, action: string): void {
  if (perm.canEdit) return;
  if (perm.loading) {
    throw new Error(`Permission check still loading — please try ${action} again in a moment.`);
  }
  if (perm.reason === 'no_primary_team') {
    throw new Error(`Cannot ${action}: this project has no Primary Team assigned. An admin must assign one first.`);
  }
  throw new Error(`Cannot ${action}: you aren't assigned to this project. Ask the Primary Team to add your team in the Collaborate tab.`);
}

/**
 * Stricter variant: can the current user modify the project's *team roster*
 * (add/remove Contributing teams in the Collaborate tab)? Only Primary Team
 * members + admins qualify. Contributing-team members can edit content but
 * not change who else has access.
 */
export function useCanEditProjectRoster(projectId: string | undefined): ProjectEditPermission {
  const role = useEffectiveAdminRole();
  const userId = useCurrentUserId();
  const userTeams = useCurrentUserTeams();
  const teamIds = useProjectTeamIds(projectId);
  const { data: project } = useProject(projectId ?? '');

  const loading = !projectId || teamIds === undefined || userTeams === undefined;

  if (role !== 'none') return { canEdit: true, loading: false };

  // PM / Exec Sponsor / Manager can manage the roster too - same override
  // rationale as useCanEditProject.
  if (userId && project) {
    const pm = project['_msdyn_projectmanager_value']?.replace(/[{}]/g, '').toLowerCase();
    const sp = project['_proj_executivesponsor_value']?.replace(/[{}]/g, '').toLowerCase();
    const mg = project['_proj_manager_value']?.replace(/[{}]/g, '').toLowerCase();
    const me = userId.replace(/[{}]/g, '').toLowerCase();
    if (pm === me || sp === me || mg === me) {
      return { canEdit: true, loading: false };
    }
  }

  if (loading) return { canEdit: false, loading: true };

  if (!teamIds.primaryTeamId) {
    return { canEdit: false, reason: 'no_primary_team', loading: false };
  }
  if (userTeams.has(teamIds.primaryTeamId)) {
    return { canEdit: true, loading: false };
  }
  return { canEdit: false, reason: 'not_on_team', loading: false };
}
