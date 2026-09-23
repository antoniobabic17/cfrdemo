/**
 * TeamTabVisibilityDialog — admin editor for a team's left-nav tab ALLOWLIST.
 *
 * Opened from a per-team row in SidebarTeamsSection. Writes
 * `pmo.team_tabs.<teamId>` (see lib/teamTabVisibility.ts):
 *   - "No restriction" (default) => the setting is deleted/blank; the team sees
 *     the normal global nav. This is the net-neutral state.
 *   - "Restrict" => save the checked toggleKeys; members of this team then see
 *     ONLY those tabs (admins always bypass the allowlist).
 */
import { useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { useAppSettings, useUpsertSetting, useDeleteSetting } from '../../hooks/useAppSettings';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { NAV_TAB_CATALOG, ALL_NAV_TAB_KEYS } from '../../lib/navToggleCatalog';
import { teamTabsKey, parseTeamTabs, serializeTeamTabs } from '../../lib/teamTabVisibility';

interface Props {
  teamId: string;
  teamName: string;
  open: boolean;
  onClose: () => void;
}

export function TeamTabVisibilityDialog({ teamId, teamName, open, onClose }: Props) {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const del = useDeleteSetting();
  const audit = useAdminAudit();

  const key = teamTabsKey(teamId);
  const existing = useMemo(() => settings.find((s) => s.pmo_key === key), [settings, key]);
  const existingList = useMemo(() => parseTeamTabs(existing?.pmo_value), [existing]);

  // "restrict" mirrors whether an allowlist is in effect. Selected is the set of
  // allowed keys while restricting. The parent mounts this dialog CONDITIONALLY
  // (only while open, keyed per team), so these initializers run fresh on each
  // open — no sync effect needed.
  const [restrict, setRestrict] = useState<boolean>(existingList !== null);
  const [selected, setSelected] = useState<Set<string>>(new Set(existingList ?? ALL_NAV_TAB_KEYS));

  const busy = upsert.isPending || del.isPending;

  function toggleKey(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function save() {
    const oldValue = existing?.pmo_value ?? null;
    try {
      if (!restrict) {
        // No restriction: remove the setting so the team falls back to the
        // global nav (net-neutral). Deleting is a no-op if it never existed.
        if (existing) {
          await del.mutateAsync({ key });
          audit({ settingKey: key, oldValue, newValue: '' });
        }
        toast.success(`${teamName}: all tabs visible (no restriction)`);
      } else {
        const keys = ALL_NAV_TAB_KEYS.filter((k) => selected.has(k)); // stable order
        const newValue = serializeTeamTabs(keys);
        await upsert.mutateAsync({ key, value: newValue });
        audit({ settingKey: key, oldValue, newValue });
        toast.success(`${teamName}: restricted to ${keys.length} tab${keys.length === 1 ? '' : 's'}`);
      }
      onClose();
    } catch (err) {
      // global MutationCache surfaces the toast
      console.warn('[TeamTabVisibilityDialog] save failed', err);
    }
  }

  const selectedCount = ALL_NAV_TAB_KEYS.filter((k) => selected.has(k)).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tab visibility — {teamName}</DialogTitle>
          <DialogDescription>
            Choose which left-navigation tabs members of this team can see. Administrators
            always see all tabs regardless of this setting. Team-specific surfaces (e.g.
            Payer Initiatives) are controlled separately by their feature pack.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <label className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 cursor-pointer">
            <input
              type="radio"
              name="restrict-mode"
              checked={!restrict}
              onChange={() => setRestrict(false)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">No restriction</span>
              <span className="block text-xs text-muted-foreground">Members see the normal set of tabs (default).</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 cursor-pointer">
            <input
              type="radio"
              name="restrict-mode"
              checked={restrict}
              onChange={() => setRestrict(true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium text-foreground">Restrict to selected tabs</span>
              <span className="block text-xs text-muted-foreground">Members see only the tabs checked below ({selectedCount} selected).</span>
            </span>
          </label>

          {restrict && (
            <div className="rounded-md border border-border max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground">{selectedCount} of {ALL_NAV_TAB_KEYS.length} tabs</span>
                <div className="flex gap-2">
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(new Set(ALL_NAV_TAB_KEYS))}>Select all</button>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
              </div>
              {NAV_TAB_CATALOG.map((group) => (
                <div key={group.heading} className="px-3 py-2 border-b border-border/40 last:border-b-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">{group.heading}</p>
                  <div className="space-y-1">
                    {group.items.map((it) => (
                      <label key={it.key} className={cn('flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-accent/40')}>
                        <input type="checkbox" checked={selected.has(it.key)} onChange={() => toggleKey(it.key)} />
                        <span className="text-foreground">{it.label}</span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">{it.key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
