/**
 * useCollaboratorTeamMemberships — resolves, for a set of collaborator users,
 * which PMO teams each user is a LIVE member of.
 *
 * Individual-mode collaborator grouping is membership-based, NOT provenance-
 * based: a collaborator card groups people by the team(s) they actually belong
 * to right now, regardless of how they were granted access (team-expand vs.
 * direct people search). Consequences:
 *   - A user on two PMO teams appears under BOTH team cards.
 *   - A user on no PMO team falls through to the "Individual Users" card.
 *   - Admins are handled separately by the caller (they're usually on several
 *     teams, so membership grouping would scatter them) and never routed here.
 *
 * Implementation mirrors the proven per-team membership query in
 * useProjectAccessMap: one lightweight systemuserid-only query per PMO team,
 * run in parallel. PMO teams are the small sidebar-eligible set, so this is a
 * handful of requests. Results invert into Map<lowercased userId, teams[]>.
 */
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

export interface MembershipTeam {
  teamId: string;
  name: string;
}

export function useCollaboratorTeamMemberships(
  pmoTeams: MembershipTeam[],
  userIds: string[],
) {
  const teamsKey = pmoTeams.map((t) => t.teamId).sort().join(',');
  const usersKey = [...userIds].map((u) => u.toLowerCase()).sort().join(',');

  return useQuery({
    queryKey: ['collaboratorTeamMemberships', teamsKey, usersKey],
    enabled: pmoTeams.length > 0 && userIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const wanted = new Set(userIds.map((u) => u.toLowerCase()));
      // userId (lower) -> teams they belong to
      const byUser = new Map<string, MembershipTeam[]>();

      await Promise.all(
        pmoTeams.map(async (t) => {
          try {
            const rows = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
              $select: ['systemuserid'],
              // GUID must be quoted in this filter shape (matches the working
              // pattern in useTeamMembersFiltered / useProjectAccessMap).
              $filter: `teammembership_association/any(tm: tm/teamid eq '${t.teamId}')`,
              $top: 500,
            });
            for (const r of rows) {
              const id = r.systemuserid.toLowerCase();
              if (!wanted.has(id)) continue;
              const list = byUser.get(id) ?? [];
              if (!list.some((x) => x.teamId === t.teamId)) list.push(t);
              byUser.set(id, list);
            }
          } catch {
            // Best-effort: a failed team lookup just means that team's members
            // won't be grouped under it — not worth failing the whole map.
          }
        }),
      );

      return byUser;
    },
  });
}
