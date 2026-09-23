import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, X, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { SearchableSelect } from '../common/SearchableSelect';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { useUserSearch } from '../../hooks/useIntakeLookups';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { toFriendlyError } from '../../lib/utils';

interface TeamMember {
  systemuserid: string;
  fullname: string;
  internalemailaddress?: string;
}

interface TeamWithRoles {
  teamid: string;
  name: string;
  roles: { name: string }[];
}

/** Read-only role probe — shows admin what privileges the team currently grants.
 *
 *  Dataverse N:N relationships are queried via `<assoc>/any(...)` filter on the
 *  destination entity set, NOT by walking the nav property in a URL path. The
 *  Power Apps Code App SDK's retrieveMultipleRecordsAsync doesn't accept paths
 *  like `teams(<id>)/teamroles_association` — it expects a top-level entity
 *  set name. See useCurrentUserTeams.ts:44 for the canonical pattern. */
function useTeamRoles(teamId: string | undefined) {
  return useQuery<{ name: string }[]>({
    queryKey: ['team-roles', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return [];
      const res = await dv.list<{ name: string }>('roles', {
        $select: ['name'],
        $filter: `teamroles_association/any(t: t/teamid eq ${teamId})`,
      });
      return res;
    },
  });
}

function useTeamMembers(teamId: string | undefined) {
  return useQuery<TeamMember[]>({
    queryKey: ['team-members', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return [];
      const res = await dv.list<TeamMember>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname', 'internalemailaddress'],
        $filter: `teammembership_association/any(t: t/teamid eq ${teamId})`,
        $orderby: 'fullname asc',
      });
      return res;
    },
  });
}

export function TeamMembershipSection() {
  const teams = useAllPmoTeams({ enabled: true }) ?? [];
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const selectedTeam: TeamWithRoles | undefined = useMemo(
    () => {
      const t = teams.find((x) => x.teamid === selectedTeamId);
      return t ? { ...t, roles: [] } : undefined;
    },
    [teams, selectedTeamId],
  );

  const { data: roles = [], isLoading: rolesLoading } = useTeamRoles(selectedTeamId);
  const { data: members = [], isLoading: membersLoading, refetch: refetchMembers } = useTeamMembers(selectedTeamId);
  const qc = useQueryClient();

  const { searchUsers, resolveUserLabel } = useUserSearch();
  const [pendingUserId, setPendingUserId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const teamOptions = useMemo(
    () => teams.map((t) => ({ value: t.teamid, label: t.name })),
    [teams],
  );

  const memberIds = useMemo(() => new Set(members.map((m) => m.systemuserid)), [members]);

  async function handleAdd() {
    if (!selectedTeamId || !pendingUserId) return;
    if (memberIds.has(pendingUserId)) {
      toast.error('That user is already a member of this team.');
      return;
    }
    setAdding(true);
    try {
      await dv.associate(
        ENTITY_SETS.team,
        selectedTeamId,
        'teammembership_association',
        ENTITY_SETS.systemUser,
        pendingUserId,
      );
      toast.success('User added to team.');
      setPendingUserId('');
      await refetchMembers();
      qc.invalidateQueries({ queryKey: ['team-members', selectedTeamId] });
    } catch (err) {
      toast.error(toFriendlyError(err, 'Failed to add user to team'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove() {
    if (!selectedTeamId || !removingMember) return;
    setRemoving(true);
    try {
      await dv.disassociate(
        ENTITY_SETS.team,
        selectedTeamId,
        'teammembership_association',
        ENTITY_SETS.systemUser,
        removingMember.systemuserid,
      );
      toast.success(`Removed ${removingMember.fullname} from team.`);
      setRemovingMember(null);
      await refetchMembers();
      qc.invalidateQueries({ queryKey: ['team-members', selectedTeamId] });
    } catch (err) {
      toast.error(toFriendlyError(err, 'Failed to remove user'));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Team Memberships</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add or remove users from PMO teams. Membership grants the team's roles —
          e.g. <span className="font-mono text-xs">Project User</span> + <span className="font-mono text-xs">CFR PMO Team</span> for the PMO teams.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Team
        </label>
        <SearchableSelect
          value={selectedTeamId}
          onChange={(v) => setSelectedTeamId(v)}
          options={teamOptions}
          placeholder={teams.length === 0 ? 'Loading teams…' : 'Select a PMO team'}
        />
      </div>

      {selectedTeam && (
        <div className="rounded-md border border-border bg-card p-4 space-y-4">
          {/* Roles inherited by team members */}
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-widest">Roles granted</span>:{' '}
            {rolesLoading ? (
              <Loader2 className="inline h-3 w-3 animate-spin" />
            ) : roles.length === 0 ? (
              <span className="italic text-amber-600">No roles assigned — members will not gain any privileges from this team.</span>
            ) : (
              <span className="font-mono">{roles.map((r) => r.name).join(' · ')}</span>
            )}
          </div>

          {/* Member list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                Members ({membersLoading ? '…' : members.length})
              </div>
            </div>
            {membersLoading ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                <Loader2 className="inline h-4 w-4 animate-spin mr-1.5" />
                Loading members…
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-2">
                No members. Add one below.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 rounded border border-border/60">
                {members.map((m) => (
                  <li key={m.systemuserid} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{m.fullname}</p>
                      {m.internalemailaddress && (
                        <p className="text-xs text-muted-foreground truncate">{m.internalemailaddress}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemovingMember(m)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${m.fullname}`}
                      title="Remove from team"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add user */}
          <div className="space-y-2 pt-2 border-t border-border/60">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Add a user to this team
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={pendingUserId}
                  onChange={(v) => setPendingUserId(v)}
                  onSearch={searchUsers}
                  resolveLabel={resolveUserLabel}
                  placeholder="Search for a user by name or email"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!pendingUserId || adding}
                size="sm"
              >
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                Add
              </Button>
            </div>
          </div>
        </div>
      )}

      {!selectedTeam && (
        <p className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded-md">
          Select a team above to view and manage its members.
        </p>
      )}

      <ConfirmDialog
        open={!!removingMember}
        title="Remove user from team?"
        message={
          removingMember
            ? `${removingMember.fullname} will lose access granted by this team's roles (${roles.map((r) => r.name).join(', ') || 'no roles'}).`
            : ''
        }
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        onConfirm={handleRemove}
        onCancel={() => setRemovingMember(null)}
        isLoading={removing}
      />
    </section>
  );
}
