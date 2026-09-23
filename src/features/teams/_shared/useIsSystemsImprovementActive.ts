/**
 * useIsSystemsImprovementActive — is the UAT area visible to this viewer?
 *
 * Systems Improvement is a team-scoped surface (see systems-improvement/constants.ts):
 * only SI members see UAT by default, and admins must opt in via the "Act as Systems
 * Improvement" pill. This mirrors the admins-see-nothing-by-default rule that
 * useActiveTeamFeatures enforces for the routed packs, but for a single non-routed team.
 *
 * Reuses the existing team-impersonation store so the act-as pill flips this live.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useCurrentUserTeams, useCurrentUserTeamsWithNames } from '../../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../../providers/ConfigurationProvider';
import { isActingAsTeamMember, subscribeToTeamImpersonation } from './teamImpersonation';
import {
  SYSTEMS_IMPROVEMENT_TEAM_ID,
  SYSTEMS_IMPROVEMENT_TEAM_NAMES,
} from '../systems-improvement/constants';

/**
 * Pure decision seam — unit-testable without a provider. Same precedence as
 * useActiveTeamFeatures: acting-as wins, then admins see nothing, then real
 * membership by GUID or name.
 */
export function resolveSystemsImprovementActive(params: {
  actingAs: boolean;
  isAdmin: boolean;
  myTeamIds: Set<string> | undefined | null;
  myTeamNamesLower: Set<string> | undefined | null;
}): boolean {
  const { actingAs, isAdmin, myTeamIds, myTeamNamesLower } = params;
  if (actingAs) return true;
  if (isAdmin) return false;
  if (myTeamIds?.has(SYSTEMS_IMPROVEMENT_TEAM_ID)) return true;
  if (myTeamNamesLower) {
    return SYSTEMS_IMPROVEMENT_TEAM_NAMES.some((n) => myTeamNamesLower.has(n.trim().toLowerCase()));
  }
  return false;
}

export function useIsSystemsImprovementActive(): boolean {
  const adminRole = useEffectiveAdminRole();
  const myTeams = useCurrentUserTeams();
  const myTeamsWithNames = useCurrentUserTeamsWithNames();

  // Re-render when the act-as pill toggles.
  useSyncExternalStore(subscribeToTeamImpersonation, () =>
    isActingAsTeamMember(SYSTEMS_IMPROVEMENT_TEAM_ID) ? '1' : '0',
  );

  const myTeamNamesLower = useMemo(() => {
    if (!myTeamsWithNames) return null;
    return new Set(myTeamsWithNames.map((t) => t.name.trim().toLowerCase()));
  }, [myTeamsWithNames]);

  return useMemo(
    () =>
      resolveSystemsImprovementActive({
        actingAs: isActingAsTeamMember(SYSTEMS_IMPROVEMENT_TEAM_ID),
        isAdmin: adminRole !== 'none',
        myTeamIds: myTeams,
        myTeamNamesLower,
      }),
    [adminRole, myTeams, myTeamNamesLower],
  );
}
