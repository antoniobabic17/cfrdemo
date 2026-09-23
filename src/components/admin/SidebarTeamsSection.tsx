/**
 * Admin > Operations > Sidebar Teams
 *
 * Controls which teams appear as pills in the left navigation "Teams"
 * section AND how each team's name is displayed there.
 *
 * Two lists:
 *
 *   1. "In the sidebar right now" -- every team currently flagged with
 *      pmo_pmoteam = true, with a Rename button (opens the display-name
 *      dialog) and a Remove button. Legacy custom Owner Teams show with
 *      an amber banner so they can be retired cleanly.
 *
 *   2. "Available to add" -- every AAD Security Group + AAD Office Group
 *      team NOT currently flagged. Owner Teams (type 0) are DELIBERATELY
 *      EXCLUDED per the operator's policy: every sidebar team must be
 *      linked to an AAD group so membership stays in lockstep with the
 *      source of truth in Azure AD / Microsoft 365.
 *
 * Naming flow:
 *   Clicking Add on an "Available" team opens a small dialog that
 *   pre-fills the display name with `displayTeamName(rawName)` -- the
 *   stripped-prefix version (e.g. "Business Intelligence" for the AAD
 *   team "Coram Finance RevCycle - Business Intelligence"). The admin
 *   can accept the pre-fill, edit it, or clear it (empty falls back to
 *   the raw Dataverse name). On confirm the script:
 *     - upserts pmo_appsetting['sidebar.teamName.<teamid>'] = <name>
 *     - flips pmo_pmoteam=true on the team
 *   Both writes are best-effort; the flag write is what actually shows
 *   the team, and the name is a display override.
 *
 * Clicking Rename on a flagged team opens the same dialog with the
 * current setting value pre-filled. Save updates only the setting.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { useAppMutation } from '../../hooks/useAppMutation';
import { Users, Plus, X, RefreshCw, Loader2, AlertCircle, Pencil, SlidersHorizontal, GripVertical } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from '../../hooks/useToast';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useWriteGuard, WriteForbiddenError } from '../../hooks/useWriteGuard';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import {
  fetchSidebarEligibleTeams,
  fetchFlaggedSidebarTeams,
  setTeamSidebarFlag,
  teamTypeLabel,
  TEAM_TYPE,
  displayTeamName,
  sidebarTeamNameSettingKey,
  resolveSidebarTeamName,
  ensureTeamHasCfrPmoRole,
  SIDEBAR_TEAM_ORDER_SETTING_KEY,
  type EligibleSidebarTeam,
  type FlaggedSidebarTeam,
} from '../../lib/pmoTeams';
import { TeamTabVisibilityDialog } from './TeamTabVisibilityDialog';

/** Payload for the name-editing dialog. `flagged` distinguishes Add (false ->
 *  flag on save) from Rename (true -> flag already set, just update name). */
interface NameDialogState {
  teamid: string;
  rawName: string;
  suggested: string;
  isAdd: boolean;
}

