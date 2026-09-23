/**
 * useTeamMembersFiltered — returns the active members of a single team,
 * each tagged with whether they are an app admin.
 *
 * Used by:
 *   - CollaborateWorkspace collapsible team cards (both modes) — display only
 *   - AddCollaboratorDialog team-expand picker (individual mode) — checkbox selection
 *
 * Admin tagging is done client-side after the member list loads, using the
 * batch getAdminUserIds helper. Admins are SHOWN but tagged so:
 *   - In the Collaborate tab member list, admins get an "Admin" badge.
 *   - In the AddCollaboratorDialog checkbox list, admins show an "Admin" badge
 *     instead of being hidden (per updated operator instruction).
 */
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { getAdminUserIds } from '../lib/adminUsers';

const USER_BASE_FILTER =
  'isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null';

export interface TeamMemberFiltered {
  systemuserid: string;
  fullname: string;
  internalemailaddress?: string;
  /** True when this user is an app admin (system_admin or pmo_admin). */
  isAdmin: boolean;
}

interface RawMember {
  systemuserid: string;
  fullname: string;
  internalemailaddress?: string;
}

export function useTeamMembersFiltered(teamId: string | undefined) {
  return useQuery({
    queryKey: ['teamMembersFiltered', teamId],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TeamMemberFiltered[]> => {
      if (!teamId) return [];

      // NOTE: GUID must be quoted in this filter shape — matches the working
      // pattern in TeamDetailPage.tsx useTeamMembers (line 96):
      //   teammembership_association/any(t: t/teamid eq '${teamId}')
      // Unquoted fails silently and returns 0 results.
      const members = await dv.list<RawMember>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname', 'internalemailaddress'],
        $filter: `${USER_BASE_FILTER} and teammembership_association/any(t: t/teamid eq '${teamId}')`,
        $orderby: 'fullname asc',
        $top: 500,
      });

      if (members.length === 0) return [];

      // Tag admins client-side. Admins are still shown but get isAdmin=true.
      const adminIds = await getAdminUserIds(members.map((m) => m.systemuserid));
      return members.map((m) => ({
        ...m,
        isAdmin: adminIds.has(m.systemuserid.toLowerCase()),
      }));
    },
  });
}
