/**
 * Option-C data-source flag.
 *
 * `pmo.data_source` governs whether the app's PROJECT / TASK / PROGRAM read +
 * write paths go through Microsoft PSS (`msdyn_*` + `msdyn_PssUpdateV1`) or
 * through our custom `pmo_*` tables.
 *
 * Values:
 *   'pss'    -- Microsoft PSS tables (default). Reads/writes msdyn_* via the
 *               staging + PSS action APIs.
 *   'custom' -- Custom pmo_* tables. Reads AND writes go direct via OData to
 *               pmo_task / pmo_bucket / pmo_project / pmo_program (no PSS).
 *               A manual end-of-day script refreshes msdyn_* (and thus the
 *               Project for the Web / Planner web views) via PSS OperationSet.
 *
 * History: this started as `pmo.task_source` ('pss'|'hybrid'|'custom'), scoped
 * to tasks only. Stage 1 of the decoupling renamed it to `pmo.data_source`
 * (pss|custom) covering projects+tasks+programs and dropped the never-used
 * 'hybrid'. For a transition window we READ the new key first and FALL BACK to
 * the legacy `pmo.task_source` row so a not-yet-migrated env still works; a
 * legacy 'hybrid' value is coerced to 'custom'. The legacy alias exports
 * (useTaskSource/getTaskSource/TaskSource) remain so existing call sites keep
 * compiling; they now resolve the unified value.
 *
 * See `docs/pss-decoupling-c-design.md`. Stored in `pmo_appsetting`, gated on
 * `pmo_admin` (see `settingKeyRoles.ts`).
 */

import { useEffect } from 'react';

import { useAppSettings } from '../hooks/useAppSettings';

export type DataSource = 'pss' | 'custom' | 'sharepoint';
/** @deprecated alias of DataSource — kept so existing task-era imports compile. */
export type TaskSource = DataSource;

const SETTING_KEY = 'pmo.data_source';
const LEGACY_KEY = 'pmo.task_source';
const DEFAULT_SOURCE: DataSource = 'pss';

/** Coerce any stored/raw value to the pss|custom enum. Legacy 'hybrid' -> 'custom'. */
export function coerceDataSource(v: string | undefined | null): DataSource {
  if (v === 'custom' || v === 'hybrid') return 'custom';
  if (v === 'sharepoint') return 'sharepoint';
  return 'pss';
}

/** True iff `v` is an accepted enum value (pss|custom). */
export function isDataSource(v: string | undefined): v is DataSource {
  return v === 'pss' || v === 'custom' || v === 'sharepoint';
}
/** @deprecated alias — kept for existing imports. */
export const isTaskSource = isDataSource;
/**
 * True when the data source uses the custom `pmo_*` table schema — either the
 * Dataverse custom path OR the SharePoint-backed path (both share the same column
 * names and GUID-based relations).
 *
 * Use this instead of `=== 'custom'` wherever the intent is "am I on the custom
 * schema?", so SharePoint mode automatically picks up the same routing.
 */
export function usesCustomTables(s: DataSource): boolean {
  return s === 'custom' || s === 'sharepoint';
}

/** Pick the effective value from a settings array: new key first, then legacy. */
function resolveFromSettings(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): DataSource {
  const nu = settings?.find((s) => s.pmo_key === SETTING_KEY)?.pmo_value ?? undefined;
  if (nu != null) return coerceDataSource(nu);
  const legacy = settings?.find((s) => s.pmo_key === LEGACY_KEY)?.pmo_value ?? undefined;
  if (legacy != null) return coerceDataSource(legacy);
  return DEFAULT_SOURCE;
}

/**
 * React hook. Subscribes to the app-settings query so an admin flip re-renders
 * every consumer. Reads `pmo.data_source`, falling back to the legacy
 * `pmo.task_source` during the migration window.
 */
// Module-level cache of the last-resolved data source. useDataSource() publishes
// it in an effect whenever the resolved value changes, so non-React, fire-and-forget
// utilities (notify.ts, errorLog.ts, etc.) can pick the correct project bind target
// without threading the settings array through every call site. Defaults to 'pss'
// until the first commit resolves it — safe because those utilities are best-effort
// (errors swallowed) and same-GUID means a stale value only mislabels a
// non-critical notification/telemetry link.
let _cachedDataSource: DataSource = DEFAULT_SOURCE;

/** Non-React accessor for the last data source resolved by useDataSource(). */
export function getCachedDataSource(): DataSource {
  return _cachedDataSource;
}

export function useDataSource(): DataSource {
  const { data } = useAppSettings();
  const resolved = resolveFromSettings(data);
  // Published to the module cache AFTER commit, never during render. Reassigning
  // a module-level variable while rendering is a side effect (react-hooks/globals):
  // React may render speculatively, render twice in StrictMode, or discard a render
  // it never commits, so a render-phase write can publish a value the user never
  // saw. Every consumer of the cache is a fire-and-forget utility invoked from a
  // user gesture long after paint, so deferring the write by one commit is well
  // inside the staleness the cache was already documented to tolerate.
  useEffect(() => {
    _cachedDataSource = resolved;
  }, [resolved]);
  return resolved;
}
/** @deprecated alias of useDataSource — kept so existing task-era call sites compile. */
export const useTaskSource = useDataSource;

/**
 * Non-hook accessor for code paths that already hold the cached settings array
 * (e.g. an event handler). No module-level singleton — callers pass settings.
 */
/**
 * Non-hook accessor for code paths that already hold the cached settings array
 * (e.g. an event handler). No module-level singleton — callers pass settings.
 */
export function getDataSource(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): DataSource {
  return resolveFromSettings(settings);
}

/**
 * Explicitly prime the module-level cache from a settings array.
 * Call this (demo toggle, main.tsx demo-build boot) before any mutation
 * hook renders so non-React utilities already read the correct source.
 * Unlike useDataSource()'s useEffect this is synchronous and safe to call
 * outside React render. Unlike getDataSource() it DOES write the cache.
 */
export function primeDataSourceCache(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): void {
  _cachedDataSource = resolveFromSettings(settings);
}
/** @deprecated alias of getDataSource. */
export const getTaskSource = getDataSource;

/** Exposed for tests + migration script. */
export const DATA_SOURCE_SETTING_KEY = SETTING_KEY;
export const DATA_SOURCE_LEGACY_KEY = LEGACY_KEY;
export const DATA_SOURCE_DEFAULT = DEFAULT_SOURCE;
/** @deprecated aliases. */
export const TASK_SOURCE_SETTING_KEY = SETTING_KEY;
export const TASK_SOURCE_DEFAULT = DEFAULT_SOURCE;