export function SidebarTeamsSection() {
  const pmoTeamField = usePmoTeamField();
  const qc = useQueryClient();
  const [addSearch, setAddSearch] = useState('');
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [tabsDialog, setTabsDialog] = useState<{ teamid: string; name: string } | null>(null);
  // Drag-and-drop state (mirrors TableViewsSection pattern).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dialogInput, setDialogInput] = useState('');

  const flaggedQuery = useQuery({
    queryKey: ['sidebarTeams', 'flagged', pmoTeamField] as const,
    queryFn: () => fetchFlaggedSidebarTeams(pmoTeamField),
    staleTime: 60 * 1000,
  });
  const eligibleQuery = useQuery({
    queryKey: ['sidebarTeams', 'eligible', pmoTeamField] as const,
    queryFn: () => fetchSidebarEligibleTeams(pmoTeamField),
    staleTime: 60 * 1000,
  });
  const { data: appSettings } = useAppSettings();
  const upsertSetting = useUpsertSetting();
  const guard = useWriteGuard();

  const toggleMutation = useAppMutation({
    action: 'toggle team on sidebar',
    entityType: 'team',
    entityId: (args: { teamId: string; flagged: boolean }) => args.teamId,
    mutationFn: (args: { teamId: string; flagged: boolean }) => {
      // Sidebar-team flag is a global config toggle -- admins only.
      const v = guard('pmo_admin');
      if (!v.allow) throw new WriteForbiddenError(v.reason ?? 'Not allowed.', v.requiredRole);
      return setTeamSidebarFlag(args.teamId, pmoTeamField, args.flagged);
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['sidebarTeams'] });
      qc.invalidateQueries({ queryKey: ['allPmoTeams'] });
      if (!args.flagged) toast.success('Removed from sidebar');
    },
  });

  const flagged: FlaggedSidebarTeam[] = flaggedQuery.data ?? [];
  const eligible: EligibleSidebarTeam[] = eligibleQuery.data ?? [];
  const flaggedAad = flagged.filter((t) => t.teamtype === TEAM_TYPE.OfficeGroup || t.teamtype === TEAM_TYPE.SecurityGroup);
  const flaggedLegacy = flagged.filter((t) => t.teamtype !== TEAM_TYPE.OfficeGroup && t.teamtype !== TEAM_TYPE.SecurityGroup);

  // Apply admin-saved order to the "In the sidebar" list. Teams not yet in
  // the saved array are appended after the ordered ones, alphabetically.
  const savedOrderRaw = appSettings?.find((s) => s.pmo_key === SIDEBAR_TEAM_ORDER_SETTING_KEY)?.pmo_value;
  const savedOrder: string[] = (() => {
    if (!savedOrderRaw) return [];
    try { const v = JSON.parse(savedOrderRaw); return Array.isArray(v) ? v.map((x: unknown) => String(x)) : []; }
    catch { return []; }
  })();

  // orderedFlagged: ordered first by savedOrder, then alphabetically for extras.
  const orderedFlagged = useMemo(() => {
    const all = [...flaggedAad, ...flaggedLegacy];
    const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
    return [...all].sort((a, b) => {
      const ai = orderMap.has(a.teamid) ? orderMap.get(a.teamid)! : Infinity;
      const bi = orderMap.has(b.teamid) ? orderMap.get(b.teamid)! : Infinity;
      if (ai !== bi) return ai - bi;
      return a.teamid < b.teamid ? -1 : 1; // stable tiebreak
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedAad, flaggedLegacy, savedOrderRaw]);

  function handleDrop(draggedId: string, targetId: string) {
    const ids = orderedFlagged.map((t) => t.teamid);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedId);
    void upsertSetting.mutateAsync({ key: SIDEBAR_TEAM_ORDER_SETTING_KEY, value: JSON.stringify(next) }).then(() => {
      qc.invalidateQueries({ queryKey: ['appSettings'] });
    });
  }

  const availableToAdd = useMemo(() => {
    const unflagged = eligible.filter((t) => !t.flagged);
    const q = addSearch.trim().toLowerCase();
    if (!q) return unflagged;
    return unflagged.filter((t) => t.name.toLowerCase().includes(q));
  }, [eligible, addSearch]);

  const loading = flaggedQuery.isPending || eligibleQuery.isPending;
  const error = flaggedQuery.error || eligibleQuery.error;

  function openAddDialog(team: EligibleSidebarTeam) {
    const suggested = displayTeamName(team.name);
    setNameDialog({ teamid: team.teamid, rawName: team.name, suggested, isAdd: true });
    setDialogInput(suggested);
  }

  function openRenameDialog(team: FlaggedSidebarTeam) {
    const current = resolveSidebarTeamName(team.teamid, team.name, appSettings);
    setNameDialog({
      teamid: team.teamid,
      rawName: team.name,
      suggested: displayTeamName(team.name),
      isAdd: false,
    });
    setDialogInput(current);
  }

  async function confirmNameDialog() {
    if (!nameDialog) return;
    const { teamid, isAdd } = nameDialog;
    const value = dialogInput.trim();
    const key = sidebarTeamNameSettingKey(teamid);
    try {
      // Order matters: save the display-name setting FIRST so that when
      // the flag flip fires and the sidebar re-renders, the override is
      // already in the appSettings cache (via useUpsertSetting's
      // optimistic setQueryData) and gets picked up on the same tick.
      await upsertSetting.mutateAsync({ key, value });
      if (isAdd) {
        await toggleMutation.mutateAsync({ teamId: teamid, flagged: true });
        // Auto-assign the CFR PMO Team security role so every AAD member of
        // this team inherits User-scope Create/Write/Delete/Append/AppendTo
        // on msdyn_projectbucket / msdyn_projecttask / msdyn_operationset
        // etc. Combined with the record-level shares maintained by
        // app/src/lib/projectAccess.ts, this is what lets team members
        // actually work on projects assigned to their team as Primary or
        // Contributing. NOT giving them CFR PMO Administrator -- that stays
        // on a small controlled team. Best-effort: role-assignment failure
        // does not block the flag flip.
        const roleResult = await ensureTeamHasCfrPmoRole(teamid);
        const baseMsg = value ? `Added "${value}" to the sidebar` : 'Added to sidebar';
        if (roleResult.success) {
          // Assigned now, or already had it — either way the team is fully set up.
          toast.success(roleResult.alreadyAssigned ? baseMsg : `${baseMsg} + CFR PMO Team role`);
        } else {
          // Role assignment could not run from the app (the Code Apps SDK cannot do
          // N:N associates in this build). The team IS on the sidebar; the role just
          // needs assigning out-of-band. Surface it as guidance, not a scary error.
          toast.success(
            `${baseMsg}. To let its members edit their projects, assign the ` +
            `"CFR PMO Team" role via scripts/assign-cfr-pmo-team-role.py or the ` +
            `Power Platform admin portal.`,
          );
        }
      } else {
        toast.success(value ? `Renamed to "${value}"` : 'Reset to team default name');
      }
      // Force the sidebar's own team-list query to refetch. Sidebar reads
      // team names from useAllPmoTeams (which caches on ['allPmoTeams'])
      // and the display override from useAppSettings; the latter is
      // already patched optimistically by useUpsertSetting, but the flag
      // flip in the Add path also affects which teams the sidebar
      // considers PMO teams, so invalidate that too.
      qc.invalidateQueries({ queryKey: ['allPmoTeams'] });
      setNameDialog(null);
      setDialogInput('');
    } catch (err) {
      // toast.error handled globally via MutationCache
      // eslint-disable-next-line no-console
      console.warn('[SidebarTeamsSection] name save failed', err);
    }
  }

  const dialogBusy = upsertSetting.isPending || toggleMutation.isPending;

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Sidebar Teams
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Controls which teams appear in the left navigation and how each one is labeled.
              Only AAD Security Group and AAD Office Group teams can be added — membership
              stays in lockstep with the source of truth in Azure AD / Microsoft 365. When
              adding a team you'll be asked to confirm the display name that shows in the
              sidebar; click Rename on any pinned team to change it later. Adding a team
              also grants that team the <span className="font-medium">CFR PMO Team</span> role
              so its members can work on projects where their team is Primary or on the
              Collaborate tab. (Administrator access is <span className="font-medium">not</span> granted —
              only record-scoped edit rights via existing project shares.)
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ['sidebarTeams'] })}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Failed to load teams: {(error as Error).message}</span>
        </div>
      )}

      {/* Currently in sidebar */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2 border-b border-border/60 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            In the sidebar right now
          </p>
          <span className="text-xs text-muted-foreground tabular-nums">
            {flagged.length} team{flagged.length === 1 ? '' : 's'}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : flagged.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            No teams pinned to the sidebar. Add one from the list below.
          </p>
        ) : (
          <div>
            {flaggedLegacy.length > 0 && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800">
                {flaggedLegacy.length} legacy custom Owner Team{flaggedLegacy.length === 1 ? '' : 's'} still pinned.
                The policy is AAD-only — remove these and pin their AAD counterparts.
              </div>
            )}
            <ul className="divide-y divide-border/60">
              {orderedFlagged.map((t) => {
                const isLegacy = t.teamtype !== TEAM_TYPE.OfficeGroup && t.teamtype !== TEAM_TYPE.SecurityGroup;
                const shownAs = resolveSidebarTeamName(t.teamid, t.name, appSettings);
                const hasOverride = shownAs !== t.name;
                return (
                  <li
                    key={t.teamid}
                    draggable
                    onDragStart={(e) => {
                      setDragId(t.teamid);
                      e.dataTransfer.setData('application/x-sidebar-team', t.teamid);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={dragId && dragId !== t.teamid ? (e) => {
                      if (e.dataTransfer.types.includes('application/x-sidebar-team')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverId !== t.teamid) setDragOverId(t.teamid);
                      }
                    } : undefined}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dragged = e.dataTransfer.getData('application/x-sidebar-team');
                      handleDrop(dragged, t.teamid);
                      setDragId(null); setDragOverId(null);
                    }}
                    onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 transition-colors',
                      dragId === t.teamid && 'opacity-40',
                      dragOverId === t.teamid && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
                    )}
                  >
                    {/* Drag handle */}
                    <span title="Drag to reorder" className="inline-flex shrink-0"><GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab active:cursor-grabbing" /></span>
                    <Users className={`h-3.5 w-3.5 shrink-0 ${isLegacy ? 'text-amber-600' : 'text-primary'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {teamTypeLabel(t.teamtype)}
                        {hasOverride && <> · shown as <span className="font-medium text-foreground">{shownAs}</span></>}
                        {isLegacy && ' — retire this and pin an AAD-linked team instead'}
                      </p>
                      {/* Team GUID under the type label. Rendered here so a
                          rename in Azure AD / M365 doesn't lose the operator's
                          ability to identify the underlying record. */}
                      <p className="font-mono text-[10px] text-muted-foreground/70 truncate select-all">
                        {t.teamid}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setTabsDialog({ teamid: t.teamid, name: resolveSidebarTeamName(t.teamid, t.name, appSettings) })}
                      title="Choose which left-nav tabs this team can see"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                      Tabs
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={toggleMutation.isPending || upsertSetting.isPending}
                      onClick={() => openRenameDialog(t)}
                      title="Change how this team's name appears in the sidebar"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate({ teamId: t.teamid, flagged: false })}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Available to add */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2 border-b border-border/60 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            Available to add
          </p>
          <div className="flex-1 max-w-xs">
            <Input
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              placeholder="Search AAD teams…"
              className="h-7 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {availableToAdd.length} of {eligible.filter((t) => !t.flagged).length}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : availableToAdd.length === 0 ? (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            {addSearch
              ? 'No AAD teams match that search.'
              : 'Every eligible AAD team is already in the sidebar.'}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 max-h-80 overflow-y-auto">
            {availableToAdd.map((t) => (
              <li key={t.teamid} className="flex items-center gap-3 px-4 py-2.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground">{teamTypeLabel(t.teamtype)}</p>
                  {/* Team GUID under the type label. Useful to track the
                      underlying record even after AAD renames the group. */}
                  <p className="font-mono text-[10px] text-muted-foreground/70 truncate select-all">
                    {t.teamid}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={toggleMutation.isPending || upsertSetting.isPending}
                  onClick={() => openAddDialog(t)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Name / Rename dialog. Same dialog for both flows -- the isAdd
          flag controls whether flipping the flag is part of the save. */}
      <Dialog open={!!nameDialog} onOpenChange={(open) => { if (!open) { setNameDialog(null); setDialogInput(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{nameDialog?.isAdd ? 'Add team to sidebar' : 'Rename sidebar team'}</DialogTitle>
            <DialogDescription>
              {nameDialog?.isAdd
                ? 'Choose how this team should appear in the left navigation. The default strips the "Coram Finance RevCycle -" prefix, but you can name it anything.'
                : 'Change how this team is labeled in the left navigation. Clear the field to fall back to the raw Dataverse team name.'}
            </DialogDescription>
          </DialogHeader>
          {nameDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Dataverse team: <span className="font-medium text-foreground">{nameDialog.rawName}</span>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">Sidebar display name</label>
                <Input
                  autoFocus
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  placeholder={nameDialog.rawName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !dialogBusy) { e.preventDefault(); void confirmNameDialog(); }
                  }}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {dialogInput.trim() === ''
                    ? `Empty — will show as "${nameDialog.rawName}" in the sidebar.`
                    : dialogInput.trim() === nameDialog.suggested
                      ? 'Using the suggested default.'
                      : 'Custom name.'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setNameDialog(null); setDialogInput(''); }} disabled={dialogBusy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmNameDialog()} disabled={dialogBusy}>
              {dialogBusy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {nameDialog?.isAdd ? 'Add to sidebar' : 'Save name'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tabsDialog && (
        <TeamTabVisibilityDialog
          key={tabsDialog.teamid}
          teamId={tabsDialog.teamid}
          teamName={tabsDialog.name}
          open={!!tabsDialog}
          onClose={() => setTabsDialog(null)}
        />
      )}
    </section>
  );
}
