import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Search, X, ArrowUp, ArrowDown, Filter, Database, RotateCcw, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportRowsToXlsx } from '../lib/exportTable';
import { getSessionFilterSort, setSessionFilterSort } from '../lib/sessionTableState';
import { useTableViews, useViewTeamOptions } from '../hooks/useTableViews';
import { useOrgDefaultView } from '../hooks/useOrgDefaultView';
import { useColumnCatalog } from '../hooks/useColumnCatalog';
import { useColumnLookupAspect } from '../hooks/useColumnLookupAspect';
import { useLookupAspectData, type LookupAspectColumn } from '../hooks/useLookupAspectData';
import { aspectNeedsFetch } from '../lib/lookupResolver';
import { useDataSource } from '../lib/taskSource';
import { SOURCE_DEPENDENT_TABLE_KEYS } from '../lib/columnDiscovery';
import { getAliasTargets } from '../lib/tableViewRegistry';
import { evaluateCustomColumn, customColumnRuntimeKey, type CustomColumnFormula } from '../lib/customColumns';
import { useCurrentUserTeams } from '../hooks/useCurrentUserTeams';
import { ViewSwitcher } from './common/ViewSwitcher';
import { Input } from './ui/input';
import { Button } from './ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';
import { cn } from '../lib/utils';
import { MultiSelectFilter } from './common/MultiSelectFilter';
import { toast } from '../hooks/useToast';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  /** 'single' (default, current behavior) or 'multi' (checkbox list, OR-match). */
  filterMode?: 'single' | 'multi';
  filterOptions?: { value: string; label: string }[];
  render?: (row: T, index: number) => ReactNode;
  getValue?: (row: T) => string | number | string[] | null | undefined;
  /**
   * Optional accessor used ONLY for Excel export, when the exported value
   * should differ from `getValue` (which drives sort/filter and often holds a
   * raw id/code). Use this to mirror exactly what the gallery cell displays —
   * e.g. a renamed team label or a "0%" progress string. When omitted, export
   * falls back to the Dataverse `@OData...FormattedValue` annotation for this
   * column key (if present), then `getValue`, then the raw field.
   */
  getExportValue?: (row: T) => string | number | null | undefined;
  /** Optional Tailwind classes applied to BOTH header and body cells of this column (width control). */
  className?: string;
  /** Shipped default pixel width. Used as the starting point for resize and the
   *  value a "reset column widths" action snaps back to. */
  defaultWidth?: number;
  /** Set false to forbid drag-resize on this column (e.g. a pinned action column). */
  resizable?: boolean;
  /** Hidden in the DEFAULT view, but still selectable in custom views. Lets a
   *  table ship a lean default while exposing every column to custom views. */
  defaultHidden?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  keyExtractor: (row: T) => string;
  searchPlaceholder?: string;
  searchFn?: (row: T, query: string) => boolean;
  onRowClick?: (row: T) => void;
  /** Called on mouse-enter — use for prefetch. */
  onRowHover?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  actionButton?: ReactNode;
  isLoading?: boolean;
  emptyMessage?: string;
  /**
   * Optional session key. When provided, the table persists
   * `{ filters, sortKey, sortDir }` so the user's view survives reload and
   * in a per-session in-memory store (lib/sessionTableState) so sort/filters
   * survive in-app NAVIGATION but RESET on a hard refresh. Search is NOT persisted.
   * Follow the `cfr_` prefix convention (e.g. `cfr_project_list_view`).
   */
  storageKey?: string;
  /**
   * Optional table identifier (e.g. 'projects'). When provided, users can
   * drag-resize columns and their widths persist per-user in Dataverse
   * (pmo_userview). Omit to disable resizing entirely.
   */
  tableKey?: string;
  /**
   * Optional initial sort. Applied when no persisted sortKey is present in
   * localStorage (persisted user preference always wins). The column key
   * must match one of the columns' `key` values. Direction defaults to
   * 'asc' if not provided.
   */
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  /** When provided, shows an Export button that downloads the full filtered+sorted
   *  result set (all matching rows, not just the visible page) as an .xlsx using the
   *  active view's columns. Value is the base file name, e.g. "Projects". */
  exportFileName?: string;
  /** When true, the initial sort ALWAYS comes from defaultSortKey/Dir, ignoring
   *  any persisted sort in localStorage. Filters still persist and users can
   *  re-sort within a session. Use for tables that must always land on a fixed
   *  order (e.g. Projects/Programs newest-ID-first). */
  forceDefaultSort?: boolean;
  /** Seed filter state on mount (e.g. arriving from a Dashboard KPI tile with
   *  ?health=... in the URL). OVERRIDES persisted localStorage filters for that
   *  visit so the landed view matches the tile's count; the Clear button then
   *  wipes it to an empty view. Multi-select column -> string[]; single -> string. */
  initialFilters?: Record<string, string | string[]>;
  /** Rows shown per page. Defaults to 100 when omitted. Override per table
   *  (e.g. Projects 50, Programs 20). */
  pageSize?: number;
  /** Fired whenever the set of VISIBLE column keys changes (view switch,
   *  org-default load, etc.). Lets a page lazily fetch data only needed by an
   *  opt-in column (e.g. Projects "Last Note"). No-op when omitted. */
  onActiveColumnsChange?: (visibleKeys: string[]) => void;
}

