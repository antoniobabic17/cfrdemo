/**
 * Resolver hook — merges global feature toggles with per-team overrides.
 *
 * Precedence (per user choice): global wins, except that any team the
 * current user belongs to can OFF a feature for everyone on that team.
 * A team-lead ON does NOT grant a feature the global has denied.
 *
 * Existing call sites can swap `useFeatureToggles()` → `useEffectiveFeatureToggles()`
 * for the same return shape; behavior is identical when no team override
 * exists. Components that explicitly want the raw global value (e.g. the
 * admin settings editor) should keep calling `useFeatureToggles()`.
 */
import { useMemo } from 'react';
import {
  useFeatureToggles,
  type FeatureToggles,
} from '../providers/ConfigurationProvider';
import { useAppSettings } from './useAppSettings';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import {
  parseTeamToggles,
  extractTeamIdFromTogglesKey,
} from '../lib/teamSettings';

export function useEffectiveFeatureToggles(): FeatureToggles {
  const global = useFeatureToggles();
  const userTeams = useCurrentUserTeams();
  const { data: settings = [] } = useAppSettings();

  return useMemo(() => {
    if (!userTeams || userTeams.size === 0) return global;
    const next: FeatureToggles = { ...global };
    for (const s of settings) {
      const teamId = extractTeamIdFromTogglesKey(s.pmo_key);
      if (!teamId) continue;
      if (!userTeams.has(teamId)) continue;
      const override = parseTeamToggles(s.pmo_value);
      for (const [k, v] of Object.entries(override)) {
        if (v === false) next[k] = false;
      }
    }
    return next;
  }, [global, userTeams, settings]);
}

/** Single-key convenience matching useFeatureToggle's signature. */
export function useEffectiveFeatureToggle(key: string): boolean {
  const toggles = useEffectiveFeatureToggles();
  return toggles[key] ?? true;
}
