import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdminUserIds } from '../../lib/adminUsers';
import { Users, Plus, Trash2, ChevronDown, ChevronRight, Loader2, User, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { MeetingWorkspace } from './MeetingWorkspace';
import { AddCollaboratorDialog } from './AddCollaboratorDialog';
import { TEAM_ROLE } from '../../lib/constants';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';
import { useTeamMembersFiltered } from '../../hooks/useTeamMembersFiltered';
import { displayTeamName } from '../../lib/pmoTeams';
import { cn } from '../../lib/utils';
import type { ProjectCollaborator } from '../../models/projectCollaborator.model';
import { useProjectAccessMap } from '../../hooks/useProjectAccessMap';
import { useAllPmoTeams } from '../../hooks/useAllPmoTeams';
import { useCollaboratorTeamMemberships } from '../../hooks/useCollaboratorTeamMemberships';

interface TeamEntry {
  pmo_projectteamid: string;
  pmo_name?: string;
  pmo_role?: number;
  '_pmo_team_value'?: string;
  '_pmo_team_value@OData.Community.Display.V1.FormattedValue'?: string;
}

interface CollaborateWorkspaceProps {
  projectId: string;
  projectName?: string;
  primaryTeamName?: string;
  primaryTeam?: TeamEntry;
  contributingTeams: TeamEntry[];
  availableTeams: Array<{ teamid: string; name: string }>;
  onAddTeam: (payload: Record<string, unknown>) => void;
  onRemoveTeam: (id: string) => void;
  addTeamPending: boolean;
  /** Record id (pmo_projectteamid) currently being removed — only that card spins. */
  removingTeamRecordId?: string;
  onEditProject: () => void;
  canManageRoster: boolean;
  canEdit: boolean;
  /** Individual mode collaborators. Undefined = team-based mode active. */
  collaborators?: ProjectCollaborator[];
  onAddCollaborators?: (entries: Array<{ userId: string; viaTeamId: string | null }>, onSuccess?: () => void) => void;
  onRemoveCollaborator?: (collaboratorId: string, userId: string) => void;
  addCollaboratorPending?: boolean;
  removeCollaboratorPending?: boolean;
  collaborationMode: 'team' | 'individual';
}

// ── Team card: collapsible member list ─────────────────────────────────────────

function TeamCard({
  teamId,
  teamName,
  badge,
  badgeVariant,
  canRemove,
  onRemove,
  removePending,
  /** Individual mode: show only collaborators for this team, not all members */
  individualModeCollaborators,
  onRemoveCollaborator,
  removeCollaboratorPending,
  canManageRoster,
}: {
  teamId?: string;
  teamName: string;
  badge: string;
  badgeVariant: 'primary' | 'contributing' | 'admin' | 'individual';
  canRemove?: boolean;
  onRemove?: () => void;
  removePending?: boolean;
  individualModeCollaborators?: ProjectCollaborator[];
  onRemoveCollaborator?: (collaboratorId: string, userId: string) => void;
  removeCollaboratorPending?: boolean;
  canManageRoster: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: allMembers = [], isLoading: membersLoading } = useTeamMembersFiltered(
    // Only fetch when expanded AND we have a real teamId (not the synthetic Admin/Individual cards)
    expanded && teamId && !(individualModeCollaborators && individualModeCollaborators.length > 0) ? teamId : undefined,
  );

  const isPrimary = badgeVariant === 'primary';
  const isAdmin = badgeVariant === 'admin';
  const isIndividual = badgeVariant === 'individual';

  // In individual mode, the displayed members come from the collaborator list
  const displayMembers: Array<{ id: string; name: string; collaboratorId?: string; userId?: string; memberIsAdmin?: boolean }> =
    individualModeCollaborators
      ? individualModeCollaborators.map((c) => ({
          id: c['_pmo_user_value'] ?? c.pmo_projectcollaboratorid,
          name: c['_pmo_user_value@OData.Community.Display.V1.FormattedValue'] ?? 'Unknown',
          collaboratorId: c.pmo_projectcollaboratorid,
          userId: c['_pmo_user_value'],
        }))
      : allMembers.map((m) => ({ id: m.systemuserid, name: m.fullname, memberIsAdmin: m.isAdmin }));

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={cn(
          'rounded-lg border px-4 py-3',
          isPrimary
            ? 'border-primary/20 bg-primary/5'
            : 'border-border bg-muted/20',
        )}
      >
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full flex items-center gap-3 text-left">
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md shrink-0',
              isPrimary ? 'bg-primary/15 text-primary'
                : isAdmin ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : isIndividual ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-muted text-muted-foreground',
            )}>
              {isAdmin ? <Shield className="h-4 w-4" />
                : isIndividual ? <User className="h-4 w-4" />
                : <Users className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">{teamName}</p>
              <p className="text-xs text-muted-foreground">{badge}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {canRemove && onRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  title="Remove contributing team"
                  disabled={removePending}
                >
                  {removePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              )}
              {expanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 pt-2 border-t border-border space-y-1">
            {membersLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <Loader2 className="h-3 w-3 animate-spin" />Loading members…
              </div>
            ) : displayMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No members to display.</p>
            ) : (
              displayMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-2 py-0.5">
                  <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-foreground flex-1 truncate">{m.name}</span>
                  {m.memberIsAdmin && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">Admin</span>
                  )}
                  <span className="text-xs text-muted-foreground">Full access</span>
                  {canManageRoster && m.collaboratorId && onRemoveCollaborator && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveCollaborator(m.collaboratorId!, m.userId!)}
                      disabled={removeCollaboratorPending}
                      title="Remove access"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CollaborateWorkspace({
  projectId,
  primaryTeamName,
  primaryTeam,
  contributingTeams,
  availableTeams,
  onAddTeam,
  onRemoveTeam,
  addTeamPending,
  removingTeamRecordId,
  onEditProject,
  canManageRoster,
  canEdit,
  collaborators = [],
  onAddCollaborators,
  onRemoveCollaborator,
  addCollaboratorPending = false,
  removeCollaboratorPending = false,
  collaborationMode,
}: CollaborateWorkspaceProps) {
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [addCollabOpen, setAddCollabOpen] = useState(false);

  const isIndividual = collaborationMode === 'individual';

  // ── Individual-mode grouping (LIVE membership-based) ──
  // Collaborators are grouped by the PMO team(s) they actually belong to right
  // now — NOT by how they were granted access (viaTeam is display-only
  // provenance and deliberately ignored here). Rules:
  //   • A user on multiple PMO teams appears under EACH team's card.
  //   • A user on no PMO team falls through to the 'Individual Users' card.
  //   • Admins are pulled out first and shown on their own card (they're
  //     usually on many teams, so membership grouping would scatter them).
  const allPmoTeams = useAllPmoTeams({ enabled: isIndividual }) ?? [];
  const pmoTeamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allPmoTeams) m.set(t.teamid, t.name);
    return m;
  }, [allPmoTeams]);

  const collabUserIds = useMemo(
    () => collaborators.map((c) => c['_pmo_user_value'] ?? '').filter(Boolean),
    [collaborators],
  );
  const { data: adminUserIds } = useQuery({
    queryKey: ['collaboratorAdminIds', collabUserIds.join(',')],
    enabled: isIndividual && collabUserIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => getAdminUserIds(collabUserIds),
  });
  const isAdminUser = (c: ProjectCollaborator) =>
    !!adminUserIds?.has((c['_pmo_user_value'] ?? '').toLowerCase());
  const adminCollaborators = isIndividual ? collaborators.filter(isAdminUser) : [];
  const nonAdminCollaborators = isIndividual ? collaborators.filter((c) => !isAdminUser(c)) : [];

  // Resolve live PMO-team membership for the non-admin collaborators.
  const membershipTeams = useMemo(
    () => allPmoTeams.map((t) => ({ teamId: t.teamid, name: t.name })),
    [allPmoTeams],
  );
  const nonAdminUserIds = useMemo(
    () => nonAdminCollaborators.map((c) => c['_pmo_user_value'] ?? '').filter(Boolean),
    [nonAdminCollaborators],
  );
  const { data: membershipByUser } = useCollaboratorTeamMemberships(membershipTeams, nonAdminUserIds);

  // Build display groups from live membership.
  const { collabByTeam, individualUsers } = useMemo(() => {
    const byTeam = new Map<string, ProjectCollaborator[]>();
    const solo: ProjectCollaborator[] = [];
    if (!isIndividual) return { collabByTeam: byTeam, individualUsers: solo };
    for (const c of nonAdminCollaborators) {
      const uid = (c['_pmo_user_value'] ?? '').toLowerCase();
      const teams = membershipByUser?.get(uid) ?? [];
      if (teams.length === 0) {
        solo.push(c);
      } else {
        for (const t of teams) {
          const list = byTeam.get(t.teamId) ?? [];
          list.push(c);
          byTeam.set(t.teamId, list);
        }
      }
    }
    return { collabByTeam: byTeam, individualUsers: solo };
  }, [isIndividual, nonAdminCollaborators, membershipByUser]);

  // Team display ids: Contributing teams ∪ (individual mode) any PMO team a
  // non-admin collaborator is a live member of.
  const allDisplayTeamIds = new Set<string>([
    ...contributingTeams.map((t) => t['_pmo_team_value']).filter((id): id is string => !!id),
    ...(isIndividual ? Array.from(collabByTeam.keys()) : []),
  ]);

  // Build an access map for duplicate-grant warnings in the Add dialog.
  // Includes primary + contributing teams and existing collaborator rows.
  const accessMapTeams = useMemo(() => {
    const result: Array<{ teamId: string; label: string }> = [];
    if (primaryTeam) {
      const tid = primaryTeam['_pmo_team_value'];
      if (tid) result.push({ teamId: tid, label: primaryTeam.pmo_name ?? primaryTeamName ?? 'Primary Team' });
    }
    for (const t of contributingTeams) {
      const tid = t['_pmo_team_value'];
      const label = t['_pmo_team_value@OData.Community.Display.V1.FormattedValue'] ?? t.pmo_name ?? tid ?? 'Contributing Team';
      if (tid) result.push({ teamId: tid, label });
    }
    return result;
  }, [primaryTeam, primaryTeamName, contributingTeams]);

  const { data: accessMap } = useProjectAccessMap(accessMapTeams, collaborators);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-foreground">Team</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => isIndividual ? setAddCollabOpen(true) : (setSelectedTeamId(''), setAddTeamOpen(true))}
            disabled={!canManageRoster}
            title={!canManageRoster ? READ_ONLY_TOOLTIP : undefined}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {isIndividual ? 'Add Person or Team' : 'Add Contributing Team'}
          </Button>
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2">
          {/* Primary Team */}
          {(primaryTeam || primaryTeamName) ? (
            <TeamCard
              teamId={primaryTeam?.['_pmo_team_value']}
              teamName={primaryTeam?.pmo_name ?? primaryTeamName ?? ''}
              badge="Primary Team · Full access"
              badgeVariant="primary"
              canManageRoster={canManageRoster}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                No primary team assigned.{' '}
                <button onClick={onEditProject} className="text-primary hover:underline">Assign one</button>
              </p>
            </div>
          )}

          {/* Contributing Teams (team-based mode) or Via-team cards (individual mode) */}
          {Array.from(allDisplayTeamIds).map((teamId) => {
            const entry = contributingTeams.find((t) => t['_pmo_team_value'] === teamId);
            // In individual mode: show the collaborator subset if rows exist;
            // if no collaborator rows yet for this team, fall back to the full team
            // membership query (covers teams added before individual mode was turned on).
            const teamCollabRows = isIndividual ? collabByTeam.get(teamId) : undefined;
            const collabRows = teamCollabRows && teamCollabRows.length > 0 ? teamCollabRows : undefined;
            // Name resolution order:
            //   1. Contributing-team entry's FormattedValue / pmo_name (team-based rows).
            //   2. The live PMO-team name (individual mode groups by membership, so
            //      a card can be a team the user belongs to that is NOT a Contributing
            //      team on this project, e.g. Payer Initiatives).
            //   3. Only as a last resort, displayTeamName(teamId). teamId is a raw GUID,
            //      so a GUID in the card header means name resolution failed upstream.
            const teamName = entry?.['_pmo_team_value@OData.Community.Display.V1.FormattedValue']
              ?? entry?.pmo_name
              ?? displayTeamName(pmoTeamNameById.get(teamId) ?? teamId);
            return (
              <TeamCard
                key={teamId}
                teamId={teamId}
                teamName={teamName}
                badge={`Contributing · Full access`}
                badgeVariant="contributing"
                canRemove={canManageRoster && !!entry}
                onRemove={entry ? () => setRemoveTarget({ id: entry.pmo_projectteamid, name: teamName }) : undefined}
                removePending={removingTeamRecordId === entry?.pmo_projectteamid}
                individualModeCollaborators={collabRows}
                onRemoveCollaborator={onRemoveCollaborator}
                removeCollaboratorPending={removeCollaboratorPending}
                canManageRoster={canManageRoster}
              />
            );
          })}

          {/* Optimistic pending card while add-team mutation is in flight */}
          {addTeamPending && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 flex items-center gap-3 opacity-60">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Adding team…</p>
                <p className="text-xs text-muted-foreground">Contributing</p>
              </div>
            </div>
          )}

          {/* Individual mode: Admin card — admins added directly */}
          {isIndividual && adminCollaborators.length > 0 && (
            <TeamCard
              teamName="Admin"
              badge={`${adminCollaborators.length} admin${adminCollaborators.length === 1 ? '' : 's'} · Full access`}
              badgeVariant="admin"
              individualModeCollaborators={adminCollaborators}
              onRemoveCollaborator={onRemoveCollaborator}
              removeCollaboratorPending={removeCollaboratorPending}
              canManageRoster={canManageRoster}
            />
          )}

          {/* Individual mode: Individual Users card — non-admin collaborators
              who are not a live member of any PMO team. */}
          {isIndividual && individualUsers.length > 0 && (
            <TeamCard
              teamName="Individual Users"
              badge={`${individualUsers.length} person${individualUsers.length === 1 ? '' : 's'} · Full access`}
              badgeVariant="individual"
              individualModeCollaborators={individualUsers}
              onRemoveCollaborator={onRemoveCollaborator}
              removeCollaboratorPending={removeCollaboratorPending}
              canManageRoster={canManageRoster}
            />
          )}

          {/* Empty states */}
          {contributingTeams.length === 0 && !isIndividual && (primaryTeam || primaryTeamName) && (
            <p className="text-xs text-muted-foreground px-1">
              No contributing teams. Add teams that support this project using the button above.
            </p>
          )}
          {!(primaryTeam || primaryTeamName) && contributingTeams.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">No teams assigned to this project.</p>
          )}
        </div>
      </div>

      {/* Meetings */}
      <div className="border-t border-border pt-6">
        <MeetingWorkspace projectId={projectId} canEdit={canEdit} />
      </div>

      {/* Team-based Add Dialog */}
      <Dialog open={addTeamOpen} onOpenChange={(o) => { if (!o) setAddTeamOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Contributing Team</DialogTitle>
            <DialogDescription>Select a team to add as a contributing team on this project.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a team..." />
              </SelectTrigger>
              <SelectContent>
                {availableTeams.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">All teams are already assigned.</div>
                ) : (
                  availableTeams.map((t) => (
                    <SelectItem key={t.teamid} value={t.teamid}>{t.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={addTeamPending} onClick={() => setAddTeamOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedTeamId || addTeamPending}
              onClick={() => {
                if (!selectedTeamId) return;
                onAddTeam({
                  'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
                  'pmo_Team@odata.bind': `/teams(${selectedTeamId})`,
                  pmo_role: TEAM_ROLE.Contributing,
                  pmo_joineddate: toDataverseDateOnly(todayLocalYmd()),
                });
                setAddTeamOpen(false);
                setSelectedTeamId('');
              }}
            >
              {addTeamPending ? 'Adding...' : 'Add Team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Individual-mode Add Dialog */}
      {isIndividual && onAddCollaborators && (
        <AddCollaboratorDialog
          open={addCollabOpen}
          onOpenChange={(o) => { if (!o) setAddCollabOpen(false); }}
          projectId={projectId}
          onAdd={(entries) => {
            onAddCollaborators(entries);
            setAddCollabOpen(false);
          }}
          pending={addCollaboratorPending}
          existingAccessMap={accessMap}
        />
      )}

      {/* Remove Contributing Team Confirm */}
      {removeTarget && (
        <Dialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove contributing team</DialogTitle>
              <DialogDescription>
                Remove &ldquo;{removeTarget.name}&rdquo; as a contributing team on this project?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={!!removingTeamRecordId}
                onClick={() => { onRemoveTeam(removeTarget.id); setRemoveTarget(null); }}
              >
                {removingTeamRecordId ? 'Removing...' : 'Remove'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
