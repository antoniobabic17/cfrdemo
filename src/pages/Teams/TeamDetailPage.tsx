/**
 * Team detail page — `/teams/:teamId`.
 *
 * Layout: PageHeader (team name + lead pill + Edit Lead button), then a
 * horizontal tab strip mirroring the project / program detail pages.
 *
 * Tabs:
 *  1) Bulletin     (default) — feed where members post, react, reply, mention
 *  2) Announcement           — popup editor for lead/admin; preview otherwise
 *  3) Feature Toggles        — per-team override editor (lead/admin only)
 *  4) Members                — read-only roster
 */
import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Shield, UserCog, Megaphone, Pencil, MessagesSquare, GanttChartSquare,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { TeamSchedulingGantt } from '../../components/teams/TeamSchedulingGantt';
import { useTeamMemberSchedules } from '../../hooks/useTeamMemberSchedules';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { Button } from '../../components/ui/button';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '../../components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { FeatureToggleSection } from '../../components/admin/FeatureToggleSection';
import { TeamAnnouncementEditor } from '../../components/teams/TeamAnnouncementEditor';
import { BulletinFeed } from '../../components/teams/BulletinFeed';
import { useUpsertSetting } from '../../hooks/useAppSettings';
import { useCurrentUserTeams } from '../../hooks/useCurrentUserTeams';
import {
  useTeamLead, useCanEditTeam, useCanEditTeamAnnouncement, useCanEditTeamLead,
} from '../../hooks/useTeamLeadership';
import { useTeamAnnouncement } from '../../hooks/useTeamAnnouncement';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { useUrlState, TEAM_TABS, type TeamTab } from '../../hooks/useUrlState';
import { teamLeadKey, teamTogglesKey } from '../../lib/teamSettings';
import { toast } from '../../hooks/useToast';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import { resolveSidebarTeamName, teamTypeHeaderLabel } from '../../lib/pmoTeams';
import { useAppSettings } from '../../hooks/useAppSettings';

interface SystemTeam {
  teamid: string;
  name: string;
  description?: string;
  teamtype?: number;
}

interface TeamMember {
  systemuserid: string;
  fullname: string;
}

interface UserRow {
  systemuserid: string;
  fullname: string;
  lastname?: string;
  firstname?: string;
}

const USER_BASE_FILTER =
  "isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isGuid(v: string | undefined): v is string {
  return typeof v === 'string' && GUID_RE.test(v);
}

function fmtUserName(u: UserRow): string {
  return u.lastname && u.firstname ? `${u.lastname}, ${u.firstname}` : u.fullname;
}

function useTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: ['team', teamId],
    enabled: isGuid(teamId),
    retry: false,
    queryFn: () =>
      dv.get<SystemTeam>(ENTITY_SETS.team, teamId!, ['teamid', 'name', 'description', 'teamtype']),
  });
}

function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: ['teamMembers', teamId],
    enabled: isGuid(teamId),
    queryFn: () =>
      dv.list<TeamMember>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname'],
        $filter: `teammembership_association/any(t: t/teamid eq '${teamId}')`,
        $orderby: 'fullname asc',
      }),
    staleTime: 5 * 60 * 1000,
  });
}

function MemberChip({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
        {initials}
      </div>
      <span className="text-foreground">{name}</span>
    </div>
  );
}

