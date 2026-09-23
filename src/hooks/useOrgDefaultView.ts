/**
 * useOrgDefaultView — reads the admin-configured org-wide Default view for a
 * table (which columns show, their order, and default widths) from
 * pmo_appsettings key `view.default.<tableKey>`. Returns {} when unset, in
 * which case the table falls back to its shipped code order / auto widths.
 */
import { useMemo } from 'react';
import { useAppSetting } from './useAppSettings';
import { orgDefaultViewKey, parseOrgDefaultView, type OrgDefaultViewConfig } from '../lib/tableViewRegistry';

export function useOrgDefaultView(tableKey: string): OrgDefaultViewConfig {
  const raw = useAppSetting(tableKey ? orgDefaultViewKey(tableKey) : '');
  return useMemo(() => parseOrgDefaultView(raw), [raw]);
}
