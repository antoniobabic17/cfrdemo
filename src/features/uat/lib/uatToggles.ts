/**
 * The UAT enablement seam.
 *
 * Seven keys, and this is a TOGGLE seam rather than a team-feature-pack seam.
 * G-ENABLE was answered opt-out-by-team: the owner's words were "everyone, unless a
 * team opts out". So UAT is on by default for the organisation, a team may switch it
 * off for itself, and a project may switch it off for itself. There is deliberately no
 * mechanism for granting UAT to a designated set of teams, because building one would
 * encode the opposite answer.
 *
 * PRECEDENCE IS ONE-WAY, AND IT IS NOT ENFORCED HERE. It is enforced by
 * hooks/useEffectiveFeatureToggles.ts, which merges only `false` values from team
 * overrides — a team-lead ON cannot grant what the organisation has denied. This file
 * relies on that rather than reimplementing it, so there is one place the rule lives.
 * uatToggles.test.ts proves the rule holds for a UAT key specifically, rather than
 * trusting that a hook which works generically also works here.
 *
 * The third step, the project's own pmo_uatenabled, is resolved by
 * resolveUatEnabledForProject below — because ABSENCE OF A SETTINGS ROW MEANS INHERIT,
 * and no generic toggle machinery knows that.
 */
import type { FeatureToggles } from '../../../providers/ConfigurationProvider';
import type { UatProjectSetting } from '../../../models/uatDefect.model';

/**
 * Every UAT feature-toggle key.
 *
 * `nav.uat` and `projectTab.uat` follow the existing namespaces so they sit in the
 * Left Navigation and Project Detail Tabs groups a reader already knows. The five
 * `uat.*` keys are capability switches within the feature.
 */
export const UAT_TOGGLE_KEYS = {
  /** The left-nav entry for the UAT area. */
  nav: 'nav.uat',
  /** The UAT tab on the project detail page. */
  projectTab: 'projectTab.uat',
  /** Template authoring — the configuration layer. */
  templates: 'uat.templates',
  /** Spreadsheet import and staging. */
  import: 'uat.import',
  /** Defect tracking. */
  defects: 'uat.defects',
  /** Requirement-to-test-case coverage reporting. */
  coverage: 'uat.coverage',
  /** The requirement backlog. */
  requirements: 'uat.requirements',
} as const;

export type UatToggleKey = (typeof UAT_TOGGLE_KEYS)[keyof typeof UAT_TOGGLE_KEYS];

/** Every key, for the registration cross-checks and the admin surface. */
export const ALL_UAT_TOGGLE_KEYS: readonly UatToggleKey[] = Object.values(UAT_TOGGLE_KEYS);

/**
 * Defaults for the seven keys — all true, because G-ENABLE is opt-out.
 *
 * Spread into DEFAULT_FEATURE_TOGGLES in ConfigurationProvider.tsx rather than
 * duplicated there, so the two cannot drift.
 */
export const UAT_DEFAULT_TOGGLES: Readonly<Record<UatToggleKey, boolean>> = {
  'nav.uat': true,
  'projectTab.uat': true,
  'uat.templates': true,
  'uat.import': true,
  'uat.defects': true,
  'uat.coverage': true,
  'uat.requirements': true,
} as const;

/**
 * Read one UAT capability from an already-resolved toggle map.
 *
 * Takes the map rather than calling a hook so it can be used in a non-React path and
 * unit-tested without a provider. Callers in components should pass
 * useEffectiveFeatureToggles() so team opt-outs are already applied.
 *
 * Defaults to TRUE for an unknown key, matching useFeatureToggle's behaviour: a
 * missing key means "not configured", and opt-out semantics make that "on".
 */
export function isUatCapabilityEnabled(
  toggles: FeatureToggles,
  key: UatToggleKey,
): boolean {
  return toggles[key] ?? true;
}

/**
 * The third and last resolution step: the project's own flag.
 *
 * ABSENCE OF A ROW MEANS INHERIT. `settings` is what
 * api/uatProjectSettings.ts's listUatProjectSetting returns — an EMPTY ARRAY when the
 * project has no settings row, which is the normal case and is why this table could be
 * introduced against ~2,026 existing projects without a backfill. An empty array must
 * never be read as "disabled".
 *
 * A row with pmo_uatenabled null is also inherit: the column being unset is not the
 * same as being set to false, and only an explicit false turns UAT off for a project.
 *
 * Note the asymmetry, which mirrors useEffectiveFeatureToggles: a project can only turn
 * UAT OFF. `organisationEnabled` false wins regardless of what the project row says,
 * so a stale pmo_uatenabled = true cannot resurrect a capability the organisation or
 * the team has withdrawn.
 */
export function resolveUatEnabledForProject(
  organisationEnabled: boolean,
  settings: readonly UatProjectSetting[] | undefined,
): boolean {
  if (!organisationEnabled) return false;
  const row = settings?.[0];
  if (!row) return true;
  if (row.pmo_uatenabled === null || row.pmo_uatenabled === undefined) return true;
  return row.pmo_uatenabled;
}

/**
 * Why a project shows or hides UAT, for an admin-facing explanation.
 *
 * Returned as a discriminated reason rather than a bare boolean so a settings screen
 * can say "off because your team opted out" instead of leaving someone to guess which
 * of three levels turned it off.
 */
export type UatEnablementReason =
  | 'enabled-inherited'
  | 'enabled-project-explicit'
  | 'disabled-organisation-or-team'
  | 'disabled-project';

export function explainUatEnablement(
  organisationEnabled: boolean,
  settings: readonly UatProjectSetting[] | undefined,
): UatEnablementReason {
  if (!organisationEnabled) return 'disabled-organisation-or-team';
  const row = settings?.[0];
  if (!row || row.pmo_uatenabled === null || row.pmo_uatenabled === undefined) {
    return 'enabled-inherited';
  }
  return row.pmo_uatenabled ? 'enabled-project-explicit' : 'disabled-project';
}
