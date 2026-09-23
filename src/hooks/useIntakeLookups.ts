/**
 * Lookup data hooks shared by the intake submission wizard and the approval
 * panel. Centralizes the pmo-team filter + the active-user search + the user
 * label resolver so the two surfaces never drift apart.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { fetchPmoTeams, resolveSidebarTeamName } from '../lib/pmoTeams';
import { usePmoTeamField } from '../providers/ConfigurationProvider';
import { useAppSettings } from './useAppSettings';
import type { SelectOption } from '../components/common/SearchableSelect';

interface PmoTeamRow { teamid: string; name: string; [key: string]: unknown; }
interface UserRow { systemuserid: string; fullname: string; lastname: string; firstname: string; }

function fmtUserName(u: UserRow): string {
  if (u.lastname && u.firstname) return `${u.lastname}, ${u.firstname}`;
  return u.fullname;
}

/**
 * Active PMO teams (filtered by the configured pmo-team boolean field).
 * Returns options with RAW Dataverse team names as labels. Callers that
 * want to render sidebar-admin display-name overrides in the picker should
 * layer `resolveSidebarTeamName` on top via `useMemo` — keeping the raw
 * name available means detection code (e.g. Payer Initiatives feature
 * gating) can still match against `PAYER_INITIATIVES_TEAM_NAMES` even when
 * the admin has renamed the team for display.
 */
export function usePmoTeamsForIntake() {
  const pmoTeamField = usePmoTeamField();
  return useQuery<SelectOption[]>({
    queryKey: ['pmoTeamsForIntake', pmoTeamField],
    queryFn: async () => {
      const teams = await fetchPmoTeams<PmoTeamRow>(pmoTeamField, ['teamid', 'name']);
      return teams.map((t) => ({ value: t.teamid, label: t.name }));
    },
    staleTime: Infinity,
  });
}

/**
 * Convenience hook that layers the sidebar-admin display-name resolver on
 * top of the raw team list from `usePmoTeamsForIntake`. Use this for
 * picker rendering; use `usePmoTeamsForIntake` directly when you need the
 * raw Dataverse names for matching / detection.
 */
export function useResolvedPmoTeamsForIntake(): SelectOption[] {
  const { data: raw = [] } = usePmoTeamsForIntake();
  const { data: settings } = useAppSettings();
  return useMemo(
    () => raw.map((o) => ({ ...o, label: resolveSidebarTeamName(o.value, o.label, settings) })),
    [raw, settings],
  );
}

// Minimal exclusions only. We previously also filtered out
// `accessmode ne 4 and accessmode ne 5 and applicationid eq null` --
// that combo excluded Support/Non-interactive users but also appears to
// have masked perfectly normal users in some tenants (a manager reported
// that searching for another real user returned only himself). Drop the
// extra filters and rely on the default systemuser security so the picker
// surfaces everyone the caller can see.
const USER_BASE_FILTER = "isdisabled eq false";

/** Server-side user search for SearchableSelect (PM, Sponsor pickers). */
export function useUserSearch() {
  const searchUsers = useCallback(async (query: string): Promise<SelectOption[]> => {
    const safe = query.replace(/'/g, "''");
    const nameFilter = `(contains(lastname,'${safe}') or contains(firstname,'${safe}') or contains(fullname,'${safe}'))`;
    const users = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid', 'fullname', 'lastname', 'firstname'],
      $filter: `${USER_BASE_FILTER} and ${nameFilter}`,
      $orderby: 'lastname asc,firstname asc',
      $top: 50,
    });
    return users.map((u) => ({ value: u.systemuserid, label: fmtUserName(u) }));
  }, []);

  const resolveUserLabel = useCallback(async (id: string): Promise<string> => {
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, [
      'systemuserid', 'fullname', 'lastname', 'firstname',
    ]);
    return fmtUserName(u);
  }, []);

  return { searchUsers, resolveUserLabel };
}


/**
 * Server-side user search scoped to a single team's ACTIVE members. Used by the
 * cross-team request form's optional "assign to a specific person" picker. When
 * teamId is empty the search returns [] (the picker is disabled until a team is
 * chosen). Mirrors useUserSearch but adds the teammembership filter.
 */
export function useTeamMemberSearch(teamId: string | undefined) {
  const searchUsers = useCallback(async (query: string): Promise<SelectOption[]> => {
    const team = (teamId ?? '').replace(/[{}]/g, '').trim();
    if (!team) return [];
    const safe = query.replace(/'/g, "''");
    const nameFilter = `(contains(lastname,'${safe}') or contains(firstname,'${safe}') or contains(fullname,'${safe}'))`;
    const users = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid', 'fullname', 'lastname', 'firstname'],
      $filter: `${USER_BASE_FILTER} and teammembership_association/any(t: t/teamid eq ${team}) and ${nameFilter}`,
      $orderby: 'lastname asc,firstname asc',
      $top: 50,
    });
    return users.map((u) => ({ value: u.systemuserid, label: fmtUserName(u) }));
  }, [teamId]);

  const resolveUserLabel = useCallback(async (id: string): Promise<string> => {
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, [
      'systemuserid', 'fullname', 'lastname', 'firstname',
    ]);
    return fmtUserName(u);
  }, []);

  return { searchUsers, resolveUserLabel };
}
