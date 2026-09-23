/**
 * Configuration portability (initiative #5).
 *
 * Export/import the `pmo_appsetting` config layer between environments as a
 * single self-describing JSON bundle. The bundle carries a manifest (provenance
 * + which keys need confirming) and the full config rows, so it doubles as a
 * backup and as the input to the CLI bootstrap (scripts/seed-env-settings.js).
 *
 * PLATFORM NOTE: the running (CSP-locked) app cannot install the Dataverse
 * solution/code/connection-refs — this module only moves the CONFIG layer.
 * The other layers are handled by the CLI/admin-portal (see
 * docs/DEPLOYMENT-PACKAGE.md).
 *
 * Key classification governs cross-environment safety:
 *   - identity : environment-specific; importing into a DIFFERENT env would
 *                clobber its identity (tenant, env label, P4W GUIDs, admins).
 *   - secret   : sensitive value that should not be blindly copied (API keys).
 *   - portable : behavior/config that is safe to move between environments.
 * The import UI defaults identity+secret keys DESELECTED so a cross-env import
 * can't clobber identity or leak a secret; an admin can re-check them for a
 * same-env restore.
 */
import {
  SETTING_TENANT_ID,
  SETTING_P4W_ENV_GUIDS,
  SETTING_ENVIRONMENT_LABEL,
  SETTING_ENVIRONMENT_BADGE_COLOR,
  SETTING_ADMIN_PRINCIPALS,
  SETTING_TENOR_API_KEY,
  SETTING_PMO_TEAM_FIELD,
  SETTING_SP_LIBRARY_BASE_URL,
  SETTING_STANDARD_CAPACITY_HOURS,
  SETTING_BRAND_SIDEBAR_NAME,
  SETTING_BRAND_APP_TITLE,
  SETTING_BRAND_GREETING,
} from './constants';

export type KeyClass = 'portable' | 'identity' | 'secret';

/** Bundle schema version — bump when the shape changes incompatibly. */
export const CONFIG_BUNDLE_SCHEMA_VERSION = 1;
export const CONFIG_BUNDLE_KIND = 'cfr-pmo-config-bundle';

export interface ConfigBundleRow {
  pmo_key: string;
  pmo_value: string | null;
}

export interface RequiredKey {
  key: string;
  klass: KeyClass;
  reason: string;
}

/**
 * Self-describing catalog of EVERY app-level config key the app understands —
 * including keys that are currently UNSET in this environment. Exported inside
 * the bundle manifest so a downstream reader (an operator OR an LLM driving
 * first-time setup) sees the full surface, each key's meaning, default, allowed
 * values, class, and the value currently in effect (null when unset).
 *
 * Keeping this list here (not importing the CLI registry) keeps the app bundle
 * dependency-free; the two lists are intentionally kept in sync — if you add a
 * new pmo_appsetting key, add it here too so the export stays complete.
 */
export interface ConfigKeyCatalogEntry {
  key: string;
  klass: KeyClass;
  /** Short human/LLM-readable description of what the key controls. */
  description: string;
  /** The app's behavior when the key is unset. */
  default: string;
  /** Allowed values / format hint, when constrained. */
  allowed?: string;
  /** True when the app requires this for a working environment (first admin). */
  required?: boolean;
  /** Current value in the exporting environment (null when unset). */
  currentValue: string | null;
}

