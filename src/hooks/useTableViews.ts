/**
 * useTableViews — Phase 2 of custom table views.
 *
 * Superset of the Phase-1 width persistence. Per (user, tableKey) it manages:
 *   - the reserved `__default__` row: the user's saved column WIDTHS for the
 *     locked Default view (columns + order are fixed by code);
 *   - named CUSTOM views: each picks which columns show, their order, and their
 *     widths, stored as one pmo_userview row.
 *
 * The active view is session-local state (NOT persisted) so every table always
 * opens on the Default View on a fresh session, per product decision.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listUserViews, createUserView, updateUserViewConfig, updateUserView, deleteUserView,
} from '../api/userViews.api';
import { DEFAULT_VIEW_NAME, CUSTOM_COLS_VIEW_NAME, type UserView, type UserViewConfig, type ViewScope } from '../models/userView.model';
import type { CustomColumnFormula } from '../lib/customColumns';
import { getSessionActiveView, setSessionActiveView } from '../lib/sessionTableState';
import { useCurrentUserId } from './useCurrentUserId';
import { useCurrentUserTeamsWithNames } from './useCurrentUserTeams';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { useAllPmoTeams } from './useAllPmoTeams';

const QK = ['userViews'] as const;

/** Sentinel id for the built-in Default view (not a real Dataverse row). */
export const DEFAULT_VIEW_ID = '__default_view__';

export interface TableViewOption {
  id: string;            // DEFAULT_VIEW_ID or a pmo_userviewid
  name: string;          // 'Default View' or the custom name
  isDefault: boolean;
}

