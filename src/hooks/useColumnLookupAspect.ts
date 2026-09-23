/**
 * useColumnLookupAspect — read and write the org-wide lookup-aspect map for a
 * table. For each lookup column key, the aspect decides WHICH part of the
 * related record the grid shows: the primary Name (default), the raw GUID, an
 * email, or another target-specific attribute.
 *
 * Stored in pmo_appsettings under `columns.lookupAspect.<tableKey>` as a JSON
 * Record<colKey, aspect>. Keyed by internal column key, so a metadata re-pull
 * (which only writes `columns.catalog.*`) never clobbers it — same durability
 * contract as useColumnLabels.
 *
 * Per-user views can override this org default via an `aspects` map on the view
 * config (see userViews.api / DataTable); this hook is the org-level default.
 */
import { useCallback } from 'react';
import { useAppSettings, useUpsertSetting } from './useAppSettings';
import { lookupAspectKey, parseLookupAspects, type LookupAspect } from '../lib/tableViewRegistry';

export interface UseColumnLookupAspectResult {
  /** Current aspect overrides: colKey → aspect. Missing key ⇒ default ('name'). */
  aspects: Record<string, LookupAspect>;
  /** Upsert a single aspect (key → aspect). Pass 'name' to reset to default (clears the key). */
  setAspect: (colKey: string, aspect: LookupAspect) => Promise<void>;
}

export function useColumnLookupAspect(tableKey: string): UseColumnLookupAspectResult {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();

  const settingsKey = lookupAspectKey(tableKey);
  const raw = settings.find((s) => s.pmo_key === settingsKey)?.pmo_value ?? undefined;
  const aspects = parseLookupAspects(raw);

  const setAspect = useCallback(async (colKey: string, aspect: LookupAspect) => {
    const next = { ...aspects };
    // 'name' is the default — storing it is redundant, so clear the key instead.
    if (!aspect || aspect === 'name') {
      delete next[colKey];
    } else {
      next[colKey] = aspect;
    }
    await upsert.mutateAsync({ key: settingsKey, value: JSON.stringify(next) });
  }, [aspects, settingsKey, upsert]);

  return { aspects, setAspect };
}
