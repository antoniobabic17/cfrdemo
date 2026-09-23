/**
 * Admin → Architecture & Templates → Resourcing.
 *
 * Two subsections:
 *   • Financial Metrics — placeholder (nothing configurable yet).
 *   • Labor Hours — opt an entire team into the New Resource Model. Enabling a
 *     team snapshots every project's current NRM value, flips all LABOR projects
 *     on, and sets a per-team default so NEW projects for that team start on the
 *     new model. Disabling clears the default and either restores the snapshot
 *     or forces every project to the old model (admin chooses).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Users2, Layers } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { useAppSettings, useUpsertSetting, useDeleteSetting } from '../../hooks/useAppSettings';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';
import { fetchPmoTeams } from '../../lib/pmoTeams';
import {
  SETTING_TEAM_NRM_DEFAULT_PREFIX,
  SETTING_TEAM_NRM_SNAPSHOT_PREFIX,
} from '../../lib/constants';
import {
  listTeamProjects,
  buildNrmSnapshot,
  enableNrmForTeamProjects,
  disableNrmForTeamProjects,
} from '../../api/teamResourceModel.api';
import { toast } from '../../hooks/useToast';

interface Team { teamid: string; name: string }

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

export function ResourcingSection() {
  const pmoTeamField = usePmoTeamField();
  const { data: teams = [] } = useQuery({
    queryKey: ['systemTeams', pmoTeamField],
    queryFn: () => fetchPmoTeams<Team>(pmoTeamField, ['teamid', 'name']),
    staleTime: 5 * 60 * 1000,
  });
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const del = useDeleteSetting();
  const qc = useQueryClient();

  // Which teams are currently opted in (default flag === 'true').
  const optedInTeams = useMemo(() => {
    const set = new Set<string>();
    for (const s of settings) {
      if (s.pmo_key?.startsWith(SETTING_TEAM_NRM_DEFAULT_PREFIX) && s.pmo_value === 'true') {
        set.add(s.pmo_key.slice(SETTING_TEAM_NRM_DEFAULT_PREFIX.length));
      }
    }
    return set;
  }, [settings]);

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [dialog, setDialog] = useState<null | { mode: 'enable' | 'disable'; teamId: string; teamName: string }>(null);
  const [busy, setBusy] = useState(false);

  const selectedTeamName = teams.find((t) => t.teamid === selectedTeamId)?.name ?? '';
  const selectedIsOptedIn = selectedTeamId ? optedInTeams.has(selectedTeamId) : false;

  async function runEnable(teamId: string) {
    setBusy(true);
    try {
      const rows = await listTeamProjects(teamId);
      // 1) Snapshot the prior mix so a later disable can restore it exactly.
      await upsert.mutateAsync({
        key: `${SETTING_TEAM_NRM_SNAPSHOT_PREFIX}${teamId}`,
        value: JSON.stringify(buildNrmSnapshot(rows)),
      });
      // 2) Flip every labor project on.
      const res = await enableNrmForTeamProjects(rows);
      // 3) Set the per-team default for NEW projects.
      await upsert.mutateAsync({ key: `${SETTING_TEAM_NRM_DEFAULT_PREFIX}${teamId}`, value: 'true' });
      qc.invalidateQueries({ queryKey: ['projects'] });
      const skip = res.skippedFinancial > 0 ? ` (${res.skippedFinancial} financial project${res.skippedFinancial === 1 ? '' : 's'} skipped)` : '';
      toast.success(`New Resource Model enabled: ${res.changed} project${res.changed === 1 ? '' : 's'} updated${skip}. New projects for this team now default on.`);
      if (res.errors.length) toast.error(`${res.errors.length} project(s) failed to update — see console.`);
      if (res.errors.length) console.warn('[NRM enable] errors', res.errors);
    } catch (err) {
      toast.error(`Couldn’t enable the New Resource Model: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  async function runDisable(teamId: string, restore: boolean) {
    setBusy(true);
    try {
      const rows = await listTeamProjects(teamId);
      let snapshot: Record<string, boolean> | null = null;
      if (restore) {
        const snapRow = settings.find((s) => s.pmo_key === `${SETTING_TEAM_NRM_SNAPSHOT_PREFIX}${teamId}`);
        if (snapRow?.pmo_value) {
          try { snapshot = JSON.parse(snapRow.pmo_value) as Record<string, boolean>; } catch { snapshot = null; }
        }
      }
      const res = await disableNrmForTeamProjects(rows, snapshot);
      // Clear the default flag so new projects stop defaulting on.
      await del.mutateAsync({ key: `${SETTING_TEAM_NRM_DEFAULT_PREFIX}${teamId}` });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(
        restore
          ? `Restored ${res.changed} project${res.changed === 1 ? '' : 's'} to their previous model. New-project default cleared.`
          : `Set ${res.changed} project${res.changed === 1 ? '' : 's'} to the old model. New-project default cleared.`,
      );
      if (res.errors.length) toast.error(`${res.errors.length} project(s) failed to update — see console.`);
      if (res.errors.length) console.warn('[NRM disable] errors', res.errors);
    } catch (err) {
      toast.error(`Couldn’t disable the New Resource Model: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Resourcing" description="Configure how teams track project resourcing." />

      {/* Financial Metrics — placeholder */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Financial Metrics</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Team-level financial resourcing configuration will live here. Nothing to configure yet.
        </p>
      </div>

      {/* Labor Hours — team New Resource Model opt-in */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Labor Hours</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Enable the New Resource Model for an entire team. When enabled, every one of the
          team’s labor projects is switched to the new model and new projects for that team
          default to it. Admins can still toggle individual projects afterward.
        </p>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Team</label>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="block w-72 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select a team…</option>
              {teams.map((t) => (
                <option key={t.teamid} value={t.teamid}>
                  {t.name}{optedInTeams.has(t.teamid) ? '  • enabled' : ''}
                </option>
              ))}
            </select>
          </div>
          {selectedTeamId && !selectedIsOptedIn && (
            <Button size="sm" disabled={busy} onClick={() => setDialog({ mode: 'enable', teamId: selectedTeamId, teamName: selectedTeamName })}>
              Enable New Resource Model
            </Button>
          )}
          {selectedTeamId && selectedIsOptedIn && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ mode: 'disable', teamId: selectedTeamId, teamName: selectedTeamName })}>
              Disable for this team
            </Button>
          )}
        </div>

        {optedInTeams.size > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Currently enabled for {optedInTeams.size} team{optedInTeams.size === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      {/* Enable confirm */}
      <Dialog open={dialog?.mode === 'enable'} onOpenChange={(o) => { if (!o && !busy) setDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enable the New Resource Model for {dialog?.teamName}?</DialogTitle>
            <DialogDescription className="pt-1 text-xs leading-relaxed">
              This will switch <strong>every existing labor project</strong> whose primary team is
              {' '}{dialog?.teamName} to the New Resource Model, and make <strong>new projects</strong>
              {' '}for this team default to it. Financial projects are left unchanged. Each project’s
              current setting is saved first so you can restore it if you disable later. Admins can
              still toggle individual projects afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={busy} onClick={() => dialog && runEnable(dialog.teamId)}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable confirm — restore vs all-old */}
      <Dialog open={dialog?.mode === 'disable'} onOpenChange={(o) => { if (!o && !busy) setDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable the New Resource Model for {dialog?.teamName}?</DialogTitle>
            <DialogDescription className="pt-1 text-xs leading-relaxed">
              New projects for {dialog?.teamName} will stop defaulting to the New Resource Model.
              Choose what to do with the team’s existing projects:
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs text-muted-foreground space-y-2 py-1">
            <p><strong>Restore previous</strong> — put each project back to the model it used before this team was enabled.</p>
            <p><strong>Set all to old model</strong> — turn the New Resource Model off for every one of the team’s projects.</p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => dialog && runDisable(dialog.teamId, false)}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Set all to old model
            </Button>
            <Button size="sm" disabled={busy} onClick={() => dialog && runDisable(dialog.teamId, true)}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Restore previous
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