function parseConfig(v?: string | null): UserViewConfig {
  if (!v) return {};
  try {
    const p = JSON.parse(v) as UserViewConfig;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export interface UseTableViewsResult {
  /** Dropdown options: Default View first, then the user's custom views. */
  options: TableViewOption[];
  /** Currently-active view id (session-local; always starts on Default). */
  activeViewId: string;
  setActiveViewId: (id: string) => void;
  activeIsDefault: boolean;
  /** Parsed config of the active view ({} for Default until widths are saved). */
  activeConfig: UserViewConfig;

  /** Persist a single column width on whichever view is active. */
  setWidth: (columnKey: string, width: number) => void;
  /** Clear widths on the active view (Default → shipped defaults). */
  resetWidths: () => void;
  hasCustomWidths: boolean;

  /** Create a custom view (columns + sharing scope) and switch to it. */
  createView: (name: string, columns: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => Promise<void>;
  /** Update an existing custom view's name, columns, sharing scope, and optional pre-set filters/sort. */
  updateView: (id: string, name: string, columns: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  /** The selected column keys for a custom view (for prefilling the editor). */
  getViewColumns: (id: string) => string[];
  /** The saved scope + team of a custom view (for prefilling the editor). */
  getViewScope: (id: string) => { scope: ViewScope; teamId: string | null };
  /** The saved filters + sort for a custom view (for prefilling the editor). */
  getViewFiltersSort: (id: string) => { filters: Record<string, string | string[]>; sort: { key: string; dir: 'asc' | 'desc' } | null };
  getViewAspects: (id: string) => Record<string, string>;
  /**
   * Persist the current filter+sort state to the active custom view.
   * No-op on the Default view. Called only when the user explicitly clicks
   * "Save filters to view".
   */
  saveFiltersSort: (filters: Record<string, string | string[]>, sortKey: string | null, sortDir: 'asc' | 'desc') => Promise<void>;

  /** User/team-authored custom columns visible to this user (personal + team). */
  userCustomColumns: CustomColumnFormula[];
  /** Create/update a user or team custom column (same perms model as views). */
  saveUserCustomColumn: (formula: CustomColumnFormula, scope: 'personal' | 'team', teamId: string | null) => Promise<void>;
  /** Remove a user/team custom column by id. */
  deleteUserCustomColumn: (id: string) => Promise<void>;
  isReady: boolean;
}

export function useTableViews(tableKey: string): UseTableViewsResult {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  const teamSet = useCurrentUserTeams();
  const teamIds = useMemo(() => (teamSet ? [...teamSet] : []), [teamSet]);
  const teamKey = teamIds.join(',');

  const { data: views = [], isLoading } = useQuery({
    queryKey: [...QK, userId ?? null, teamKey],
    enabled: !!userId,
    queryFn: () => listUserViews(userId as string, teamIds),
    staleTime: 5 * 60 * 1000,
  });

  const forTable = useMemo(
    () => views.filter((v) => v.pmo_tablekey === tableKey),
    [views, tableKey],
  );
  const defaultRow = useMemo(
    () => forTable.find((v) => v.pmo_name === DEFAULT_VIEW_NAME),
    [forTable],
  );
  const customViews = useMemo(
    () => forTable.filter((v) => v.pmo_name !== DEFAULT_VIEW_NAME && v.pmo_name !== CUSTOM_COLS_VIEW_NAME),
    [forTable],
  );

  // Reserved rows that hold user/team-authored custom COLUMNS (not views).
  // Personal: pmo_scope !== 'team' (owned by me). Team: pmo_scope === 'team'
  // (visible to my teams — listUserViews already filtered to my teams).
  const customColRows = useMemo(
    () => forTable.filter((v) => v.pmo_name === CUSTOM_COLS_VIEW_NAME),
    [forTable],
  );

  // Flatten every visible reserved row's config.customColumns into one list,
  // tagging each with the row id + scope so edit/delete can find its home row.
  const userCustomColumns = useMemo<CustomColumnFormula[]>(() => {
    const out: CustomColumnFormula[] = [];
    for (const row of customColRows) {
      const cfg = parseConfig(row.pmo_config);
      for (const f of cfg.customColumns ?? []) {
        // Stamp teamId from the row so data-table's team-visibility filter and
        // the DataTable render treat team columns correctly.
        const teamId = row.pmo_scope === 'team' ? (row['_pmo_team_value'] ?? undefined) : undefined;
        out.push({ ...f, teamId: teamId ?? f.teamId });
      }
    }
    return out;
  }, [customColRows]);

  const options = useMemo<TableViewOption[]>(() => [
    { id: DEFAULT_VIEW_ID, name: 'Default View', isDefault: true },
    ...customViews.map((v) => ({ id: v.pmo_userviewid, name: v.pmo_name, isDefault: false })),
  ], [customViews]);

  // Active view is per-SESSION (lib/sessionTableState, in-memory): it persists
  // across in-app navigation but resets to Default on a hard refresh (first load
  // finds nothing stored -> Default). If the active custom view is deleted, we
  // fall back to Default. Every set also writes the session store so a later
  // remount (navigating back to this table) restores the user's choice.
  const [activeViewId, setActiveViewIdInternal] = useState<string>(
    () => getSessionActiveView(tableKey) ?? DEFAULT_VIEW_ID,
  );
  const setActiveViewIdRaw = useCallback((id: string) => {
    setSessionActiveView(tableKey, id);
    setActiveViewIdInternal(id);
  }, [tableKey]);
  const activeExists = activeViewId === DEFAULT_VIEW_ID || customViews.some((v) => v.pmo_userviewid === activeViewId);
  const effectiveActiveId = activeExists ? activeViewId : DEFAULT_VIEW_ID;
  const activeIsDefault = effectiveActiveId === DEFAULT_VIEW_ID;

  const activeRow: UserView | undefined = activeIsDefault
    ? defaultRow
    : customViews.find((v) => v.pmo_userviewid === effectiveActiveId);
  const activeConfig = useMemo(() => parseConfig(activeRow?.pmo_config), [activeRow]);

  const persistConfig = useCallback(
    async (row: UserView | undefined, name: string, config: UserViewConfig) => {
      if (!userId) return;
      const json = JSON.stringify(config);
      if (row) {
        await updateUserViewConfig(row.pmo_userviewid, json);
      } else {
        await createUserView({
          pmo_name: name,
          pmo_tablekey: tableKey,
          pmo_config: json,
          'pmo_User@odata.bind': `/systemusers(${userId.replace(/[{}]/g, '')})`,
        });
      }
      await qc.invalidateQueries({ queryKey: QK });
    },
    [userId, tableKey, qc],
  );

  const setWidth = useCallback(
    (columnKey: string, width: number) => {
      const nextWidths = { ...(activeConfig.widths ?? {}), [columnKey]: Math.round(width) };
      const nextConfig: UserViewConfig = { ...activeConfig, widths: nextWidths };
      const targetName = activeIsDefault ? DEFAULT_VIEW_NAME : (activeRow?.pmo_name ?? DEFAULT_VIEW_NAME);
      // Optimistic cache patch so the header holds its width immediately.
      if (activeRow) {
        qc.setQueriesData<UserView[]>({ queryKey: QK }, (old) =>
          old?.map((v) => v.pmo_userviewid === activeRow.pmo_userviewid
            ? { ...v, pmo_config: JSON.stringify(nextConfig) } : v),
        );
      }
      void persistConfig(activeRow, targetName, nextConfig).catch(() => qc.invalidateQueries({ queryKey: QK }));
    },
    [activeConfig, activeRow, activeIsDefault, persistConfig, qc],
  );

  const resetWidths = useCallback(() => {
    if (!activeRow) return;
    const nextConfig: UserViewConfig = { ...parseConfig(activeRow.pmo_config), widths: {} };
    if (activeIsDefault) {
      // Default view has no columns config → deleting the row is the cleanest reset.
      qc.setQueriesData<UserView[]>({ queryKey: QK }, (old) => old?.filter((v) => v.pmo_userviewid !== activeRow.pmo_userviewid));
      void deleteUserView(activeRow.pmo_userviewid).then(() => qc.invalidateQueries({ queryKey: QK })).catch(() => qc.invalidateQueries({ queryKey: QK }));
    } else {
      void persistConfig(activeRow, activeRow.pmo_name, nextConfig).catch(() => qc.invalidateQueries({ queryKey: QK }));
    }
  }, [activeRow, activeIsDefault, persistConfig, qc]);

  const createView = useCallback(
    async (name: string, columns: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => {
      if (!userId) return;
      const created = await createUserView({
        pmo_name: name.trim() || 'Untitled view',
        pmo_tablekey: tableKey,
        pmo_config: JSON.stringify({ columns, widths: {}, filters, sort, aspects } satisfies UserViewConfig),
        pmo_scope: scope,
        'pmo_User@odata.bind': `/systemusers(${userId.replace(/[{}]/g, '')})`,
        ...(scope === 'team' && teamId
          ? { 'pmo_Team@odata.bind': `/teams(${teamId.replace(/[{}]/g, '')})` }
          : {}),
      });
      await qc.invalidateQueries({ queryKey: QK });
      setActiveViewIdRaw(created.pmo_userviewid);
    },
    [userId, tableKey, qc, setActiveViewIdRaw],
  );

  const updateView = useCallback(
    async (id: string, name: string, cols: string[], scope: ViewScope, teamId?: string | null, filters?: Record<string, string | string[]>, sort?: { key: string; dir: 'asc' | 'desc' } | null, aspects?: Record<string, string>) => {
      // Preserve any saved widths for columns still present in the new set.
      const row = customViews.find((v) => v.pmo_userviewid === id);
      const prev = parseConfig(row?.pmo_config);
      const keep = new Set(cols);
      const widths = Object.fromEntries(
        Object.entries(prev.widths ?? {}).filter(([k]) => keep.has(k)),
      );
      const config: UserViewConfig = {
        columns: cols,
        widths,
        filters: filters ?? prev.filters,
        sort: sort !== undefined ? sort : prev.sort,
        aspects: aspects !== undefined ? aspects : prev.aspects,
      };
      // Clear the team lookup when switching to personal.
      await updateUserView(
        id, name.trim() || 'Untitled view', JSON.stringify(config),
        scope, scope === 'team' ? (teamId ?? null) : null,
      );
      await qc.invalidateQueries({ queryKey: QK });
    },
    [customViews, qc],
  );

  const getViewColumns = useCallback(
    (id: string): string[] => {
      const row = customViews.find((v) => v.pmo_userviewid === id);
      return parseConfig(row?.pmo_config).columns ?? [];
    },
    [customViews],
  );

  const getViewFiltersSort = useCallback(
    (id: string) => {
      const row = customViews.find((v) => v.pmo_userviewid === id);
      const cfg = parseConfig(row?.pmo_config);
      return {
        filters: cfg.filters ?? {},
        sort: cfg.sort ?? null,
      };
    },
    [customViews],
  );

  const getViewAspects = useCallback(
    (id: string): Record<string, string> => {
      const row = customViews.find((v) => v.pmo_userviewid === id);
      return parseConfig(row?.pmo_config).aspects ?? {};
    },
    [customViews],
  );

  const saveFiltersSort = useCallback(
    async (filters: Record<string, string | string[]>, sortKey: string | null, sortDir: 'asc' | 'desc') => {
      if (activeIsDefault || !activeRow) return;
      const prev = parseConfig(activeRow.pmo_config);
      const sort = sortKey ? { key: sortKey, dir: sortDir } : null;
      const nextConfig: UserViewConfig = { ...prev, filters, sort };
      qc.setQueriesData<UserView[]>({ queryKey: QK }, (old) =>
        old?.map((v) => v.pmo_userviewid === activeRow.pmo_userviewid
          ? { ...v, pmo_config: JSON.stringify(nextConfig) } : v),
      );
      await persistConfig(activeRow, activeRow.pmo_name, nextConfig).catch(() => qc.invalidateQueries({ queryKey: QK }));
    },
    [activeIsDefault, activeRow, persistConfig, qc],
  );

  const getViewScope = useCallback(
    (id: string): { scope: ViewScope; teamId: string | null } => {
      const row = customViews.find((v) => v.pmo_userviewid === id);
      const scope: ViewScope = row?.pmo_scope === 'team' ? 'team' : 'personal';
      return { scope, teamId: row?.['_pmo_team_value'] ?? null };
    },
    [customViews],
  );

  const deleteView = useCallback(
    async (id: string) => {
      if (effectiveActiveId === id) setActiveViewIdRaw(DEFAULT_VIEW_ID);
      qc.setQueriesData<UserView[]>({ queryKey: QK }, (old) => old?.filter((v) => v.pmo_userviewid !== id));
      await deleteUserView(id);
      await qc.invalidateQueries({ queryKey: QK });
    },
    [effectiveActiveId, qc, setActiveViewIdRaw],
  );

  // ── User/team custom-column authoring (same perms model as views) ──────────
  const saveUserCustomColumn = useCallback(
    async (formula: CustomColumnFormula, scope: 'personal' | 'team', teamId: string | null) => {
      if (!userId) return;
      // Find the existing reserved row for this scope (+ team), else create it.
      const existing = customColRows.find((r) =>
        scope === 'team'
          ? (r.pmo_scope === 'team' && (r['_pmo_team_value'] ?? '').toLowerCase() === (teamId ?? '').toLowerCase())
          : (r.pmo_scope !== 'team' && (r['_pmo_user_value'] ?? '').toLowerCase() === userId.replace(/[{}]/g, '').toLowerCase()),
      );
      if (existing) {
        const cfg = parseConfig(existing.pmo_config);
        const list = cfg.customColumns ?? [];
        const idx = list.findIndex((f) => f.id === formula.id);
        const nextList = idx >= 0
          ? list.map((f) => (f.id === formula.id ? formula : f))
          : [...list, formula];
        await updateUserViewConfig(existing.pmo_userviewid, JSON.stringify({ ...cfg, customColumns: nextList }));
      } else {
        await createUserView({
          pmo_name: CUSTOM_COLS_VIEW_NAME,
          pmo_tablekey: tableKey,
          pmo_config: JSON.stringify({ customColumns: [formula] } satisfies UserViewConfig),
          pmo_scope: scope,
          'pmo_User@odata.bind': `/systemusers(${userId.replace(/[{}]/g, '')})`,
          ...(scope === 'team' && teamId
            ? { 'pmo_Team@odata.bind': `/teams(${teamId.replace(/[{}]/g, '')})` }
            : {}),
        });
      }
      await qc.invalidateQueries({ queryKey: QK });
    },
    [userId, tableKey, customColRows, qc],
  );

  const deleteUserCustomColumn = useCallback(
    async (id: string) => {
      const row = customColRows.find((r) => parseConfig(r.pmo_config).customColumns?.some((f) => f.id === id));
      if (!row) return;
      const cfg = parseConfig(row.pmo_config);
      const nextList = (cfg.customColumns ?? []).filter((f) => f.id !== id);
      await updateUserViewConfig(row.pmo_userviewid, JSON.stringify({ ...cfg, customColumns: nextList }));
      await qc.invalidateQueries({ queryKey: QK });
    },
    [customColRows, qc],
  );

  return {
    options,
    activeViewId: effectiveActiveId,
    setActiveViewId: setActiveViewIdRaw,
    activeIsDefault,
    activeConfig,
    setWidth,
    resetWidths,
    hasCustomWidths: Object.keys(activeConfig.widths ?? {}).length > 0,
    createView,
    updateView,
    deleteView,
    getViewColumns,
    getViewFiltersSort, getViewAspects,
    saveFiltersSort,
    getViewScope,
    userCustomColumns,
    saveUserCustomColumn,
    deleteUserCustomColumn,
    isReady: !!userId && !isLoading,
  };
}

/**
 * Teams the current user can share a view with: the intersection of the teams
 * they belong to and the app's PMO/nav-pane teams (Business Intelligence,
 * Payer Initiatives, …). Returns [] until both sources resolve. `enabled`
 * gates the PMO-teams fetch so non-view tables don't pay for it.
 */
export function useViewTeamOptions(enabled: boolean): { id: string; name: string }[] {
  const myTeams = useCurrentUserTeamsWithNames();
  const pmoTeams = useAllPmoTeams({ enabled });
  return useMemo(() => {
    if (!enabled || !myTeams || !pmoTeams) return [];
    const pmoIds = new Set(pmoTeams.map((t) => t.teamid.toLowerCase()));
    // Prefer the PMO team's display name; fall back to the membership name.
    const pmoNameById = new Map(pmoTeams.map((t) => [t.teamid.toLowerCase(), t.name]));
    return myTeams
      .filter((t) => pmoIds.has(t.teamid.toLowerCase()))
      .map((t) => ({ id: t.teamid, name: pmoNameById.get(t.teamid.toLowerCase()) ?? t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [enabled, myTeams, pmoTeams]);
}
