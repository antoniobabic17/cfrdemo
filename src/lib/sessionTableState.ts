/**
 * sessionTableState — per-session, in-memory table UI state.
 *
 * Product requirement: a table's sort, filters, and active view must PERSIST
 * across in-app (SPA) navigation — click into a record, click Back, and the grid
 * is exactly as the user left it — but RESET on a hard refresh / first load (back
 * to Default View, no filters, default sort).
 *
 * The mechanism that satisfies both halves is a MODULE-LEVEL store: these maps
 * live for the lifetime of the loaded JS bundle (so every route change sees the
 * same values) and are wiped when the page is hard-refreshed (the module is
 * re-evaluated from scratch). This is deliberately NOT localStorage or
 * sessionStorage — both of those survive a refresh, which is the opposite of
 * what we want here.
 *
 * Two independent stores:
 *   - filter/sort, keyed by the DataTable `storageKey` (e.g. 'cfr_project_list_view')
 *   - active view id,   keyed by the DataTable `tableKey`   (e.g. 'projects')
 */

/** Shape persisted per table for the filter/sort store. Mirrors DataTable's
 *  internal PersistedState so the two can be assigned without conversion. */
export interface SessionTableFilterSort {
  filters: Record<string, string | string[]>;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
}

const filterSortByKey = new Map<string, SessionTableFilterSort>();
const activeViewByTable = new Map<string, string>();

/** Read the session filter/sort for a table. Returns null when nothing is stored
 *  yet (fresh load) or when no key was provided. */
export function getSessionFilterSort(key: string | undefined): SessionTableFilterSort | null {
  if (!key) return null;
  return filterSortByKey.get(key) ?? null;
}

/** Store the session filter/sort for a table. No-op when no key was provided. */
export function setSessionFilterSort(key: string | undefined, state: SessionTableFilterSort): void {
  if (!key) return;
  filterSortByKey.set(key, state);
}

/** Read the session active view id for a table (undefined when unset). */
export function getSessionActiveView(tableKey: string | undefined): string | undefined {
  if (!tableKey) return undefined;
  return activeViewByTable.get(tableKey);
}

/** Store the session active view id for a table. No-op when no key was provided. */
export function setSessionActiveView(tableKey: string | undefined, viewId: string): void {
  if (!tableKey) return;
  activeViewByTable.set(tableKey, viewId);
}

/** Test-only: clear both stores (simulates a hard refresh). */
export function __resetSessionTableState(): void {
  filterSortByKey.clear();
  activeViewByTable.clear();
}
