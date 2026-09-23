/**
 * Per-team feature-toggle override hooks.
 *
 * A team lead can OFF a feature for everyone on their team. The override
 * lives in pmo_appsettings:
 *   key   = pmo.team_toggles.{teamId}
 *   value = JSON Partial<FeatureToggles>  (only OFF entries take effect)
 *
 * Resolver semantics: global toggle wins, except when one of the user's
 * team overrides explicitly sets the key to `false` — in which case the
 * effective value is `false`. A team-lead "ON" never grants a feature
 * the global has denied (this would be surprising and would require
 * elevated trust the leads don't have).
 */
import { useMemo } from 'react';
import { useAppSettings } from './useAppSettings';
import {
  parseTeamToggles,
  teamTogglesKey,
} from '../lib/teamSettings';
import type { FeatureToggles } from '../providers/ConfigurationProvider';

/** Single team's overrides — used by the per-team Feature Toggles editor. */
export function useTeamToggleOverrides(teamId: string | undefined): Partial<FeatureToggles> {
  const { data: settings = [] } = useAppSettings();
  return useMemo(() => {
    if (!teamId) return {};
    const row = settings.find((s) => s.pmo_key === teamTogglesKey(teamId));
    return parseTeamToggles(row?.pmo_value);
  }, [settings, teamId]);
}
