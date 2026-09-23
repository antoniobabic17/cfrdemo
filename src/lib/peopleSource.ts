/**
 * People-picker source flag.
 *
 * `pmo.people_source` governs where EVERY people picker in the app (Project
 * Manager, Executive Sponsor, Strategic Account Executive, ...) searches for
 * people:
 *
 *   'systemuser' -- Dataverse systemuser table (default). Works with no
 *                   connector, but only surfaces provisioned Dataverse users.
 *   'o365'       -- Office 365 / Entra directory via the Office 365 Users
 *                   connector (SDK-routed). Surfaces the whole tenant
 *                   directory. Requires the shared_office365users connector to
 *                   be wired into the Code App (pac code add-data-source) and a
 *                   connection created in the environment. When the connector
 *                   is absent the people-search service soft-falls-back to
 *                   'systemuser' so the UI never blanks.
 *
 * Mirrors the shape of lib/taskSource.ts (pmo.data_source). Stored in
 * pmo_appsetting, gated pmo_admin (see settingKeyRoles.ts). See
 * docs/planning/sae-systemuser-to-aad-transition-plan.md.
 */

import { useEffect } from 'react';

import { useAppSettings } from '../hooks/useAppSettings';

export type PeopleSource = 'systemuser' | 'o365';

const SETTING_KEY = 'pmo.people_source';
const DEFAULT_SOURCE: PeopleSource = 'systemuser';

/** Coerce any stored/raw value to the systemuser|o365 enum. */
export function coercePeopleSource(v: string | undefined | null): PeopleSource {
  return v === 'o365' ? 'o365' : 'systemuser';
}

/** True iff `v` is an accepted enum value. */
export function isPeopleSource(v: string | undefined): v is PeopleSource {
  return v === 'systemuser' || v === 'o365';
}

function resolveFromSettings(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): PeopleSource {
  const v = settings?.find((s) => s.pmo_key === SETTING_KEY)?.pmo_value ?? undefined;
  return coercePeopleSource(v);
}

// Module-level cache so non-React callers (and the picker service adapters)
// can read the last-resolved source without threading settings through every
// call. usePeopleSource() republishes it in an effect whenever the resolved
// value changes -- after commit, not during render.
let _cached: PeopleSource = DEFAULT_SOURCE;

/** Non-React accessor for the last source resolved by usePeopleSource(). */
export function getCachedPeopleSource(): PeopleSource {
  return _cached;
}

/**
 * React hook. Subscribes to the app-settings query so an admin flip re-renders
 * every picker.
 */
export function usePeopleSource(): PeopleSource {
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
    _cached = resolved;
  }, [resolved]);
  return resolved;
}

/** Non-hook accessor for code paths that already hold the settings array. */
export function getPeopleSource(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): PeopleSource {
  return resolveFromSettings(settings);
}

export const PEOPLE_SOURCE_SETTING_KEY = SETTING_KEY;
export const PEOPLE_SOURCE_DEFAULT = DEFAULT_SOURCE;
