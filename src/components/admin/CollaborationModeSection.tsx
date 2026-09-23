/**
 * Admin → Architecture & Templates → Collaboration.
 *
 * Global toggle between Team-based and Individual collaboration modes on the
 * project Collaborate tab.
 *
 *   Team-based (default) — adds/removes whole teams; pmo_projectteam rows.
 *   Individual — search for a person or team, grant access to specific users;
 *                pmo_projectcollaborator rows.
 *
 * Switching mode is non-destructive: existing grants of either type remain in
 * effect. Only the search/add UI and go-forward Add path change.
 */
import { useState } from 'react';
import { Users, User, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { toast } from '../../hooks/useToast';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import {
  coerceCollaborationMode,
  COLLABORATION_MODE_SETTING_KEY,
  type CollaborationMode,
} from '../../lib/collaborationMode';

const OPTIONS: Array<{
  value: CollaborationMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'team',
    label: 'Team-based (current)',
    description:
      'Add and remove whole teams on each project. Every member of a Contributing team gets edit access. Uses the existing pmo_projectteam roster.',
    icon: Users,
  },
  {
    value: 'individual',
    label: 'Individual',
    description:
      'Search for a person or a team. Selecting a team expands it to a per-member checklist so you can grant access to specific individuals. Adds do not need a team match — any user can be added directly.',
    icon: User,
  },
];

export function CollaborationModeSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const [saving, setSaving] = useState(false);

  const currentMode = coerceCollaborationMode(
    settings.find((s) => s.pmo_key === COLLABORATION_MODE_SETTING_KEY)?.pmo_value,
  );

  async function handleSelect(mode: CollaborationMode) {
    if (mode === currentMode || saving) return;
    setSaving(true);
    const oldValue = settings.find((s) => s.pmo_key === COLLABORATION_MODE_SETTING_KEY)?.pmo_value ?? null;
    try {
      await upsert.mutateAsync({ key: COLLABORATION_MODE_SETTING_KEY, value: mode });
      audit({ settingKey: COLLABORATION_MODE_SETTING_KEY, oldValue, newValue: mode });
      toast.success(
        mode === 'individual'
          ? 'Switched to Individual mode. Existing team grants are unchanged.'
          : 'Switched to Team-based mode. Existing individual grants remain active.',
      );
    } catch (err) {
      toast.error('Failed to save collaboration mode. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">Collaboration</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Controls how access is granted on the project Collaborate tab. Switching never
          removes existing grants — only the search and add experience changes.
        </p>
      </div>

      <div className="space-y-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = currentMode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              disabled={saving}
              className={[
                'w-full text-left rounded-lg border px-4 py-3 flex items-start gap-3 transition-colors',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:bg-muted/30',
                saving ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className={[
                'flex h-8 w-8 items-center justify-center rounded-md shrink-0 mt-0.5',
                selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {saving && selected ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{opt.label}</p>
                  {selected && (
                    <span className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {currentMode === 'individual' && (
        <p className="text-xs text-muted-foreground mt-3 px-1">
          <strong>Note:</strong> Switching back to Team-based at any time will restore the
          team-based search UI. Existing individual grants on projects remain active
          and must be removed manually from each project's Collaborate tab if desired.
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleSelect(currentMode === 'team' ? 'individual' : 'team')}
          disabled={saving}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Switch to {currentMode === 'team' ? 'Individual' : 'Team-based'}
        </Button>
      </div>
    </div>
  );
}
