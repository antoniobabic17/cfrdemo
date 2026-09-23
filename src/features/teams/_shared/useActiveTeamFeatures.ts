/**
 * useActiveTeamFeatures — single source of truth for "which team feature
 * packs should render for the current viewer right now".
 *
 * Rules (intentional; do not loosen without product approval):
 *  - A regular user sees the pack for every team they are an actual
 *    member of (via teammembership_association).
 *  - An admin sees NO team feature packs by default. Admin role grants
 *    administration scope, not membership. Admins must opt in per team
 *    via the "Act as <team> member" pill.
 *  - Per-team impersonation is additive — toggling Payer Initiatives on
 *    does not pull in any other team.
 *  - Once toggled on by an admin, the pack renders even if the admin is
 *    NOT a real member of the team. That is the whole point of the pill.
 *
 * Output is a stable list (preserves registry order) of TeamFeatureModule.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useCurrentUserTeams, useCurrentUserTeamsWithNames } from '../../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../../providers/ConfigurationProvider';
import { listAllTeamFeatures } from './teamFeatureRegistry';
import {
  isActingAsTeamMember,
  subscribeToTeamImpersonation,
} from './teamImpersonation';
import type { TeamFeatureModule } from './types';

export function useActiveTeamFeatures(): TeamFeatureModule[] {
  const adminRole = useEffectiveAdminRole();
  const myTeams = useCurrentUserTeams();
  const myTeamsWithNames = useCurrentUserTeamsWithNames();

  // useSyncExternalStore so toggling the pill re-renders all consumers
  // immediately without prop-drilling or a context bus.
  useSyncExternalStore(subscribeToTeamImpersonation, () =>
    listAllTeamFeatures()
      .map((m) => `${m.teamId}:${isActingAsTeamMember(m.teamId) ? 1 : 0}`)
      .join('|'),
  );

  // Lowercased names of teams the current user is on. Used to match packs
  // that declare env-portable teamNames alongside (or instead of) a
  // hardcoded GUID. Cheap to compute — user is on a handful of teams.
  const myTeamNamesLower = useMemo(() => {
    if (!myTeamsWithNames) return null;
    return new Set(myTeamsWithNames.map((t) => t.name.trim().toLowerCase()));
  }, [myTeamsWithNames]);

  return useMemo(() => {
    const all = listAllTeamFeatures();
    const isAdmin = adminRole !== 'none';
    return all.filter((mod) => {
      // Impersonation pill wins — admin explicitly acting as this team.
      if (isActingAsTeamMember(mod.teamId)) return true;
      // Admins otherwise see nothing until they toggle the pill.
      if (isAdmin) return false;
      // Regular users: GUID match (legacy path, still authoritative for
      // per-environment custom teams) OR any teamNames match (cross-env
      // portable path for AAD-linked teams whose GUID differs per env).
      if (myTeams?.has(mod.teamId)) return true;
      if (mod.teamNames && mod.teamNames.length > 0 && myTeamNamesLower) {
        return mod.teamNames.some((n) => myTeamNamesLower.has(n.trim().toLowerCase()));
      }
      return false;
    });
  }, [adminRole, myTeams, myTeamNamesLower]);
}