export function TeamDetailPage() {
  const { teamId = '' } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const adminRole = useEffectiveAdminRole();
  const { data: team, isLoading, error } = useTeam(teamId);
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId);
  const { schedules, isLoading: schedulesLoading } = useTeamMemberSchedules(members);
  const lead = useTeamLead(teamId);
  const canEdit = useCanEditTeam(teamId);
  const canEditAnnouncement = useCanEditTeamAnnouncement(teamId);
  const canEditLead = useCanEditTeamLead();
  const announcement = useTeamAnnouncement(teamId);
  const userTeams = useCurrentUserTeams();
  const upsert = useUpsertSetting();
  const { data: appSettings } = useAppSettings();

  const [activeTab, setActiveTab] = useUrlState<TeamTab>('tab', 'bulletin', TEAM_TABS);
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [leadDraftId, setLeadDraftId] = useState('');

  const isMember = !!teamId && (userTeams?.has(teamId) ?? false);
  const showTogglesTab = canEdit;
  // Hide the activeTab if the user lands on /teams/:id?tab=toggles without
  // permission — fall back to bulletin so they don't see an empty tab body.
  const visibleTab: TeamTab = activeTab === 'toggles' && !showTogglesTab ? 'bulletin' : activeTab;

  const searchUsers = useCallback(async (query: string) => {
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

  const resolveUserLabel = useCallback(async (id: string) => {
    if (!id) return '';
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, [
      'systemuserid', 'fullname', 'lastname', 'firstname',
    ]);
    return fmtUserName(u);
  }, []);

  function openLeadDialog() {
    setLeadDraftId(lead?.leadId ?? '');
    setLeadDialogOpen(true);
  }

  async function handleSaveLead() {
    try {
      await upsert.mutateAsync({ key: teamLeadKey(teamId), value: leadDraftId });
      toast.success(leadDraftId ? 'Team lead updated.' : 'Team lead cleared.');
      setLeadDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t save team lead: ${msg}`);
    }
  }

  if (!isGuid(teamId)) {
    return (
      <div className="space-y-3">
        <PageHeader title="Team" showBack onBack={() => navigate('/teams')} />
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-foreground font-medium">That team id isn’t valid.</p>
          <p className="text-xs text-muted-foreground mt-1">
            The URL didn’t contain a Dataverse team GUID. Go back to the team list
            and pick a team from there.
          </p>
        </div>
      </div>
    );
  }

  // Build the header title:
  //   - Use the admin-configured display name from pmo_appsetting (via
  //     resolveSidebarTeamName) if set; otherwise fall back to the raw
  //     team name. Admins set the display name from Admin > Sidebar Teams.
  //   - Append " - Office Group" / " - Security Group" for AAD-linked
  //     teams so it's clear at the top of the page which kind of team
  //     you're on (the sidebar pill deliberately doesn't include this
  //     designation).
  const headerTitle = (() => {
    const base = team?.teamid
      ? resolveSidebarTeamName(team.teamid, team.name ?? 'Team', appSettings)
      : (team?.name ?? 'Team');
    const typeSuffix = team?.teamtype != null ? teamTypeHeaderLabel(team.teamtype) : '';
    return typeSuffix ? `${base} - ${typeSuffix}` : base;
  })();

  return (
    <div className="space-y-5">
      <PageHeader
        title={headerTitle}
        subtitle={
          team?.description
            ? team.description
            : isMember
              ? 'You are a member of this team.'
              : adminRole !== 'none'
                ? 'Viewing as administrator.'
                : 'You are not a member of this team.'
        }
        showBack
        onBack={() => navigate('/teams')}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Team Lead:</span>
              {lead ? (
                <span className="font-medium text-foreground">{lead.leadName}</span>
              ) : (
                <span className="italic text-muted-foreground">No team lead set</span>
              )}
            </div>
            {canEditLead && (
              <Button size="sm" variant="outline" onClick={openLeadDialog}>
                <UserCog className="h-3.5 w-3.5 mr-1.5" />
                {lead ? 'Edit Lead' : 'Set Lead'}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <LoadingOverlay isLoading />
      ) : (
        <Tabs value={visibleTab} onValueChange={(v) => setActiveTab(v as TeamTab)}>
          <div className="overflow-x-auto">
            <TabsList className="bg-muted/30 flex w-max min-w-full">
              <TabsTrigger value="bulletin">
                <MessagesSquare className="h-3.5 w-3.5 mr-1.5" />
                Bulletin
              </TabsTrigger>
              <TabsTrigger value="announcement">
                <Megaphone className="h-3.5 w-3.5 mr-1.5" />
                Announcement
              </TabsTrigger>
              {showTogglesTab && (
                <TabsTrigger value="toggles">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Feature Toggles
                </TabsTrigger>
              )}
              <TabsTrigger value="scheduling">
                <GanttChartSquare className="h-3.5 w-3.5 mr-1.5" />
                Scheduling
              </TabsTrigger>
              <TabsTrigger value="members">
                <Users className="h-3.5 w-3.5 mr-1.5" />
                Members
                <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">
                  ({membersLoading ? '…' : members.length})
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Bulletin */}
          <TabsContent value="bulletin" className="mt-6">
            <BulletinFeed teamId={teamId} teamName={team?.name ?? 'this team'} />
          </TabsContent>

          {/* Announcement */}
          <TabsContent value="announcement" className="mt-6 max-w-2xl">
            {canEditAnnouncement ? (
              <TeamAnnouncementEditor teamId={teamId} />
            ) : (
              <div className="space-y-1.5 rounded-xl border border-border bg-card p-5">
                {announcement.title ? (
                  <p className="text-sm font-medium text-foreground">{announcement.title}</p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    No announcement title set.
                  </p>
                )}
                {announcement.body ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {announcement.body}
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    No announcement body authored.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground italic pt-2">
                  You are not a member of this team, so you cannot post its announcement.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Feature Toggles */}
          {showTogglesTab && (
            <TabsContent value="toggles" className="mt-6">
              <FeatureToggleSection
                storageKey={teamTogglesKey(teamId)}
                scopeLabel={team?.name ?? 'this team'}
              />
            </TabsContent>
          )}

          {/* Scheduling */}
          <TabsContent value="scheduling" className="mt-6">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Forecast timeline of each member across the projects they manage, by
                project start and end dates. Click a bar to open the project.
              </p>
              <TeamSchedulingGantt schedules={schedules} loading={membersLoading || schedulesLoading} />
            </div>
          </TabsContent>

          {/* Members */}
          <TabsContent value="members" className="mt-6 max-w-3xl">
            <div className="rounded-xl border border-border bg-card p-5">
              {membersLoading ? (
                <p className="text-xs text-muted-foreground">Loading members…</p>
              ) : members.length === 0 ? (
                <p className="text-xs text-muted-foreground">No members assigned to this team.</p>
              ) : (
                <div className="space-y-0.5 max-h-96 overflow-y-auto">
                  {members.map((m) => (
                    <MemberChip key={m.systemuserid} name={m.fullname} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Lead-edit dialog */}
      <Dialog open={leadDialogOpen} onOpenChange={(o) => { if (!o) setLeadDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Designate Team Lead</DialogTitle>
            <DialogDescription>
              The team lead can edit the team announcement popup and per-team
              feature-toggle overrides for {team?.name ?? 'this team'}. Leave blank
              to clear.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 pt-2">
            <SearchableSelect
              value={leadDraftId}
              onChange={setLeadDraftId}
              onSearch={searchUsers}
              resolveLabel={resolveUserLabel}
              placeholder="— None —"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button variant="secondary" size="sm" onClick={() => setLeadDialogOpen(false)} disabled={upsert.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveLead} disabled={upsert.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
