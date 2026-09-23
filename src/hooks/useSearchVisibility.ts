/**
 * useSearchVisibility — aggregates the per-category visibility signals the
 * GlobalSearchBar needs to decide which categories to show for the current user.
 *
 * This is NOT a new permission system. It is a thin aggregation of the SAME
 * signals every other page already uses:
 *
 *   isAdmin          — useEffectiveAdminRole() !== 'none'
 *                      Gates: User Feedback category (admin-only detail route)
 *
 *   allowedNavKeys   — resolveAllowedNavKeys() applied to the viewer's teams
 *                      The same computation Sidebar.tsx uses per nav item.
 *                      null = unrestricted; Set<string> = team allowlist active.
 *                      Search respects this identically to the sidebar: a category
 *                      tagged with nav.projects is invisible when that key is not
 *                      in the viewer's allowlist union.
 *
 *   canSeePayerContent — useActiveTeamFeatures() has a Payer Initiatives module
 *                      active (real membership OR admin "Act as PI" pill).
 *                      Gates: Payer Inquiries + HPI categories.
 *
 * loading is true until all constituent hooks have resolved.
 */
import { useMemo } from 'react';
import { useEffectiveAdminRole } from '../providers/ConfigurationProvider';
import { useAppSettings } from './useAppSettings';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { useActiveTeamFeatures } from '../features/teams/_shared/useActiveTeamFeatures';
import { resolveAllowedNavKeys, isNavItemAllowed } from '../lib/teamTabVisibility';
import { PAYER_INITIATIVES_TEAM_ID } from '../features/teams/payer-initiatives/constants';

export interface SearchVisibility {
  isAdmin: boolean;
  /** Resolved nav-key allowlist for the viewer (null = unrestricted). */
  allowedNavKeys: Set<string> | null;
  /** True if the viewer is a Payer Initiatives team member (or is acting as one). */
  canSeePayerContent: boolean;
  /** True while any constituent hook is still loading. */
  loading: boolean;
  /** Convenience: returns true if this nav toggle key is visible to the viewer. */
  canSeeCategory: (toggleKey: string | undefined) => boolean;
}

export function useSearchVisibility(): SearchVisibility {
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';

  const { data: appSettings } = useAppSettings();
  const userTeams = useCurrentUserTeams();
  const activeFeatures = useActiveTeamFeatures();

  // Compute the viewer's nav-tab allowlist (same logic as Sidebar.tsx line ~199).
  // Admins bypass the allowlist entirely (they can always see everything).
  const allowedNavKeys = useMemo(() => {
    if (isAdmin) return null;
    if (!appSettings || !userTeams) return null; // still loading — treat as unrestricted
    const teamIdSet: Set<string> = new Set(Array.from(userTeams));
    return resolveAllowedNavKeys(appSettings, teamIdSet);
  }, [isAdmin, appSettings, userTeams]);

  // True when any active team-feature pack is for the Payer Initiatives team.
  // This fires both when the user is a real PI member AND when an admin has
  // toggled the "Act as Payer Initiatives" pill — same gate the Payer tabs use.
  const canSeePayerContent = useMemo(() => {
    return activeFeatures.some((m) => m.teamId === PAYER_INITIATIVES_TEAM_ID);
  }, [activeFeatures]);

  const loading = !appSettings || userTeams === undefined;

  const canSeeCategory = useMemo(() => (toggleKey: string | undefined) => {
    if (isAdmin) return true;
    return isNavItemAllowed(allowedNavKeys, toggleKey);
  }, [isAdmin, allowedNavKeys]);

  return {
    isAdmin,
    allowedNavKeys,
    canSeePayerContent,
    loading,
    canSeeCategory,
  };
}
