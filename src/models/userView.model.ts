/**
 * pmo_userview — a per-user saved list view (columns, widths, order) for one
 * of the app's data tables. Phase 1 uses only the reserved `__default__` view
 * per (user, tableKey) to persist column WIDTHS on the locked Default view.
 * Phase 2 adds named custom views that also pick/order columns.
 */
import type { CustomColumnFormula } from '../lib/customColumns';
export interface UserView {
  pmo_userviewid: string;
  /** View name. `__default__` = the user's saved widths for the Default view. */
  pmo_name: string;
  /** Table identifier: 'projects' | 'programs' | 'intake' | 'userfeedback' | ... */
  pmo_tablekey?: string;
  /** JSON config — see UserViewConfig. */
  pmo_config?: string | null;
  pmo_isdefault?: boolean;
  /** 'personal' (owner only) or 'team' (everyone on pmo_team). Absent = personal. */
  pmo_scope?: string | null;
  '_pmo_user_value'?: string;
  '_pmo_team_value'?: string | null;
  '_pmo_team_value@OData.Community.Display.V1.FormattedValue'?: string;
  statecode?: 0 | 1;
  createdon?: string;
}

export interface UserViewCreate {
  pmo_name: string;
  pmo_tablekey: string;
  pmo_config?: string;
  pmo_isdefault?: boolean;
  pmo_scope?: string;
  'pmo_User@odata.bind': string;
  'pmo_Team@odata.bind'?: string;
}

export type ViewScope = 'personal' | 'team';

/** Parsed shape of pmo_config. */
export interface UserViewConfig {
  /** Per-column pixel widths, keyed by DataTable column `key`. */
  widths?: Record<string, number>;
  /** Ordered list of visible column keys. */
  columns?: string[];
  /**
   * Saved filter state keyed by column key. String = single-select;
   * string[] = multi-select. Applied on view select; only written when
   * the user explicitly clicks "Save filters to view".
   */
  filters?: Record<string, string | string[]>;
  /** Saved sort column + direction. Same save semantics as filters. */
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  /**
   * Per-column lookup aspect override (colKey -> aspect: name/guid/email/…).
   * Overrides the org-wide default for THIS view only. Missing key ⇒ org default.
   */
  aspects?: Record<string, string>;
  /**
   * User-authored custom (computed) columns. Only populated on the reserved
   * `__customcols__` rows (one per user for personal scope, one per team for
   * team scope) — NOT on normal saved views. Rendered alongside admin org-wide
   * custom columns (which live in pmo_appsettings columns.custom.*).
   */
  customColumns?: CustomColumnFormula[];
}

/** The reserved view name that stores a user's Default-view column widths. */
export const DEFAULT_VIEW_NAME = '__default__';

/** Reserved view name whose config.customColumns holds a user's (or team's)
 *  self-authored custom columns for a table. Never shown in the view dropdown. */
export const CUSTOM_COLS_VIEW_NAME = '__customcols__';
