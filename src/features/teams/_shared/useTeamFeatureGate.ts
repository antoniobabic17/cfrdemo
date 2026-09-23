/**
 * Route-gate helper for feature-pack-owned routes. Returns a tri-state:
 *   { status: 'loading' }  team membership query still in flight -- callers
 *                          MUST render a placeholder, NOT redirect.
 *   { status: 'allowed' }  viewer is on the team (member or acting-as).
 *   { status: 'denied' }   viewer is not on the team and not impersonating.
 *
 * Prior boolean return conflated 'loading' with 'denied' -- a fresh
 * navigation to /hpi or /payer-issues would race the useCurrentUserTeams
 * query, get { data: undefined } on the first render, and immediately
 * <Navigate to='/dashboard' /> before the query settled (2026-07-16
 * operator report: Shelina Harvey bounced off /hpi despite being on the
 * Payer Initiatives team).
 */
import { useActiveTeamFeatures } from './useActiveTeamFeatures';
import { useCurrentUserTeams } from '../../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../../providers/ConfigurationProvider';
import { isActingAsTeamMember } from './teamImpersonation';

export type TeamFeatureGateStatus = 'loading' | 'allowed' | 'denied';

export interface TeamFeatureGateResult {
  status: TeamFeatureGateStatus;
  /** Convenience -- true iff status === 'allowed'. Backward-compat for
   *  callers that just want to render inline conditionally (galleries
   *  already do their own loading render). */
  allowed: boolean;
}

export function useTeamFeatureGateStatus(teamId: string): TeamFeatureGateResult {
  const adminRole = useEffectiveAdminRole();
  const myTeams = useCurrentUserTeams();
  const active = useActiveTeamFeatures();
  const target = teamId.toLowerCase();

  // Impersonation pill always wins (admin-driven, synchronous).
  if (isActingAsTeamMember(teamId)) return { status: 'allowed', allowed: true };

  // Admins who are NOT impersonating: 'denied' is a real answer today, no
  // reason to wait.
  if (adminRole !== 'none') return { status: 'denied', allowed: false };

  // Regular users: if the membership query is still loading we don't know
  // yet -- do NOT redirect. Once it lands, decide via active pack list.
  if (myTeams === undefined) return { status: 'loading', allowed: false };

  const allowed = active.some((m) => m.teamId.toLowerCase() === target);
  return { status: allowed ? 'allowed' : 'denied', allowed };
}

/** Backward-compat boolean helper for existing gallery-level 'not
 *  available' banners that don't care about the loading state. */
export function useTeamFeatureGate(teamId: string): boolean {
  return useTeamFeatureGateStatus(teamId).allowed;
}
