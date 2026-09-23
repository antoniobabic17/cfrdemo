/**
 * useProjectAccessMap — resolves which systemuserids already have edit access
 * on a project, and WHY (which team, or individually/admin), so the Individual
 * collaboration mode's Add dialog can warn on duplicate grants instead of
 * silently creating a redundant pmo_projectcollaborator row.
 *
 * Combines two access sources:
 *   1. Team membership — members of the Primary Team + any Contributing team
 *      on the project (team-based access).
 *   2. Existing pmo_projectcollaborator rows (individual-mode access).
 *
 * Returns Map<lowercased systemuserid, { label: string }> where label is a
 * human-readable reason, e.g. "Business Intelligence" (team name),
 * "Individually Added", or "Admin".
 */
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectCollaborator } from '../models/projectCollaborator.model';

export interface AccessMapEntry {
  label: string;
}

export interface TeamForAccessMap {
  teamId: string;
  label: string;
}

export function useProjectAccessMap(
  teams: TeamForAccessMap[],
  collaborators: ProjectCollaborator[],
) {
  const teamsKey = teams.map((t) => t.teamId).sort().join(',');

  const teamQuery = useQuery({
    queryKey: ['projectAccessMapTeams', teamsKey],
    enabled: teams.length > 0,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const map = new Map<string, AccessMapEntry>();
      await Promise.all(teams.map(async (t) => {
        try {
          const rows = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
            $select: ['systemuserid'],
            $filter: `teammembership_association/any(tm: tm/teamid eq '${t.teamId}')`,
            $top: 500,
          });
          for (const r of rows) {
            const id = r.systemuserid.toLowerCase();
            if (!map.has(id)) map.set(id, { label: t.label });
          }
        } catch {
          // Best-effort: a failed team lookup just means that team's members
          // won't show a duplicate warning — not worth failing the whole map.
        }
      }));
      return map;
    },
  });

  // Merge in collaborator-sourced access. Collaborator entries take
  // precedence for their own label (more specific: "Individually Added" /
  // team name via viaTeam) if the user isn't already covered by a team.
  const combined = new Map<string, AccessMapEntry>(teamQuery.data ?? []);
  for (const c of collaborators) {
    if (c.statecode !== 0) continue;
    const userId = c['_pmo_user_value'];
    if (!userId) continue;
    const key = userId.toLowerCase();
    if (combined.has(key)) continue; // team-based label already covers them
    const viaTeamLabel = c['_pmo_viateam_value@OData.Community.Display.V1.FormattedValue'];
    combined.set(key, { label: viaTeamLabel ?? 'Individual Users' });
  }

  return { data: combined, isLoading: teamQuery.isLoading };
}