type FilterValue = string | string[];
type FilterMap = Record<string, FilterValue>;
type PersistedState = { filters: FilterMap; sortKey: string | null; sortDir: 'asc' | 'desc' };

function isFilterMap(v: unknown): v is FilterMap {
  if (!v || typeof v !== 'object') return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val === 'string') continue;
    if (Array.isArray(val) && val.every((x) => typeof x === 'string')) continue;
    return false;
  }
  return true;
}

function readPersisted(key: string | undefined): PersistedState | null {
  // Per-session, in-memory (lib/sessionTableState): survives SPA navigation,
  // resets on hard refresh. Validate the stored filters shape defensively.
  const stored = getSessionFilterSort(key);
  if (!stored) return null;
  const filters = isFilterMap(stored.filters) ? stored.filters : {};
  const sortKey = typeof stored.sortKey === 'string' ? stored.sortKey : null;
  const sortDir = stored.sortDir === 'desc' ? 'desc' : 'asc';
  return { filters, sortKey, sortDir };
}


/** Generic cell value for a synthetic (catalog-discovered) column with no
 *  hand-written renderer. Prefers the Dataverse FormattedValue annotation
 *  (human labels for lookups/choices/dates), falling back to the raw scalar.
 *  Objects/arrays are stringified defensively so a cell never renders [object]. */
function genericCellValue(row: Record<string, unknown>, key: string): string {
  const fv = row[`${key}@OData.Community.Display.V1.FormattedValue`];
  if (fv != null && fv !== '') return String(fv);
  const raw = row[key];
  if (raw == null) return '';
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw); } catch { return ''; }
  }
  return String(raw);
}

