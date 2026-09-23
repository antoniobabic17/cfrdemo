/**
 * useColumnCatalog — reads the admin-discovered column catalog for a table from
 * pmo_appsettings and merges it over the shipped TABLE_VIEW_REGISTRY. Also returns
 * admin-authored custom columns (computed formulas) and label overrides.
 *
 * Storage format: a catalog may be spread across multiple rows to stay under
 * the 4000-char pmo_value cap. The base row uses key
 * `columns.catalog.<tableKey>[.<source>]`; overflow rows use `…~1`, `~2`, …
 * The reassembleColumnCatalog helper joins them in order before parsing.
 *
 * Source scoping: for source-dependent tables (projects, programs) the `source`
 * argument scopes the catalog key so PSS and custom catalogs are independent.
 *
 * Custom columns: stored under `columns.custom.<tableKey>[.<source>]`, never
 * touched by re-pull. Source-scoped the same way as the catalog for
 * source-dependent tables (projects, programs). Returned as
 * `CustomColumnFormula[]` for DataTable to synthesize columns.
 *
 * Label overrides: stored under `columns.labels.<tableKey>` as
 * Record<colKey, label>. Applied by DataTable to rename headers org-wide.
 */
import { useMemo } from 'react';
import { useAppSettings } from './useAppSettings';
import {
  reassembleColumnCatalog, mergeColumns,
  customColumnsKey, columnLabelsKey,
  parseCustomColumns, parseColumnLabels,
  type DiscoveredColumn, type MergedColumn,
} from '../lib/tableViewRegistry';
import type { CustomColumnFormula } from '../lib/customColumns';

export interface ColumnCatalogResult {
  /** Shipped columns merged with discovered ones (isNew / isRemoved / isVirtual flagged). */
  columns: MergedColumn[];
  /** The raw discovered catalog (empty until the first re-pull). */
  catalog: DiscoveredColumn[];
  /** True once an admin has re-pulled at least once for this table. */
  hasCatalog: boolean;
  /** Admin-authored custom (computed) column formulas. Never emptied by re-pull. */
  customColumns: CustomColumnFormula[];
  /** Org-wide column label overrides: colKey → display label. Survive re-pull. */
  labelOverrides: Record<string, string>;
}

/**
 * @param tableKey  Registry table key (e.g. 'projects').
 * @param source    Active DataSource — pass for source-dependent tables
 *                  (projects, programs) to read the correct source-scoped
 *                  catalog. Omit for single-source tables.
 */
export function useColumnCatalog(tableKey: string, source?: string): ColumnCatalogResult {
  const { data: settings = [] } = useAppSettings();
  return useMemo(() => {
    if (!tableKey) {
      return {
        columns: mergeColumns('', []),
        catalog: [],
        hasCatalog: false,
        customColumns: [],
        labelOverrides: {},
      };
    }
    const catalog = reassembleColumnCatalog(settings, tableKey, source);
    const customRaw = settings.find((s) => s.pmo_key === customColumnsKey(tableKey, source))?.pmo_value ?? undefined;
    const labelsRaw = settings.find((s) => s.pmo_key === columnLabelsKey(tableKey))?.pmo_value ?? undefined;
    return {
      columns: mergeColumns(tableKey, catalog),
      catalog,
      hasCatalog: catalog.length > 0,
      customColumns: parseCustomColumns(customRaw),
      labelOverrides: parseColumnLabels(labelsRaw),
    };
  }, [tableKey, source, settings]);
}
