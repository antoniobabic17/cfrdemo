/**
 * AdminPrincipalsSection — Admin > Settings > System.
 *
 * Manages `pmo.admin_principals_json`: WHO is granted app admin (pmo_admin) in
 * ADDITION to the Dataverse role-name checks in resolveAdminRole. Three lists:
 *   - Team GUIDs (any member is admin) — seeded at first-time setup with the
 *     existing admin team.
 *   - Individual user AAD object ids.
 *   - Group AAD object ids.
 *
 * ADDITIVE + SAFE: this never removes role-name admins; it only adds. system_admin
 * gated (see settingKeyRoles). Changes take effect on the affected user's next
 * app load (admin role is resolved once at startup).
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, ShieldCheck, Users, User, UsersRound } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from '../../hooks/useToast';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import {
  SETTING_ADMIN_PRINCIPALS,
  parseAdminPrincipals,
  serializeAdminPrincipals,
  type AdminPrincipals,
} from '../../lib/adminPrincipals';

type ListKey = keyof AdminPrincipals;

const LISTS: { key: ListKey; label: string; help: string; placeholder: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'teamIds', label: 'Admin Teams (by GUID)', help: 'Any member of these Dataverse teams is an app administrator.', placeholder: 'team GUID', icon: Users },
  { key: 'userObjectIds', label: 'Individual Users (AAD object id)', help: 'These specific users are app administrators.', placeholder: 'user AAD object id', icon: User },
  { key: 'groupObjectIds', label: 'Groups (AAD object id)', help: 'Members of these Entra groups are app administrators (matched where group membership is available).', placeholder: 'group AAD object id', icon: UsersRound },
];

export function AdminPrincipalsSection() {
  const { data: settings = [] } = useAppSettings();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();

  const existing = useMemo(() => settings.find((s) => s.pmo_key === SETTING_ADMIN_PRINCIPALS), [settings]);
  const principals = useMemo(() => parseAdminPrincipals(existing?.pmo_value), [existing]);

  const [drafts, setDrafts] = useState<Record<ListKey, string>>({ teamIds: '', userObjectIds: '', groupObjectIds: '' });
  const [saving, setSaving] = useState(false);

  async function persist(next: AdminPrincipals) {
    setSaving(true);
    const oldValue = existing?.pmo_value ?? null;
    const newValue = serializeAdminPrincipals(next);
    try {
      await upsert.mutateAsync({ key: SETTING_ADMIN_PRINCIPALS, value: newValue });
      audit({ settingKey: SETTING_ADMIN_PRINCIPALS, oldValue, newValue });
      qc.invalidateQueries({ queryKey: ['appSettings'] });
      toast.success('Admin access updated');
    } finally {
      setSaving(false);
    }
  }

  function add(list: ListKey) {
    const v = drafts[list].trim();
    if (!v) return;
    const current = principals[list];
    if (current.some((x) => x.toLowerCase() === v.toLowerCase())) {
      toast.info('Already in the list');
      return;
    }
    const next: AdminPrincipals = { ...principals, [list]: [...current, v] };
    setDrafts((d) => ({ ...d, [list]: '' }));
    void persist(next);
  }

  function remove(list: ListKey, value: string) {
    const next: AdminPrincipals = { ...principals, [list]: principals[list].filter((x) => x !== value) };
    void persist(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Admin Access
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          Who is granted application administrator access, in addition to users holding the
          Dataverse <span className="font-medium">System Administrator</span> or
          <span className="font-medium"> CFR PMO Administrator</span> roles. This list only
          <span className="font-medium"> adds</span> admins — it cannot remove role-based admins.
          Changes take effect on the affected user's next app load.
        </p>
      </div>

      <div className="space-y-4 max-w-lg">
        {LISTS.map(({ key, label, help, placeholder, icon: Icon }) => (
          <div key={key} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-muted-foreground" />{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{help}</p>
            </div>
            {principals[key].length > 0 ? (
              <ul className="space-y-1">
                {principals[key].map((v) => (
                  <li key={v} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1">
                    <span className="flex-1 font-mono text-[11px] text-foreground break-all select-all">{v}</span>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5" disabled={saving} onClick={() => remove(key, v)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground/70 italic">None.</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={drafts[key]}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={placeholder}
                className="font-mono text-xs h-8"
                onKeyDown={(e) => { if (e.key === 'Enter' && !saving) { e.preventDefault(); add(key); } }}
              />
              <Button size="sm" disabled={saving || !drafts[key].trim()} onClick={() => add(key)}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