export function DataTable<T>({
  data,
  columns: baseColumns,
  keyExtractor,
  searchPlaceholder = 'Search...',
  searchFn,
  onRowClick,
  onRowHover,
  rowClassName,
  actionButton,
  isLoading,
  emptyMessage = 'No records found.',
  storageKey,
  tableKey,
  defaultSortKey,
  defaultSortDir,
  exportFileName,
  forceDefaultSort,
  initialFilters,
  pageSize,
  onActiveColumnsChange,
}: DataTableProps<T>) {
  const [persisted] = useState<PersistedState | null>(() => readPersisted(storageKey));

  // Column widths (Phase 1 of custom views): persisted per-user in Dataverse
  // when tableKey is provided. Live drag width is kept in local state and only
  // committed to the hook on pointer-up so we don't write on every mouse move.
  const {
    options: viewOptions, activeViewId, setActiveViewId, activeIsDefault, activeConfig,
    setWidth, resetWidths, hasCustomWidths, createView, updateView, deleteView, getViewColumns, getViewScope,
    getViewFiltersSort, getViewAspects, saveFiltersSort,
    userCustomColumns: userCustomColumnsRaw, saveUserCustomColumn,
  } = useTableViews(tableKey ?? '');
  // Defensive default: some callers/tests mock useTableViews without this field.
  const userCustomColumns = userCustomColumnsRaw ?? [];
  const savedWidths = useMemo(() => activeConfig.widths ?? {}, [activeConfig]);
  const orgDefault = useOrgDefaultView(tableKey ?? '');

  // Column catalog (admin re-pull). Any catalog key WITHOUT a hand-written
  // column gets a synthetic, generic-rendered column appended here so a
  // newly-discovered Dataverse column can appear in views without a code
  // deploy. Hand-written columns always win (curated renderers stay intact);
  // synthetic columns only fill gaps and ship defaultHidden so they never
  // change the shipped default view unless an admin/user opts them in.
  const dataSource = useDataSource();
  const catalogSource = tableKey && SOURCE_DEPENDENT_TABLE_KEYS.has(tableKey) ? dataSource : undefined;
  const { catalog, customColumns: customColFormulas, labelOverrides } = useColumnCatalog(tableKey ?? '', catalogSource);
  // Team-gated custom columns: a formula with teamId set renders only for
  // members of that team. Membership still loading (undefined) hides team-gated
  // columns until it resolves — fail-closed, never fail-open.
  const myTeams = useCurrentUserTeams();
  // Lookup aspect (org-wide): which part of a lookup to show (name/guid/email…).
  const { aspects: lookupAspects } = useColumnLookupAspect(tableKey ?? '');
  // Effective aspect precedence: the ACTIVE user view's override wins, then the
  // org-wide default, then 'name'. So a user can display email in their own view
  // while the org default stays name.
  const effectiveAspect = (colKey: string): string =>
    activeConfig.aspects?.[colKey] ?? lookupAspects[colKey] ?? 'name';
  // Lookup columns from the catalog whose chosen aspect needs a secondary fetch
  // (email/title/…). name+guid are free and never enter this list.
  const fetchAspectCols = useMemo<LookupAspectColumn[]>(() => (
    catalog
      .filter((c) => c.isLookup && aspectNeedsFetch(c.targets, effectiveAspect(c.key)))
      .map((c) => ({ colKey: c.key, targets: c.targets, aspect: effectiveAspect(c.key) }))
  ), [catalog, lookupAspects, activeConfig]);
  const lookupAspectData = useLookupAspectData(data as Array<Record<string, unknown>>, fetchAspectCols);

  const columns = useMemo<DataTableColumn<T>[]>(() => {
    // Step 1: apply org-wide label overrides to base columns.
    const withOverrides: DataTableColumn<T>[] = baseColumns.map((c) =>
      labelOverrides[c.key] ? { ...c, header: labelOverrides[c.key] } : c
    );
    const have = new Set(withOverrides.map((c) => c.key));

    // Step 2: append catalog-discovered columns (no hand-written renderer exists).
    // Also exclude any catalog column whose key is the known real backing-attribute
    // of a hand-written column under an alias key (e.g. pmo_actualfinishdate is
    // already represented as proj_actualfinishdate — showing both would produce
    // duplicate 'Finish Date' entries in the view editor and grid).
    const aliasTargets = tableKey ? getAliasTargets(tableKey) : new Set<string>();
    const synthetic: DataTableColumn<T>[] = catalog
      .filter((c) => !have.has(c.key) && !aliasTargets.has(c.key))
      .map((c) => {
        // Aspect-aware value for lookup columns:
        //   name  → FormattedValue (default; free)
        //   guid  → raw _<key>_value id (free)
        //   other → resolved via the secondary fetch map (email/title/…)
        const aspect = c.isLookup ? (effectiveAspect(c.key)) : 'name';
        const cellValue = (row: T): string => {
          const rec = row as Record<string, unknown>;
          if (c.isLookup) {
            if (aspect === 'guid') {
              const raw = rec[c.key];
              return raw == null ? '' : String(raw);
            }
            if (aspect !== 'name') {
              const id = String(rec[c.key] ?? '').replace(/[{}]/g, '').toLowerCase();
              const map = lookupAspectData[c.key];
              if (map && id) return map[id] ?? '';
              return ''; // still loading / unresolved
            }
          }
          return genericCellValue(rec, c.key);
        };
        return {
          key: c.key,
          header: labelOverrides[c.key] ?? c.header,
          sortable: true,
          defaultHidden: true,
          getValue: cellValue,
          render: (row: T) => {
            const v = cellValue(row);
            return <span className="text-sm text-muted-foreground">{v === '' ? '—' : v}</span>;
          },
        };
      });

    // Build label -> colKey index for the formula engine.
    // Sourced from both hand-written (withOverrides) and discovered (catalog) columns.
    const fieldIndex: Record<string, string> = {};
    for (const c of withOverrides) fieldIndex[c.header.toLowerCase()] = c.key;
    for (const c of catalog) fieldIndex[(labelOverrides[c.key] ?? c.header).toLowerCase()] = c.key;

    // Step 3: append admin-authored custom (computed) columns.
    // A formula with teamId set is only shown to members of that team.
    // Union admin org-wide custom columns (from pmo_appsettings) with the
    // user/team custom columns (from pmo_userview __customcols__ rows).
    // De-dupe by id (admin wins on collision — shouldn't happen, ids are uuids).
    const seenCustomIds = new Set<string>();
    const allCustomFormulas: CustomColumnFormula[] = [];
    for (const f of [...(customColFormulas as CustomColumnFormula[]), ...userCustomColumns]) {
      if (seenCustomIds.has(f.id)) continue;
      seenCustomIds.add(f.id);
      allCustomFormulas.push(f);
    }
    const customCols: DataTableColumn<T>[] = allCustomFormulas
      .filter((f) => !f.teamId || (myTeams != null && myTeams.has(f.teamId.toLowerCase())))
      .map((f) => ({
        key: customColumnRuntimeKey(f.id),
        header: labelOverrides[customColumnRuntimeKey(f.id)] ?? f.label,
        sortable: true,
        filterable: true,
        filterMode: 'multi' as const,
        // filterOptions left undefined — auto-derived from data below in filterableCols.
        getValue: (row: T) => evaluateCustomColumn(row as Record<string, unknown>, f, fieldIndex),
        render: (row: T) => {
          const v = evaluateCustomColumn(row as Record<string, unknown>, f, fieldIndex);
          const isError = v.startsWith('#ERROR') || v === '#DIV/0!';
          return (
            <span className={isError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} title={isError ? v : undefined}>
              {v === '' ? '\u2014' : (isError ? '#ERROR' : v)}
            </span>
          );
        },
      }));

    const result = [...withOverrides, ...synthetic, ...customCols];
    return result;
  }, [baseColumns, catalog, customColFormulas, userCustomColumns, labelOverrides, myTeams, tableKey, lookupAspects, lookupAspectData, activeConfig]);

  // Order columns to a config's column list; keeps pinned (resizable:false)
  // columns present even if the config omits them.
  const orderColumns = (cfgColumns: string[]) => {
    const wanted = new Set(cfgColumns);
    const chosen = columns.filter((c) => wanted.has(c.key) || c.resizable === false);
    chosen.sort((a, b) => {
      const ia = cfgColumns.indexOf(a.key); const ib = cfgColumns.indexOf(b.key);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return chosen.length ? chosen : columns;
  };

  // Visible columns for the active view.
  //   Default view: the admin's org-default columns/order if configured, else
  //   all columns minus defaultHidden (which stay selectable in custom views).
  //   Custom view: only its selected columns, in its order (+ pinned columns).
  // Column REORDER (drag a header to a new position). orderOverride holds the
  // user's dragged key order for the CURRENT view (null = follow the view's
  // saved order). dragKey/dragOverKey drive the drop indicator. Native HTML5
  // DnD (mirrors the task-board bucket drag); no dnd library in the repo.
  // The unsaved reorder is STAMPED with the view it belongs to, so switching
  // views discards it structurally: orderOverride reads null for any view other
  // than the one the drag happened in. The previous shape reset three useStates
  // from an effect keyed on activeViewId, which cost a second render pass on
  // every view switch (react-hooks/set-state-in-effect) and, for the render
  // between the switch and the effect, applied the OLD view's column order to
  // the NEW view.
  const [pendingOrder, setPendingOrder] = useState<{ viewId: string; order: string[] } | null>(null);
  const orderOverride = pendingOrder?.viewId === activeViewId ? pendingOrder.order : null;
  // dragKey/dragOverKey need no per-view reset: every drag terminates in onDrop
  // or onDragEnd and both clear the pair, and the view switcher cannot be
  // clicked while a header drag holds the pointer.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const visibleColumns = useMemo(() => {
    // Base order from the active view (custom config, org-default, or all).
    const base = (activeIsDefault || !activeConfig.columns)
      ? (orgDefault.columns && orgDefault.columns.length
          ? orderColumns(orgDefault.columns)
          : columns.filter((c) => !c.defaultHidden))
      : orderColumns(activeConfig.columns);
    // A live drag-reorder overrides the base order for this session. Reorder
    // ONLY the currently-visible base columns (never reintroduces hidden ones).
    // visibleColumns drives render, colgroup widths, AND Excel export, so the
    // export automatically follows the on-screen order.
    if (orderOverride) {
      const rank = new Map(orderOverride.map((k, i) => [k, i]));
      return [...base].sort((a, b) =>
        (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIsDefault, activeConfig, columns, orgDefault, orderOverride]);

  // Notify the parent of the active visible-column keys so it can lazily
  // fetch data only an opt-in column needs. Keyed on the joined key list so
  // it only fires when the set actually changes.
  const visibleKeyList = visibleColumns.map((c) => c.key).join(',');
  useEffect(() => {
    onActiveColumnsChange?.(visibleKeyList ? visibleKeyList.split(',') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKeyList]);

  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  // Natural widths measured from the first (auto-layout) paint, scoped to the
  // active view id. Once measured, EVERY column gets an explicit width so
  // table-fixed never redistributes space between columns — resizing one column
  // leaves all others untouched and the table simply grows wider (horizontal
  // scroll). Scoping to viewId means switching/creating a view re-measures
  // automatically without a setState-in-effect.
  const [measuredState, setMeasured] = useState<{ viewId: string; widths: Record<string, number> } | null>(null);
  const headerRowRef = useRef<HTMLTableRowElement | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startW: number; lastW: number } | null>(null);
  const resizingEnabled = !!tableKey;
  const viewTeamOptions = useViewTeamOptions(resizingEnabled);
  // Only honor measurements taken for the CURRENTLY active view; otherwise the
  // table is treated as un-measured (forces a fresh auto-layout + re-measure).
  const measured = measuredState && measuredState.viewId === activeViewId ? measuredState.widths : null;

  const orgWidths = useMemo(
    () => (activeIsDefault ? (orgDefault.widths ?? {}) : {}),
    [activeIsDefault, orgDefault],
  );
  const effectiveWidth = useCallback(
    (col: DataTableColumn<T>): number | undefined => {
      // Precedence: in-flight drag → user's saved width → admin org-default
      // width (Default view only) → shipped code width → measured natural width.
      if (col.key in liveWidths) return liveWidths[col.key];
      if (col.key in savedWidths) return savedWidths[col.key];
      if (col.key in orgWidths) return orgWidths[col.key];
      if (col.defaultWidth != null) return col.defaultWidth;
      return measured?.[col.key];
    },
    [liveWidths, savedWidths, orgWidths, measured],
  );

  // The column currently being dragged (null when idle). Drives both the
  // global pointer listeners and the body cursor override (in effects, so we
  // never mutate globals during render).
  const [resizingKey, setResizingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!resizingEnabled || !resizingKey) return;
    function onMove(e: PointerEvent) {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.max(60, r.startW + (e.clientX - r.startX));
      r.lastW = next;
      setLiveWidths((prev) => ({ ...prev, [r.key]: next }));
    }
    function onUp() {
      const r = resizeRef.current;
      resizeRef.current = null;
      setResizingKey(null);
      if (r && r.lastW != null) {
        // Persist, and KEEP the live width in place. We do not delete the live
        // override here — clearing it before savedWidths round-trips is what
        // made the column snap back to its old size on release.
        setWidth(r.key, r.lastW);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizingEnabled, resizingKey, setWidth]);

  // Body cursor / text-selection lock while dragging — in an effect so we don't
  // touch document during render (react-hooks/immutability).
  useEffect(() => {
    if (!resizingKey) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizingKey]);

  const startResize = useCallback((e: React.PointerEvent, col: DataTableColumn<T>) => {
    if (!resizingEnabled || col.resizable === false) return;
    e.preventDefault();
    e.stopPropagation();
    // Prefer the actual rendered header width as the drag baseline so the
    // column never jumps when the drag starts.
    const measuredNow = e.currentTarget.parentElement?.getBoundingClientRect().width;
    const startW = (col.key in liveWidths ? liveWidths[col.key] : savedWidths[col.key])
      ?? col.defaultWidth
      ?? measured?.[col.key]
      ?? measuredNow
      ?? 150;
    resizeRef.current = { key: col.key, startX: e.clientX, startW, lastW: startW };
    setResizingKey(col.key);
  }, [resizingEnabled, liveWidths, savedWidths, measured]);

  // Measure natural column widths ONCE (before any resize), so switching to
  // table-fixed keeps the auto-layout proportions instead of collapsing to
  // equal columns. Runs when resizing is enabled and we haven't measured yet.
  useEffect(() => {
    if (!resizingEnabled || measured) return;
    // Defer to AFTER the browser paints the CURRENT view's layout. Measuring
    // synchronously can read the outgoing view's transient widths right after a
    // view switch; a double rAF guarantees we read this view's own columns.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const row = headerRowRef.current;
        if (!row) return;
        const cells = Array.from(row.children) as HTMLElement[];
        if (cells.length !== visibleColumns.length) return;
        const next: Record<string, number> = {};
        let allPositive = true;
        visibleColumns.forEach((col, i) => {
          const w = Math.round(cells[i].getBoundingClientRect().width);
          if (w <= 0) allPositive = false;
          next[col.key] = w;
        });
        if (allPositive) setMeasured({ viewId: activeViewId, widths: next });
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [resizingEnabled, measured, visibleColumns, activeViewId]);

  // Switching views drops any in-progress live drag overrides; measurement
  // re-runs automatically because `measured` is scoped to the active view id.
  const handleSelectView = useCallback((id: string) => {
    // Clear the live drag overrides AND the transient natural-width measurement.
    // Clearing measuredState is essential: otherwise the re-measure effect can
    // read the OUTGOING view's still-painted (e.g. just-resized) column widths and
    // seed them as the new view's measured widths, leaking a custom-view width onto
    // Default. Cleared here → the new view re-measures from its own post-paint layout.
    setLiveWidths({});
    setMeasured(null);
    setActiveViewId(id);
    // Load saved filters + sort from the view's config.
    const { filters: savedFilters, sort: savedSort } = getViewFiltersSort(id);
    setFilters(savedFilters);
    if (savedSort) {
      setSortKey(savedSort.key);
      setSortDir(savedSort.dir);
    } else {
      setSortKey(defaultSortKey ?? null);
      setSortDir(defaultSortDir ?? 'asc');
    }
  }, [setActiveViewId, getViewFiltersSort, defaultSortKey, defaultSortDir]);

  // Reset column widths: clear the persisted widths AND the local live/measured
  // overrides, then force a fresh auto-layout re-measure. Without clearing the
  // local state, live drag widths (which effectiveWidth prefers) would keep
  // winning and the gallery wouldn't visibly change.
  const handleResetWidths = useCallback(() => {
    setLiveWidths({});
    setMeasured(null);
    resetWidths();
  }, [resetWidths]);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(
    // forceDefaultSort makes the fixed default win over any persisted sort.
    () => (forceDefaultSort ? (defaultSortKey ?? null) : (persisted?.sortKey ?? defaultSortKey ?? null)),
  );
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(
    () => (forceDefaultSort
      ? (defaultSortDir ?? 'asc')
      : (persisted?.sortDir ?? (defaultSortKey ? (defaultSortDir ?? 'asc') : 'asc'))),
  );
  const [filters, setFilters] = useState<FilterMap>(() => initialFilters ?? persisted?.filters ?? {});

  useEffect(() => {
    if (!storageKey) return;
    // Per-session, in-memory: kept across SPA navigation, wiped on hard refresh.
    setSessionFilterSort(storageKey, { filters, sortKey, sortDir });
  }, [storageKey, filters, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    let result = data;
    if (search && searchFn) {
      result = result.filter((row) => searchFn(row, search));
    }
    // Apply filters: for columns with filterOptions use exact/multi-select match;
    // for any other column with a saved filter value use substring (contains) match.
    // This covers both the built-in filterable columns and view-editor text filters
    // on columns that don't have predefined option lists.
    for (const col of columns) {
      const f = filters[col.key];
      if (!f) continue;
      const hasOptions = !!col.filterOptions?.length;
      if (Array.isArray(f)) {
        if (f.length === 0) continue;
        result = result.filter((row) => {
          const val = col.getValue ? col.getValue(row) : (row as Record<string, unknown>)[col.key];
          // If getValue returns string[], match ANY element (OR-match).
          // This supports multi-valued virtual columns like Tracking Labels.
          if (Array.isArray(val)) return val.some((v) => f.includes(String(v)));
          return f.includes(String(val ?? ''));
        });
      } else if (typeof f === 'string' && f && f !== '__all__') {
        result = result.filter((row) => {
          const val = String((col.getValue ? col.getValue(row) : (row as Record<string, unknown>)[col.key]) ?? '');
          // Exact match for option-based filters; substring for free-text filters.
          return hasOptions ? val === f : val.toLowerCase().includes(f.toLowerCase());
        });
      }
    }
    return result;
  }, [data, search, searchFn, columns, filters]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const valA = col.getValue ? col.getValue(a) : (a as Record<string, unknown>)[col.key];
      const valB = col.getValue ? col.getValue(b) : (b as Record<string, unknown>)[col.key];
      const cmp = String(valA ?? '').localeCompare(String(valB ?? ''), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  // Pagination -- pageSize rows per page (default 100). safePage clamps to the
  // valid range so filtering down never strands the user on an empty high page.
  const PAGE_SIZE = pageSize ?? 100;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  // Note: safePage clamps to the valid range, so shrinking the result set
  // (search/filter) can never strand the user on an out-of-range page.
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paged = useMemo(() => sorted.slice(pageStart, pageStart + PAGE_SIZE), [sorted, pageStart]);

  // Detect when filters/sort deviate from the view's saved defaults.
  // Only meaningful on a custom (non-default) view.
  const viewDefaultFilters = activeConfig.filters ?? {};
  const viewDefaultSort = activeConfig.sort ?? null;
  const filtersDeviateFromView = !activeIsDefault && (
    JSON.stringify(filters) !== JSON.stringify(viewDefaultFilters) ||
    sortKey !== (viewDefaultSort?.key ?? null) ||
    sortDir !== (viewDefaultSort?.dir ?? 'asc')
  );

  function revertToViewDefaults() {
    setFilters(viewDefaultFilters);
    setSortKey(viewDefaultSort?.key ?? defaultSortKey ?? null);
    setSortDir(viewDefaultSort?.dir ?? defaultSortDir ?? 'asc');
  }

  // Reorder: move draggedKey to just before targetKey within the current
  // visible order, and stash the result as orderOverride (session-local until
  // the user clicks Save view). No-op if same column or either key missing.
  const handleReorderDrop = useCallback((draggedKey: string, targetKey: string) => {
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;
    const current = visibleColumns.map((c) => c.key);
    const from = current.indexOf(draggedKey);
    const to = current.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(next.indexOf(targetKey), 0, draggedKey);
    setPendingOrder({ viewId: activeViewId, order: next });
  }, [visibleColumns, activeViewId]);

  // The current view's saved column order (for the dirty check). A custom
  // view stores its order in activeConfig.columns; fall back to visible keys.
  const savedOrder = activeConfig.columns ?? null;
  const orderIsDirty = !!orderOverride && (!savedOrder
    || orderOverride.join(',') !== orderColumns(savedOrder).map((c) => c.key).join(','));
  // Save view is offered ONLY for a custom (non-default) view with a dirty
  // reorder. Persists the full visible key order via updateView.
  const canSaveOrder = !activeIsDefault && orderIsDirty;
  const [savingView, setSavingView] = useState(false);
  const handleSaveView = useCallback(async () => {
    if (activeIsDefault || !orderOverride) return;
    const opt = viewOptions.find((o) => o.id === activeViewId);
    const { scope, teamId } = getViewScope(activeViewId);
    setSavingView(true);
    try {
      await updateView(activeViewId, opt?.name ?? 'View', orderOverride, scope, teamId);
      setPendingOrder(null); // saved order now flows from the view config
      toast.success('View saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save view');
    } finally {
      setSavingView(false);
    }
  }, [activeIsDefault, orderOverride, viewOptions, activeViewId, getViewScope, updateView]);

  // Save current filters + sort to the active custom view (explicit user action).
  // Only visible when filters/sort deviate from the view's saved defaults.
  const canSaveFilters = filtersDeviateFromView;
  const [savingFilters, setSavingFilters] = useState(false);
  const handleSaveFilters = useCallback(async () => {
    if (activeIsDefault) return;
    setSavingFilters(true);
    try {
      await saveFiltersSort(filters, sortKey, sortDir);
      toast.success('Filters and sort saved to view');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save filters');
    } finally {
      setSavingFilters(false);
    }
  }, [activeIsDefault, saveFiltersSort, filters, sortKey, sortDir]);

  // Build filter options for multi-mode columns that don't have static options.
  // Custom columns and any other filterable-multi column without pre-built options
  // derive their option list dynamically from the current dataset.
  const filterableCols = useMemo(() =>
    columns
      .filter((col) => col.filterable && (col.filterOptions || col.filterMode === 'multi'))
      .map((col) => {
        if (col.filterOptions || col.filterMode !== 'multi') return col;
        // Auto-derive unique non-empty values from the full (pre-filter) dataset.
        const unique = [...new Set(
          data
            .flatMap((row) => {
              const raw = col.getValue ? col.getValue(row) : (row as Record<string, unknown>)[col.key];
              // If getValue returns string[], expand each element as its own option.
              if (Array.isArray(raw)) return raw.map((v) => String(v ?? '')).filter((v) => v !== '');
              return [String(raw ?? '')].filter((v) => v !== '');
            })
        )].sort();
        return { ...col, filterOptions: unique.map((v) => ({ value: v, label: v })) };
      }),
  [columns, data]);

  const canExport = !!exportFileName;
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    // Export the active view's columns, excluding structural/action columns
    // (no header text, or explicitly non-resizable pinned columns like the
    // intake action cell).
    const exportColumns = visibleColumns
      .filter((c) => c.header.trim() !== '' && c.resizable !== false)
      .map((c) => ({
        header: c.header,
        getValue: (row: T): string | number | null | undefined => {
          const rec = row as Record<string, unknown>;
          // 1. Explicit export accessor wins (mirrors the gallery cell exactly).
          if (c.getExportValue) return c.getExportValue(row);
          // 2. Dataverse formatted display value for this field, if present.
          //    Lookups/optionsets/dates ship a "<key>@OData...FormattedValue"
          //    sibling holding the same text the gallery shows (name, not id).
          const formatted = rec[`${c.key}@OData.Community.Display.V1.FormattedValue`];
          if (typeof formatted === 'string' && formatted !== '') return formatted;
          // 3. Fall back to the sort/filter accessor, then the raw field.
          // A string[] getValue (e.g. multi-valued Tracking Labels) is joined
          // into a comma-separated string for the export cell.
          if (c.getValue) {
            const v = c.getValue(row);
            return Array.isArray(v) ? v.join(', ') : v;
          }
          return rec[c.key] as string | number | null | undefined;
        },
      }));
    const today = new Date().toISOString().slice(0, 10);
    setExporting(true);
    try {
      // `sorted` is the full filtered+sorted set BEFORE the 100-row page slice,
      // so every matching row exports even beyond the visible page.
      await exportRowsToXlsx({
        rows: sorted,
        columns: exportColumns,
        fileName: `${exportFileName ?? 'Export'} ${today}.xlsx`,
        sheetName: exportFileName ?? 'Export',
      });
    } finally {
      setExporting(false);
    }
  }, [visibleColumns, sorted, exportFileName]);

  return (
    <div className="space-y-3">
      {/* Toolbar — always two rows for a consistent height across views.
          Row 1: view controls (left) + page action/count (right).
          Row 2: search + filters (+ clear). */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2">
        {/* Row 1 — view dropdown / save view / export (left); actionButton
            (right). Rendered only when it has content so grids without view
            controls / export / an action button don't show an empty bar. */}
        {(resizingEnabled || canExport || actionButton) && (
        <div className="flex flex-wrap items-center gap-2">
          {resizingEnabled && (
            <ViewSwitcher
              options={viewOptions}
              activeViewId={activeViewId}
              onSelect={handleSelectView}
              columns={columns
                .filter((c) => c.header.trim() !== '')
                .map((c) => {
                  const cat = catalog.find((cc) => cc.key === c.key);
                  return {
                    key: c.key,
                    header: c.header,
                    locked: c.resizable === false,
                    filterable: c.filterable,
                    filterMode: c.filterMode,
                    filterOptions: filterableCols.find((fc) => fc.key === c.key)?.filterOptions,
                    sortable: c.sortable,
                    isLookup: cat?.isLookup,
                    targets: cat?.targets,
                  };
                })}
              teamOptions={viewTeamOptions}
              onCreateView={createView}
              onUpdateView={updateView}
              onDeleteView={deleteView}
              getViewColumns={getViewColumns}
              getViewScope={getViewScope}
              getViewFiltersSort={getViewFiltersSort}
              getViewAspects={getViewAspects}
              currentFilters={filters}
              currentSort={sortKey ? { key: sortKey, dir: sortDir } : null}
              onCreateCustomColumn={saveUserCustomColumn}
            />
          )}
          {canSaveOrder && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSaveView}
              disabled={savingView}
              className="h-8 text-xs gap-1.5"
              title="Save the new column order to this view"
            >
              {savingView ? 'Saving…' : 'Save view'}
            </Button>
          )}
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              className="h-8 text-xs gap-1.5"
              title="Export the current filtered rows to Excel"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          )}
          {canSaveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveFilters}
              disabled={savingFilters}
              className="h-8 text-xs gap-1.5"
              title="Save current filters and sort to this view"
            >
              {savingFilters ? 'Saving…' : 'Save Filters To View'}
            </Button>
          )}
          {filtersDeviateFromView && (
            <Button
              variant="outline"
              size="sm"
              onClick={revertToViewDefaults}
              className="h-8 text-xs gap-1.5 border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:border-rose-400 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
              title="Revert to this view's saved filters and sort"
            >
              <X className="h-3.5 w-3.5" />
              Clear Filters &amp; Sorting
            </Button>
          )}
          {resizingEnabled && hasCustomWidths && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetWidths}
              className="h-8 text-xs text-muted-foreground hover:text-foreground px-2"
              title="Reset all column widths to their defaults"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset column widths
            </Button>
          )}
          {/* Page action + count (e.g. Submit Request / N total) — right-aligned. */}
          {actionButton && <div className="ml-auto flex items-center gap-2">{actionButton}</div>}
        </div>
        )}

        {/* Row 2 — search + filter dropdowns + clear */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm bg-muted/50 border-border/60 focus-visible:ring-1"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filter dropdowns */}
          {filterableCols.map((col) => {
            const mode = col.filterMode ?? 'single';
            if (mode === 'multi') {
              const selected = Array.isArray(filters[col.key]) ? (filters[col.key] as string[]) : [];
              return (
                <MultiSelectFilter
                  key={col.key}
                  header={col.header}
                  options={col.filterOptions!}
                  value={selected}
                  onChange={(next) => setFilters((prev) => ({ ...prev, [col.key]: next }))}
                />
              );
            }
            const single = typeof filters[col.key] === 'string' ? (filters[col.key] as string) : '__all__';
            return (
              <Select
                key={col.key}
                value={single}
                onValueChange={(val) => setFilters((prev) => ({ ...prev, [col.key]: val }))}
              >
                <SelectTrigger className="w-[140px] h-8 text-xs bg-muted/50 border-border/60 text-foreground gap-1.5">
                  <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All {col.header}</SelectItem>
                  {col.filterOptions!.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}


        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Loading records...</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <Database className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">No records found</p>
              <p className="text-xs text-muted-foreground mt-0.5">{emptyMessage}</p>
            </div>
          </div>
        ) : (
          <Table className={cn(resizingEnabled && measured && 'table-fixed w-max min-w-full')}>
            {resizingEnabled && measured && (
              <colgroup>
                {visibleColumns.map((col) => {
                  const w = effectiveWidth(col);
                  return <col key={col.key} style={w ? { width: `${w}px` } : undefined} />;
                })}
              </colgroup>
            )}
            <TableHeader>
              <TableRow ref={headerRowRef} className="hover:bg-transparent border-b border-border bg-muted/20">
                {visibleColumns.map((col) => {
                  const canResize = resizingEnabled && col.resizable !== false;
                  // Reorderable = same gate as resize (view-enabled grid, not a
                  // pinned column). Native HTML5 DnD; dragstart is distinct from
                  // click so sort-on-click still works.
                  const canReorder = resizingEnabled && col.resizable !== false;
                  return (
                  <TableHead
                    key={col.key}
                    draggable={canReorder}
                    onDragStart={canReorder ? (e) => {
                      // Don't start a reorder while resizing from the separator.
                      if (resizingKey) { e.preventDefault(); return; }
                      setDragKey(col.key);
                      e.dataTransfer.setData('application/x-col-key', col.key);
                      e.dataTransfer.effectAllowed = 'move';
                    } : undefined}
                    onDragOver={canReorder && dragKey && dragKey !== col.key ? (e) => {
                      if (e.dataTransfer.types.includes('application/x-col-key')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverKey !== col.key) setDragOverKey(col.key);
                      }
                    } : undefined}
                    onDrop={canReorder ? (e) => {
                      e.preventDefault();
                      const dragged = e.dataTransfer.getData('application/x-col-key');
                      handleReorderDrop(dragged, col.key);
                      setDragKey(null); setDragOverKey(null);
                    } : undefined}
                    onDragEnd={canReorder ? () => { setDragKey(null); setDragOverKey(null); } : undefined}
                    className={cn(
                      'relative h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap select-none',
                      col.sortable && 'cursor-pointer hover:text-foreground transition-colors',
                      dragKey === col.key && 'opacity-50',
                      dragOverKey === col.key && 'border-l-2 border-l-primary',
                      col.className
                    )}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  >
                    <span className="flex items-center gap-1.5 overflow-hidden">
                      <span className="truncate">{col.header}</span>
                      {col.sortable && (
                        <span className="inline-flex flex-col gap-px opacity-40 shrink-0">
                          {sortKey === col.key ? (
                            sortDir === 'asc' ? (
                              <ArrowUp className="h-3 w-3 opacity-100 text-primary" />
                            ) : (
                              <ArrowDown className="h-3 w-3 opacity-100 text-primary" />
                            )
                          ) : (
                            <ArrowUp className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </span>
                    {canResize && (
                      // Drag handle on the column's right border. Excel-style:
                      // hover shows a col-resize cursor; drag resizes + persists.
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onPointerDown={(e) => startResize(e, col)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-primary/40 active:bg-primary/60"
                      />
                    )}
                  </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((row, i) => (
                <tr
                  key={keyExtractor(row)}
                  // Plain <tr> (no per-row entry animation): the old motion.tr
                  // staggered each row in with a transform, which added paint
                  // cost on every re-render AND swallowed clicks landing on a
                  // still-animating row (the "click did nothing" + variable
                  // click-to-navigate lag). A static row clicks instantly.
                  className={cn(
                    'border-b border-border/60 transition-colors last:border-b-0 group',
                    onRowClick &&
                      'cursor-pointer hover:bg-primary/5 hover:border-border active:bg-primary/10',
                    rowClassName?.(row)
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                >
                  {visibleColumns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn('px-4 py-3 align-middle text-sm', col.className)}
                    >
                      {col.render
                        ? col.render(row, i)
                        : String((row as Record<string, unknown>)[col.key] ?? '—')}
                    </TableCell>
                  ))}
                </tr>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer + pager (100 rows/page) */}
      {!isLoading && sorted.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            Showing <span className="text-foreground font-medium">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, sorted.length)}</span> of{' '}
            <span className="text-foreground font-medium">{sorted.length}</span>
            {sorted.length !== data.length && <span className="text-muted-foreground/70"> (filtered from {data.length})</span>}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-1.5 text-xs">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground whitespace-nowrap">Page</span>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={safePage}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setPage(Math.min(pageCount, Math.max(1, Math.floor(n))));
                }}
                className="h-7 w-12 rounded border border-border bg-background px-1 text-center tabular-nums"
                aria-label="Page number"
              />
              <span className="text-muted-foreground whitespace-nowrap">of {pageCount}</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
