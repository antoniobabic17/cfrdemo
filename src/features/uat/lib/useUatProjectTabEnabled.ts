/**
 * Resolves whether the UAT tab should appear for one project.
 *
 * Three steps, in order, and each can only turn UAT OFF:
 *
 *   1. the organisation toggle  projectTab.uat
 *   2. the team override        applied by useEffectiveFeatureToggles
 *   3. the project's own flag   pmo_uatenabled on pmo_uatprojectsetting
 *
 * USES useEffectiveFeatureToggles, NOT useFeatureToggles. ProjectDetailPage.tsx reads
 * the raw global for its other nine tabs, which means those tabs ignore team
 * opt-outs entirely — see progress.md finding 40. That is pre-existing and not
 * something to change from inside a UAT commit, but UAT must not inherit the bug:
 * G-ENABLE was answered opt-out-BY-TEAM, so a team override that does not reach the
 * tab would make the answer meaningless.
 *
 * WHILE THE SETTINGS ROW IS LOADING the tab is treated as ENABLED, not hidden.
 * Absence of a row means inherit and that is the overwhelmingly common case (no
 * backfill was done across ~2,026 projects), so hiding first and revealing later
 * would flicker the tab in for almost every project. Hiding is reserved for a
 * positively-known disable.
 */
import { useEffectiveFeatureToggles } from '../../../hooks/useEffectiveFeatureToggles';
import { isDemoActive } from '../../../lib/demoMode';
import { useUatProjectSetting } from '../../../hooks/useUatDefects';
import {
  UAT_TOGGLE_KEYS,
  isUatCapabilityEnabled,
  resolveUatEnabledForProject,
  explainUatEnablement,
  type UatEnablementReason,
} from './uatToggles';

export interface UatProjectTabState {
  /** True when the tab and its content should render. */
  enabled: boolean;
  /** Why, for an admin-facing explanation rather than a bare boolean. */
  reason: UatEnablementReason;
  /** True while the project's settings row is still being fetched. */
  isResolving: boolean;
}

export function useUatProjectTabEnabled(projectId: string | undefined): UatProjectTabState {
  if (isDemoActive()) return { enabled: false, reason: 'disabled-organisation-or-team', isResolving: false };
  const toggles = useEffectiveFeatureToggles();
  const orgAndTeamEnabled = isUatCapabilityEnabled(toggles, UAT_TOGGLE_KEYS.projectTab);
  const { data: settings, isPending } = useUatProjectSetting(projectId);

  // Short-circuit: with the organisation or the team switch off, the project's own
  // flag is irrelevant and there is nothing to wait for.
  if (!orgAndTeamEnabled) {
    return {
      enabled: false,
      reason: 'disabled-organisation-or-team',
      isResolving: false,
    };
  }

  // Still loading: treat as inherit-enabled. See the header — hiding first would
  // flicker for nearly every project.
  if (isPending) {
    return { enabled: true, reason: 'enabled-inherited', isResolving: true };
  }

  return {
    enabled: resolveUatEnabledForProject(orgAndTeamEnabled, settings),
    reason: explainUatEnablement(orgAndTeamEnabled, settings),
    isResolving: false,
  };
}
