/**
 * useLookupAspectData — for the lookup columns in the active view whose chosen
 * aspect needs a secondary fetch (email / job title / other target attribute),
 * collect the distinct related-record ids from the current rows and resolve the
 * values via lookupResolver. Returns colKey -> (id -> value) for the renderer.
 *
 * Name and GUID aspects are FREE (from the primary list query) and never reach
 * here — only 'fetch' aspects do. Keyed on table + each column's aspect + the
 * id set, so it refetches only when those change.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { resolveLookupAspects, aspectNeedsFetch, type ResolveRequest } from '../lib/lookupResolver';

export interface LookupAspectColumn {
  colKey: string;
  targets: string[] | undefined;
  aspect: string;
}

/**
 * @param rows       The currently-loaded list rows (any record shape).
 * @param lookupCols The active lookup columns + their chosen aspect.
 * @returns map colKey -> (relatedId(lowercased) -> resolved display value).
 */
export function useLookupAspectData(
  rows: Array<Record<string, unknown>>,
  lookupCols: LookupAspectColumn[],
): Record<string, Record<string, string>> {
  // Build the fetch requests: only aspects that need a secondary fetch, with the
  // distinct ids collected from the rows for that column.
  const requests = useMemo<ResolveRequest[]>(() => {
    const reqs: ResolveRequest[] = [];
    for (const lc of lookupCols) {
      if (!aspectNeedsFetch(lc.targets, lc.aspect)) continue;
      const ids = new Set<string>();
      for (const row of rows) {
        const raw = row[lc.colKey];
        if (typeof raw === 'string' && raw) ids.add(raw.replace(/[{}]/g, '').toLowerCase());
      }
      if (ids.size > 0) {
        reqs.push({ colKey: lc.colKey, targets: lc.targets, aspect: lc.aspect, ids: [...ids] });
      }
    }
    return reqs;
  }, [rows, lookupCols]);

  // Stable query key from the requests (col + aspect + sorted id set).
  const queryKey = useMemo(
    () => ['lookupAspect', requests.map((r) => `${r.colKey}:${r.aspect}:${[...r.ids].sort().join(',')}`).sort()],
    [requests],
  );

  const { data } = useQuery({
    queryKey,
    queryFn: () => resolveLookupAspects(requests),
    enabled: requests.length > 0,
    staleTime: 60 * 1000,
  });

  return data ?? {};
}