/** The known-key definitions (value-independent). currentValue is filled at export. */
const CONFIG_KEY_DEFS: Omit<ConfigKeyCatalogEntry, 'currentValue' | 'klass'>[] = [
  { key: SETTING_TENANT_ID, description: 'Microsoft Entra (Azure AD) directory tenant GUID for this environment. Drives Planner deep-links.', default: 'unset — deep-links omit ?tid=', allowed: 'GUID', required: false },
  { key: SETTING_PMO_TEAM_FIELD, description: 'Dataverse Team column that marks a team as a PMO team.', default: "'pmo_pmoteam'", allowed: 'a Team column logical name' },
  { key: SETTING_ENVIRONMENT_LABEL, description: 'Header/sidebar environment badge text.', default: 'auto-detected from the environment id', allowed: "free text, e.g. DEV | UAT | PROD | SANDBOX (case-insensitive)" },
  { key: SETTING_ENVIRONMENT_BADGE_COLOR, description: 'Header badge color.', default: 'derived from the label (DEV=amber, UAT=sky, else emerald)', allowed: 'amber | sky | emerald | rose | violet | slate' },
  { key: SETTING_P4W_ENV_GUIDS, description: 'Project-for-the-Web env-pinned GUIDs (PSS path).', default: 'compiled P4W_GUIDS_BY_ENV for the matched env', allowed: 'JSON {calendarId, workHoursTemplateId, orgUnitId}' },
  { key: 'pmo.file_source', description: 'Document storage backend for every file surface.', default: "'dataverse' (files as annotation rows)", allowed: "'dataverse' | 'sharepoint'" },
  { key: SETTING_SP_LIBRARY_BASE_URL, description: 'SharePoint library URL shown for documents (when file_source=sharepoint).', default: 'compiled SP library URL', allowed: 'a SharePoint document-library URL' },
  { key: 'pmo.data_source', description: 'Relational record backend for projects/tasks/programs.', default: "'pss' (Microsoft msdyn_ tables)", allowed: "'pss' | 'custom' (pmo_ tables)" },
  { key: 'pmo.task_source', description: 'Legacy task-only backend flag (kept writable during migration; prefer data_source).', default: 'follows pmo.data_source', allowed: "'pss' | 'custom'" },
  { key: 'pmo.people_source', description: 'Where the people-picker (SAE etc.) searches.', default: "'systemuser' (Dataverse)", allowed: "'systemuser' | 'o365'" },
  { key: 'pmo.fs_cascade_enabled', description: 'Whether the finish-to-start dependency date cascade runs after task date writes (custom path).', default: 'off', allowed: "'true' | 'false'" },
  { key: 'pmo.etl_enabled', description: 'Kill-switch for the pmo_ -> msdyn_ ETL mirror plugin.', default: 'off unless provisioned', allowed: "'true' | 'false'" },
  { key: SETTING_STANDARD_CAPACITY_HOURS, description: 'Standard monthly capacity hours for the New Resource Model capacity views.', default: '160', allowed: 'positive integer' },
  { key: SETTING_BRAND_SIDEBAR_NAME, description: 'Sidebar brand text next to the logo.', default: "'CFR PMO'", allowed: 'free text' },
  { key: SETTING_BRAND_APP_TITLE, description: 'Header banner title.', default: "'CFR Project Management'", allowed: 'free text' },
  { key: SETTING_BRAND_GREETING, description: 'Fixed header greeting; blank = time-based (Good morning/afternoon/evening).', default: 'time-based greeting', allowed: 'free text or blank' },
  { key: 'pmo.mira_agent_url', description: 'Copilot Studio ("Mira") agent endpoint URL.', default: 'unset — Mira panel disabled', allowed: 'https URL' },
  { key: 'pmo.mira_config_json', description: 'Mira signal thresholds / config JSON.', default: 'compiled defaults', allowed: 'JSON' },
  { key: SETTING_TENOR_API_KEY, description: 'Tenor GIF API key (announcement/bulletin GIF picker).', default: 'unset — GIF picker disabled', allowed: 'API key (secret)' },
  { key: SETTING_ADMIN_PRINCIPALS, description: 'FIRST ADMIN — additive admin grant beyond Dataverse role names.', default: 'none (role-name admins only)', allowed: 'JSON {teamIds[], userObjectIds[], groupObjectIds[]}', required: true },
];

export interface ConfigBundleManifest {
  kind: typeof CONFIG_BUNDLE_KIND;
  schemaVersion: number;
  exportedAt: string;
  exportedFromEnvLabel: string | null;
  exportedFromEnvId: string | null;
  appVersion: string;
  rowCount: number;
  /** Keys the importer must confirm before applying to a DIFFERENT environment. */
  requiredKeys: RequiredKey[];
  /** Full self-describing catalog of every known config key (incl. unset ones),
   *  with descriptions/defaults/allowed values + the current value. Lets an LLM
   *  drive first-time setup from an uploaded bundle without any other context. */
  keyCatalog: ConfigKeyCatalogEntry[];
}

export interface ConfigBundle {
  manifest: ConfigBundleManifest;
  config: ConfigBundleRow[];
}

// ── Key classification ───────────────────────────────────────────────────────
// Exact identity keys + secret keys. Everything else is portable. (Kept as a
// small explicit set — the safe default is 'portable' because unknown/new
// behavior config should move between envs; identity/secrets are enumerated.)
const IDENTITY_KEYS = new Set<string>([
  SETTING_TENANT_ID,
  SETTING_P4W_ENV_GUIDS,
  SETTING_ENVIRONMENT_LABEL,
  SETTING_ADMIN_PRINCIPALS,
]);
const SECRET_KEYS = new Set<string>([
  SETTING_TENOR_API_KEY,
]);

const IDENTITY_REASON: Record<string, string> = {
  [SETTING_TENANT_ID]: 'Entra tenant of the target environment — must match the destination.',
  [SETTING_P4W_ENV_GUIDS]: 'P4W GUIDs are per-environment — importing another env\u2019s values breaks conversion.',
  [SETTING_ENVIRONMENT_LABEL]: 'Environment badge label — should reflect the destination env.',
  [SETTING_ADMIN_PRINCIPALS]: 'Admin identity — importing another env\u2019s admins can lock out or over-grant.',
};

export function classifyKey(key: string): KeyClass {
  if (IDENTITY_KEYS.has(key)) return 'identity';
  if (SECRET_KEYS.has(key)) return 'secret';
  return 'portable';
}

/** True iff this key should be DESELECTED by default on import (cross-env unsafe). */
export function isDefaultDeselected(key: string): boolean {
  return classifyKey(key) !== 'portable';
}

function requiredKeyReason(key: string, klass: KeyClass): string {
  if (klass === 'secret') return 'Secret value — set the destination\u2019s own; do not copy blindly.';
  return IDENTITY_REASON[key] ?? 'Environment-specific — confirm before applying to another environment.';
}

