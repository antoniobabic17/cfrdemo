/**
 * Environment identity resolution (initiative #2 — transferability).
 *
 * Two pieces of per-environment identity were historically HARDCODED in
 * constants.ts and keyed by the live Power Apps `environmentId`:
 *   - the sidebar env badge label (ENV_IDS dev/uat/prod)
 *   - the P4W env-pinned GUIDs (calendar / work-hours template / org unit,
 *     P4W_GUIDS_BY_ENV)
 * That means moving the app to a NEW tenant/environment required a code change.
 *
 * This module lets an admin OVERRIDE those via `pmo_appsetting` rows so a new
 * environment needs only config, not a rebuild:
 *   - pmo.environment_label   -> the badge text for THIS environment
 *   - pmo.p4w_env_guids_json  -> { calendarId, workHoursTemplateId, orgUnitId }
 *
 * SAFETY / NET-NEUTRAL: when a setting is UNSET, every resolver falls back to
 * the EXACT legacy behavior (match environmentId against the compiled ENV_IDS /
 * P4W_GUIDS_BY_ENV). An environment that sets nothing behaves identically to
 * before. Mirrors the module-cache pattern in fileSource.ts / taskSource.ts so
 * the non-React intake-conversion path can read overrides without threading the
 * settings array.
 */
import {
  ENV_IDS,
  P4W_GUIDS_BY_ENV,
  ENV_BADGE_COLORS,
  SETTING_ENVIRONMENT_LABEL,
  SETTING_P4W_ENV_GUIDS,
  SETTING_ENVIRONMENT_BADGE_COLOR,
  type P4WEnvIds,
  type EnvBadgeColor,
} from './constants';

export type EnvironmentLabel = 'DEV' | 'UAT' | 'PROD' | string;

/**
 * Default badge color derived from the label — the legacy Sidebar behavior
 * (DEV=amber, UAT=sky, anything else=emerald). Used when
 * pmo.environment_badge_color is unset, so appearance is unchanged.
 */
export function defaultBadgeColorForLabel(label: EnvironmentLabel | null): EnvBadgeColor {
  // Normalize case so 'Dev', 'dev', 'DEV' all map the same — operators type the
  // label freeform and shouldn't have to match exact casing to get the color.
  const norm = label?.trim().toUpperCase();
  if (norm === 'DEV') return 'amber';
  if (norm === 'UAT') return 'sky';
  return 'emerald';
}

/** True iff `v` is a known palette name. */
function isEnvBadgeColor(v: string | undefined): v is EnvBadgeColor {
  return v != null && Object.prototype.hasOwnProperty.call(ENV_BADGE_COLORS, v);
}

/** Legacy label from the compiled ENV_IDS table for a given environmentId. */
export function labelFromEnvIds(environmentId: string | null | undefined): EnvironmentLabel | null {
  if (!environmentId) return null;
  if (environmentId === ENV_IDS.dev) return 'DEV';
  if (environmentId === ENV_IDS.uat) return 'UAT';
  if (environmentId === ENV_IDS.prod) return 'PROD';
  return null;
}

// ─── Module cache (primed by ConfigurationProvider) ──────────────────────────
// Non-React utilities (intakeConversion.getP4WEnvIds) read the last-resolved
// overrides without a render-time dependency. Unset => null => fallback path.
let _cachedEnvLabel: EnvironmentLabel | null = null;
let _cachedP4WGuids: P4WEnvIds | null = null;
let _cachedBadgeColor: EnvBadgeColor = 'emerald';

type SettingsArray = ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined;

function readSetting(settings: SettingsArray, key: string): string | undefined {
  const v = settings?.find((s) => s.pmo_key === key)?.pmo_value;
  return v != null && v !== '' ? v : undefined;
}

function parseP4W(raw: string | undefined): P4WEnvIds | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<P4WEnvIds>;
    if (o && typeof o.calendarId === 'string' && typeof o.workHoursTemplateId === 'string' && typeof o.orgUnitId === 'string') {
      return { calendarId: o.calendarId, workHoursTemplateId: o.workHoursTemplateId, orgUnitId: o.orgUnitId };
    }
  } catch {
    /* malformed -> treat as unset (fallback) */
  }
  return null;
}

/**
 * Prime the module cache from the settings array + the live environmentId.
 * Called by ConfigurationProvider once settings load. Returns the resolved
 * values so the provider can also expose them via context.
 */
export function primeEnvironmentConfig(
  settings: SettingsArray,
  environmentId: string | null | undefined,
): { environmentLabel: EnvironmentLabel | null; p4wEnvGuids: P4WEnvIds | undefined; environmentBadgeColor: EnvBadgeColor } {
  const label = readSetting(settings, SETTING_ENVIRONMENT_LABEL) ?? labelFromEnvIds(environmentId);
  const p4wOverride = parseP4W(readSetting(settings, SETTING_P4W_ENV_GUIDS));
  const p4w = p4wOverride ?? (environmentId ? P4W_GUIDS_BY_ENV[environmentId] : undefined);
  const colorRaw = readSetting(settings, SETTING_ENVIRONMENT_BADGE_COLOR);
  const badgeColor: EnvBadgeColor = isEnvBadgeColor(colorRaw) ? colorRaw : defaultBadgeColorForLabel(label);
  _cachedEnvLabel = label;
  _cachedP4WGuids = p4w ?? null;
  _cachedBadgeColor = badgeColor;
  return { environmentLabel: label, p4wEnvGuids: p4w, environmentBadgeColor: badgeColor };
}

/** Non-React accessor for the resolved P4W GUIDs (override first, else legacy). */
export function getCachedP4WEnvIds(): P4WEnvIds | null {
  return _cachedP4WGuids;
}

/** Non-React accessor for the resolved env label. */
export function getCachedEnvironmentLabel(): EnvironmentLabel | null {
  return _cachedEnvLabel;
}

/** Non-React accessor for the resolved env badge color. */
export function getCachedEnvironmentBadgeColor(): EnvBadgeColor {
  return _cachedBadgeColor;
}
