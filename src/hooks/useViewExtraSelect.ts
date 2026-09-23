/**
 * useViewExtraSelect — turn a DataTable's active visible-column keys into a
 * SAFE `extraSelect` list for a list API's dynamic $select.
 *
 * Why this exists: a view can include columns that a list API's curated base
 * $select doesn't fetch (notably admin re-pulled / catalog-discovered columns),
 * so their cells render empty. Widening $select with the visible keys fixes
 * that — but we must never put an INVALID key into $select or the whole query
 * 400s / truncates (0x80060888). Two classes of key are unsafe:
 *   - virtual / app-computed columns (lastNote, _projectCount, label columns) —
 *     no backing Dataverse attribute.
 *   - custom (formula) columns — client-side computed.
 *   - FormattedValue annotation keys — never valid in $select.
 *
 * So we intersect the active keys with the table's known real attributes: the
 * merged catalog (shipped + discovered) MINUS virtual columns. Custom formula
 * columns aren't in the merged list at all, so they're excluded implicitly.
 * Keys not in that set are dropped (a hand-written column backed by a real
 * attribute already in the base select is harmless to drop — it's already
 * fetched). The API layer's dv.boundedSelect then unions + caps the result.
 */
import { useMemo } from 'react';
import { useColumnCatalog } from './useColumnCatalog';

export function useViewExtraSelect(
  tableKey: string,
  activeColumnKeys: string[],
  source?: string,
): string[] {
  const { catalog } = useColumnCatalog(tableKey, source);
  return useMemo(() => {
    // Real, queryable attribute keys for this table: merged catalog columns that
    // are not virtual, not custom, not a FormattedValue annotation.
    // mergeColumns returns only shipped + discovered columns (never custom
    // formula columns), so we just exclude virtual + annotation keys here.
    const valid = new Set(
      catalog
        .filter((c) => !c.key.includes('@OData'))
        .map((c) => c.key),
    );
    const out = activeColumnKeys.filter((k) => valid.has(k));
    // Stable order so the react-query key derived from this doesn't churn.
    out.sort();
    return out;
  }, [catalog, activeColumnKeys]);
}
