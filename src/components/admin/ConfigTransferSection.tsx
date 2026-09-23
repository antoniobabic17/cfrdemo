/**
 * ConfigTransferSection — Admin > Settings > System.
 *
 * Export the environment's `pmo_appsetting` config as a JSON bundle, and import
 * a bundle into this environment (preview + MERGE; never deletes). See
 * lib/configPortability.ts for the bundle format + classification, and
 * docs/DEPLOYMENT-PACKAGE.md for how this fits the full new-tenant flow.
 *
 * Safety: export is read-only. Import writes via the SAME role-gated
 * useUpsertSetting every admin edit uses, only for keys the admin checks, behind
 * an explicit preview. Identity/secret keys are DESELECTED by default so a
 * cross-env import can't clobber identity or leak a secret. Malformed JSON values
 * are blocked from writing. system_admin-gated (mounted in the System tab).
 */
import { useRef, useState } from 'react';
import { Download, Upload, Loader2, ShieldAlert, KeyRound, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { useAppSettings, useUpsertSetting } from '../../hooks/useAppSettings';
import { useAdminAudit } from '../../hooks/useAdminAudit';
import { useConfig } from '../../providers/ConfigurationProvider';
import { getCachedEnvironmentId } from '../../lib/deepLink';
import {
  buildBundle, serializeBundle, parseBundle, diffImport, BundleParseError,
  type ImportDiffRow, type KeyClass,
} from '../../lib/configPortability';

const CLASS_BADGE: Record<KeyClass, { label: string; cls: string; icon?: React.ComponentType<{ className?: string }> }> = {
  portable: { label: 'portable', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  identity: { label: 'identity', cls: 'bg-amber-100 text-amber-700 border-amber-300', icon: ShieldAlert },
  secret:   { label: 'secret',   cls: 'bg-rose-100 text-rose-700 border-rose-300', icon: KeyRound },
};

export function ConfigTransferSection() {
  const { data: settings = [] } = useAppSettings();
  const { config } = useConfig();
  const upsert = useUpsertSetting();
  const audit = useAdminAudit();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [diff, setDiff] = useState<ImportDiffRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // ── Export ──
  function handleExport() {
    const bundle = buildBundle(
      settings.map((s) => ({ pmo_key: s.pmo_key, pmo_value: s.pmo_value ?? null })),
      { envLabel: config.environmentLabel, envId: getCachedEnvironmentId(), appVersion: __APP_SEMVER__ },
    );
    const text = serializeBundle(bundle);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const label = (config.environmentLabel ?? 'env').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cfr-pmo-config-${label}-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${bundle.manifest.rowCount} settings`);
  }

  // ── Import: load + preview ──
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = parseBundle(String(reader.result ?? ''));
        const current = settings.map((s) => ({ pmo_key: s.pmo_key, pmo_value: s.pmo_value ?? null }));
        const rows = diffImport(current, bundle.config);
        setDiff(rows);
        setSelected(new Set(rows.filter((r) => r.defaultSelected).map((r) => r.key)));
      } catch (err) {
        const msg = err instanceof BundleParseError ? err.message : 'Could not read this file.';
        toast.error(msg);
      }
    };
    reader.onerror = () => toast.error('Could not read this file.');
    reader.readAsText(file);
  }

  function toggle(key: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  function cancelImport() { setDiff(null); setSelected(new Set()); }

  // ── Import: apply (merge upsert; never delete) ──
  async function applyImport() {
    if (!diff) return;
    const toApply = diff.filter((r) => selected.has(r.key) && !r.malformed && r.changeType !== 'unchanged');
    if (toApply.length === 0) { toast.info('Nothing selected to apply.'); return; }
    setApplying(true);
    let ok = 0; const skipped: string[] = [];
    for (const r of toApply) {
      try {
        await upsert.mutateAsync({ key: r.key, value: r.incomingValue ?? '' });
        audit({ settingKey: r.key, oldValue: r.currentValue, newValue: r.incomingValue ?? '' });
        ok += 1;
      } catch {
        // Most likely a per-key role gate (e.g. system_admin key). Report, don't abort.
        skipped.push(r.key);
      }
    }
    qc.invalidateQueries({ queryKey: ['appSettings'] });
    setApplying(false);
    setDiff(null);
    setSelected(new Set());
    if (skipped.length === 0) toast.success(`Applied ${ok} setting${ok === 1 ? '' : 's'}`);
    else toast.success(`Applied ${ok}; skipped ${skipped.length} (insufficient rights): ${skipped.join(', ')}`);
  }

  const selectableCount = diff?.filter((r) => selected.has(r.key) && !r.malformed && r.changeType !== 'unchanged').length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Download className="h-4 w-4 text-primary" />
          Configuration Export / Import
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          Export this environment's application settings as a JSON bundle (a full backup and
          the input to the new-tenant bootstrap), or import a bundle into this environment.
          The export also embeds a self-describing catalog of every config key — including
          ones not set here — with descriptions, defaults, and allowed values, so you can hand
          the file to an LLM and have it walk you through first-time setup. Import previews
          every change and only applies what you select — it never deletes settings.
          Environment identity and secret values are deselected by default so a bundle from
          another environment can't overwrite this one's identity.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export config bundle
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1.5" /> Import from file…
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFilePicked} />
      </div>

      {diff && (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground">
              Import preview — {selectableCount} change{selectableCount === 1 ? '' : 's'} selected of {diff.length} row{diff.length === 1 ? '' : 's'}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-7" onClick={cancelImport} disabled={applying}>Cancel</Button>
              <Button size="sm" className="h-7" onClick={() => void applyImport()} disabled={applying || selectableCount === 0}>
                {applying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
                Apply {selectableCount}
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-border/50 max-h-96 overflow-y-auto">
            {diff.map((r) => {
              const badge = CLASS_BADGE[r.klass];
              const Icon = badge.icon;
              const disabled = r.malformed || r.changeType === 'unchanged';
              return (
                <li key={r.key} className={cn('flex items-start gap-2.5 px-4 py-2', disabled && 'opacity-60')}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(r.key)}
                    disabled={disabled}
                    onChange={() => toggle(r.key)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-foreground break-all">{r.key}</span>
                      <span className={cn('text-[9px] font-semibold px-1 py-0.5 rounded border inline-flex items-center gap-0.5', badge.cls)}>
                        {Icon && <Icon className="h-2.5 w-2.5" />}{badge.label}
                      </span>
                      <span className={cn(
                        'text-[9px] font-semibold px-1 py-0.5 rounded',
                        r.changeType === 'add' ? 'bg-blue-100 text-blue-700'
                          : r.changeType === 'change' ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-500',
                      )}>{r.changeType}</span>
                      {r.malformed && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-rose-100 text-rose-700">malformed — skipped</span>}
                    </div>
                    {r.changeType === 'change' && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 break-all">
                        <span className="line-through opacity-70">{r.currentValue ?? '∅'}</span>
                        {' → '}
                        <span className="text-foreground">{r.incomingValue ?? '∅'}</span>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
