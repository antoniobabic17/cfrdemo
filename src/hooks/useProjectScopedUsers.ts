/**
 * useProjectScopedUsers — returns the union of all systemusers belonging to
 * the project's primary team or any of its contributing teams (the rows on
 * the Collaborate tab). Used by every project-side person picker EXCEPT the
 * Project Manager and Executive Sponsor pickers, which intentionally remain
 * org-wide.
 *
 * The hook reads pmo_projectteam rows (already cached as 'projectTeams' by
 * useProjectTeams) so it auto-invalidates when the user adds or removes a
 * contributing team on the Collaborate tab.
 */
import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { useProjectTeams } from './useProjectTeams';
import type { SelectOption } from '../components/common/SearchableSelect';

export interface ScopedUser {
  systemuserid: string;
  fullname: string;
  firstname?: string;
  lastname?: string;
}

interface UserRow {
  systemuserid: string;
  fullname: string;
  firstname: string;
  lastname: string;
}

const fmtName = (u: UserRow): string =>
  u.lastname && u.firstname ? `${u.lastname}, ${u.firstname}` : u.fullname;

// Service-account / app-id filter, mirrors the filter used elsewhere in the app.
const USER_BASE_FILTER =
  "isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null";

export function useProjectScopedUsers(projectId: string | undefined) {
  const { data: orgTeams = [], isLoading: teamsLoading } = useProjectTeams(projectId);

  const teamIds = useMemo<string[]>(() => {
    return orgTeams
      .map((t) => t['_pmo_team_value'] as string | undefined)
      .filter((id): id is string => !!id);
  }, [orgTeams]);

  const teamIdsKey = useMemo(() => [...teamIds].sort().join(','), [teamIds]);

  const usersQuery = useQuery({
    queryKey: ['projectScopedUsers', projectId, teamIdsKey],
    queryFn: async (): Promise<ScopedUser[]> => {
      if (teamIds.length === 0) return [];
      // OData "any" with an "or" chain is the simplest cross-team union that
      // works without breaking the PowerPlatform $filter parser.
      const orChain = teamIds
        .map((tid) => `teammembership_association/any(t: t/teamid eq '${tid}')`)
        .join(' or ');
      const rows = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname', 'firstname', 'lastname'],
        $filter: `(${orChain}) and ${USER_BASE_FILTER}`,
        $orderby: 'lastname asc,firstname asc',
        $top: 500,
      });
      // De-dupe by systemuserid (a user could belong to multiple project teams).
      const seen = new Set<string>();
      return rows.filter((r) => {
        if (seen.has(r.systemuserid)) return false;
        seen.add(r.systemuserid);
        return true;
      });
    },
    enabled: !!projectId && !teamsLoading && teamIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const users = usersQuery.data ?? [];

  /** Static dropdown options (firstname-lastname keyed) */
  const options = useMemo<SelectOption[]>(
    () => users.map((u) => ({ value: u.systemuserid, label: fmtName(u as UserRow) })),
    [users],
  );

  /** Map from systemuserid → display label, useful for resolving stamped values. */
  const labelMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.systemuserid, fmtName(u as UserRow));
    return m;
  }, [users]);

  /** SearchableSelect-compatible search closure. Filters the cached list
   *  client-side - no extra Dataverse round-trip while the user is typing. */
  const searchUsers = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      if (!query) return options;
      const q = query.toLowerCase();
      return options.filter((o) => o.label.toLowerCase().includes(q));
    },
    [options],
  );

  /** Resolves a systemuserid to a label. Falls back to a fresh Dataverse fetch
   *  if the id isn't in the scoped list (e.g. an old assignment from someone
   *  who has since been removed from the project teams). */
  const resolveUserLabel = useCallback(
    async (id: string): Promise<string> => {
      const cached = labelMap.get(id);
      if (cached) return cached;
      try {
        const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, [
          'systemuserid', 'fullname', 'firstname', 'lastname',
        ]);
        return fmtName(u);
      } catch {
        return id;
      }
    },
    [labelMap],
  );

  return {
    users,
    options,
    labelMap,
    searchUsers,
    resolveUserLabel,
    isLoading: teamsLoading || usersQuery.isLoading,
    isEmpty: !teamsLoading && !usersQuery.isLoading && users.length === 0,
  };
}