// ── Build / parse ──────────────────────────────────────────────────────────

export interface BuildBundleEnv {
  envLabel: string | null;
  envId: string | null;
  appVersion: string;
}

/** Build a full bundle from the current settings (export = everything). */
export function buildBundle(rows: ConfigBundleRow[], env: BuildBundleEnv): ConfigBundle {
  const config = rows
    .map((r) => ({ pmo_key: r.pmo_key, pmo_value: r.pmo_value ?? null }))
    .sort((a, b) => a.pmo_key.localeCompare(b.pmo_key));
  // Full key catalog — every known key with its current value (null when unset),
  // so an uploaded bundle is self-describing for a human or an LLM.
  const valueByKey = new Map(config.map((r) => [r.pmo_key, r.pmo_value ?? null]));
  const keyCatalog: ConfigKeyCatalogEntry[] = CONFIG_KEY_DEFS.map((d) => ({
    ...d,
    klass: classifyKey(d.key),
    currentValue: valueByKey.get(d.key) ?? null,
  }));
  const requiredKeys: RequiredKey[] = config
    .map((r) => r.pmo_key)
    .filter((k) => classifyKey(k) !== 'portable')
    .map((k) => { const klass = classifyKey(k); return { key: k, klass, reason: requiredKeyReason(k, klass) }; });
  return {
    manifest: {
      kind: CONFIG_BUNDLE_KIND,
      schemaVersion: CONFIG_BUNDLE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      exportedFromEnvLabel: env.envLabel,
      exportedFromEnvId: env.envId,
      appVersion: env.appVersion,
      rowCount: config.length,
      requiredKeys,
      keyCatalog,
    },
    config,
  };
}

/** Serialize a bundle to pretty JSON for download. */
export function serializeBundle(bundle: ConfigBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export class BundleParseError extends Error {}

/** Parse + validate an uploaded bundle. Throws BundleParseError with a friendly message. */
export function parseBundle(text: string): ConfigBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleParseError('This file is not valid JSON. Export a bundle from Admin \u2192 System first.');
  }
  const obj = raw as Partial<ConfigBundle>;
  if (!obj || typeof obj !== 'object' || obj.manifest?.kind !== CONFIG_BUNDLE_KIND) {
    throw new BundleParseError('This file is not a CFR PMO config bundle.');
  }
  if (obj.manifest?.schemaVersion !== CONFIG_BUNDLE_SCHEMA_VERSION) {
    throw new BundleParseError(
      `Unsupported bundle version (${obj.manifest?.schemaVersion}). This app expects version ${CONFIG_BUNDLE_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(obj.config)) {
    throw new BundleParseError('Bundle is missing its config section.');
  }
  const config: ConfigBundleRow[] = [];
  for (const r of obj.config) {
    const key = (r as ConfigBundleRow)?.pmo_key;
    if (typeof key !== 'string' || !key) continue;
    const value = (r as ConfigBundleRow).pmo_value;
    config.push({ pmo_key: key, pmo_value: typeof value === 'string' ? value : value == null ? null : String(value) });
  }
  return { manifest: obj.manifest as ConfigBundleManifest, config };
}

// ── Diff (import preview) ────────────────────────────────────────────────────

export type ImportChangeType = 'add' | 'change' | 'unchanged';

export interface ImportDiffRow {
  key: string;
  klass: KeyClass;
  changeType: ImportChangeType;
  currentValue: string | null;
  incomingValue: string | null;
  /** JSON-valued keys whose incoming value fails to parse — never written. */
  malformed: boolean;
  /** Selected-by-default for apply (portable + a real change). */
  defaultSelected: boolean;
}

const looksJsonKey = (key: string) => key.endsWith('_json') || key.endsWith('.json');

function incomingIsMalformed(key: string, value: string | null): boolean {
  if (value == null || value === '') return false;
  if (!looksJsonKey(key)) return false;
  try { JSON.parse(value); return false; } catch { return true; }
}

/**
 * Compute the import preview: for each incoming row, whether it adds/changes/
 * is unchanged vs current, its class, malformed flag, and default selection.
 * Import is MERGE-only — keys present in current but absent from the bundle are
 * never touched, so they are not represented here.
 */
export function diffImport(
  current: ConfigBundleRow[],
  incoming: ConfigBundleRow[],
): ImportDiffRow[] {
  const currentMap = new Map(current.map((r) => [r.pmo_key, r.pmo_value ?? null]));
  return incoming.map((row) => {
    const key = row.pmo_key;
    const incomingValue = row.pmo_value ?? null;
    const klass = classifyKey(key);
    const has = currentMap.has(key);
    const currentValue = has ? currentMap.get(key)! : null;
    const changeType: ImportChangeType = !has ? 'add' : currentValue === incomingValue ? 'unchanged' : 'change';
    const malformed = incomingIsMalformed(key, incomingValue);
    const defaultSelected = klass === 'portable' && changeType !== 'unchanged' && !malformed;
    return { key, klass, changeType, currentValue, incomingValue, malformed, defaultSelected };
  });
}
