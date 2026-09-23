/**
 * useTeamTabAllowlist — resolves the current viewer's per-team nav-tab allowlist.
 *
 * Returns:
 *   - `null` when NO restriction applies (none of the viewer's teams has an
 *     allowlist set) — callers show the normal nav.
 *   - a `Set<string>` of allowed `toggleKey`s (the UNION across the viewer's
 *     teams that DO have an allowlist) otherwise.
 *
 * Reads app settings (`pmo.team_tabs.<teamId>`) + the viewer's team memberships.
 * See lib/teamTabVisibility.ts for the semantics. Admins bypass this in the
 * Sidebar, so this hook is purely about the member experience.
 */
import { useMemo } from 'react';
import { useAppSettings } from './useAppSettings';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { resolveAllowedNavKeys } from '../lib/teamTabVisibility';

export function useTeamTabAllowlist(): Set<string> | null {
  const { data: settings = [] } = useAppSettings();
  const userTeams = useCurrentUserTeams();
  return useMemo(
    () => resolveAllowedNavKeys(settings, userTeams ?? null),
    [settings, userTeams],
  );
}
