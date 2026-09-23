/**
 * useColumnLabels — read and write org-wide column label overrides for a table.
 *
 * Overrides are stored in pmo_appsettings under `columns.labels.<tableKey>` as
 * a JSON Record<colKey, label>. They are keyed by internal column key, so a
 * metadata re-pull (which only writes `columns.catalog.*`) can never clobber them.
 *
 * Applied by DataTable after assembling the full column list, so renamed headers
 * appear in the Default view, all custom views, and Excel export headers.
 */
import { useCallback } from 'react';
import { useAppSettings, useUpsertSetting } from './useAppSettings';
import { columnLabelsKey, parseColumnLabels } from '../lib/tableViewRegistry';

export interface UseColumnLabelsResult {
  /** Current label overrides: colKey → display label. */
  overrides: Record<string, string>;
  /** Upsert a single label override (key → newLabel). Pass '' to clear a key. */
  setLabel: (colKey: string, newLabel: string) => Promise<void>;
}

export function useColumnLabels(tableKey: string): UseColumnLabelsResult {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();

  const settingsKey = columnLabelsKey(tableKey);
  const raw = settings.find((s) => s.pmo_key === settingsKey)?.pmo_value ?? undefined;
  const overrides = parseColumnLabels(raw);

  const setLabel = useCallback(async (colKey: string, newLabel: string) => {
    const next = { ...overrides };
    if (newLabel.trim() === '') {
      delete next[colKey];
    } else {
      next[colKey] = newLabel.trim();
    }
    await upsert.mutateAsync({ key: settingsKey, value: JSON.stringify(next) });
  }, [overrides, settingsKey, upsert]);

  return { overrides, setLabel };
}
