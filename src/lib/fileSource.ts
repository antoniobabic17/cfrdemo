/**
 * File-source flag — governs where the app stores + reads uploaded documents.
 *
 * `pmo.file_source` decides whether EVERY file surface (project / task / program
 * / intake-request / user-feedback / payer-inquiry documents) reads, writes, and
 * links against Dataverse or SharePoint:
 *
 *   'dataverse'  -- files live as Dataverse `annotation` rows (isdocument=true,
 *                   documentbody base64) bound to the record; links open a blob
 *                   URL. (default; today's behavior)
 *   'sharepoint' -- files live in the Nexus-PMO / AppDocuments SharePoint library
 *                   (per-record folder); uploads go via the pmo_UploadDocument-
 *                   ToSharePoint custom API, links open the SharePoint {Link}.
 *
 * ONE flag flips the whole app so links + storage always point at the same place.
 * Mirrors `pmo.data_source` (see taskSource.ts). Stored in `pmo_appsetting`,
 * gated on `pmo_admin` (see settingKeyRoles.ts). Read the new key; default to
 * 'dataverse' so an un-set env keeps working exactly as before.
 */
import { useAppSettings } from '../hooks/useAppSettings';

export type FileSource = 'dataverse' | 'sharepoint';

const SETTING_KEY = 'pmo.file_source';
const DEFAULT_SOURCE: FileSource = 'dataverse';

/** Coerce any stored/raw value to the enum; anything unknown -> default. */
export function coerceFileSource(v: string | undefined | null): FileSource {
  return v === 'sharepoint' ? 'sharepoint' : 'dataverse';
}

/** True iff `v` is an accepted enum value. */
export function isFileSource(v: string | undefined): v is FileSource {
  return v === 'dataverse' || v === 'sharepoint';
}

// Module-level cache so non-React, fire-and-forget utilities can read the current
// source without threading the settings array. resolveFromSettings() refreshes it.
let _cachedFileSource: FileSource = DEFAULT_SOURCE;

function resolveFromSettings(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): FileSource {
  const v = settings?.find((s) => s.pmo_key === SETTING_KEY)?.pmo_value ?? undefined;
  const resolved: FileSource = v != null ? coerceFileSource(v) : DEFAULT_SOURCE;
  // Refresh the module cache here (a plain function, not the hook) so non-React
  // utilities can read the current source without a render-time side effect.
  _cachedFileSource = resolved;
  return resolved;
}

/** Non-React accessor for the last file source resolved by useFileSource(). */
export function getCachedFileSource(): FileSource {
  return _cachedFileSource;
}

/**
 * React hook. Subscribes to app-settings so an admin flip re-renders every
 * consumer. Reads `pmo.file_source`, defaulting to 'dataverse'.
 */
export function useFileSource(): FileSource {
  const { data } = useAppSettings();
  return resolveFromSettings(data);
}

/** Non-hook accessor for callers that already hold the settings array. */
/** Non-hook accessor for callers that already hold the settings array. */
export function getFileSource(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): FileSource {
  return resolveFromSettings(settings);
}

/** Explicitly prime the module-level file-source cache (demo boot/toggle). */
export function primeFileSourceCache(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): void {
  _cachedFileSource = resolveFromSettings(settings);
}

/** Exposed for tests + the Admin toggle + migration tooling. */
export const FILE_SOURCE_SETTING_KEY = SETTING_KEY;
export const FILE_SOURCE_DEFAULT = DEFAULT_SOURCE;
