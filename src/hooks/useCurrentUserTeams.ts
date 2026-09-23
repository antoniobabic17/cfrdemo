/**
 * useCurrentUserTeams — returns the set of team GUIDs the current user
 * belongs to via Dataverse team membership.
 *
 * Used by the project permission gate (useCanEditProject) to decide whether
 * the user can edit a given project. Demo mode short-circuits to an empty
 * set; admins bypass the gate elsewhere so they don't need real memberships.
 *
 * Returns:
 *   - undefined while loading or before the user id resolves
 *   - Set<string> (possibly empty) on success
 */
import { useQuery } from '@tanstack/react-query';
import { useCurrentUserId } from './useCurrentUserId';
import { isDemoModeActive } from '../lib/demoMode';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

const QK = (userId: string) => ['currentUserTeams', userId] as const;

interface TeamRow {
  teamid: string;
  name?: string;
}

export interface CurrentUserTeam {
  teamid: string;
  name: string;
}

/**
 * Internal query - fetches the full team rows once and caches them. The
 * public hooks below derive their return shape from this single source so
 * we only hit Dataverse once even when both hooks are mounted.
 */
function useCurrentUserTeamRows() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: userId ? QK(userId) : ['currentUserTeams', 'pending'],
    enabled: !!userId && !isDemoModeActive(),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!userId) return [];
      // teammembership_association is the Dataverse N:N nav property between
      // systemuser and team. Same shape we use in ConfigurationProvider's
      // role resolution; here we ask for the team list instead of roles.
      return dv.list<TeamRow>(ENTITY_SETS.team, {
        $select: ['teamid', 'name'],
        $filter: `teammembership_association/any(u: u/systemuserid eq '${userId}')`,
      });
    },
  });
}

export function useCurrentUserTeams(): Set<string> | undefined {
  const { data } = useCurrentUserTeamRows();
  if (isDemoModeActive()) return new Set<string>();
  if (data == null) return undefined;
  return new Set(data.map((t) => t.teamid));
}

/**
 * Same membership set as useCurrentUserTeams but returns the team names
 * alongside the IDs. Used by the Sidebar "My Teams" debug pill so the
 * tooltip shows readable team names instead of GUIDs.
 */
export function useCurrentUserTeamsWithNames(): CurrentUserTeam[] | undefined {
  const { data } = useCurrentUserTeamRows();
  if (isDemoModeActive()) return [];
  if (data == null) return undefined;
  return data
    .map((t) => ({ teamid: t.teamid, name: t.name ?? '(unnamed team)' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
