/**
 * TrackingLabelsCard — shows and edits a project's (or any record's) tracking
 * labels.
 *
 * SECURITY: This component is deliberately NOT gated by useCanEditProject.
 * pmo_tracking has Global CRUD on all CFR PMO roles, so any authenticated user
 * can tag any record regardless of whether their team is on that project.
 * Do NOT add a canEdit / permission check here without re-reading the plan
 * context in docs/CLAUDE.md / plan.md (2026-09-17 Tracking Labels batch).
 */
import { useState, useMemo } from 'react';
import { Plus, X, Loader2, Tag } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTrackingLabels, useAddTrackingLabel, useRemoveTrackingLabel } from '../../hooks/useTrackingLabels';
import { useAppSettings } from '../../hooks/useAppSettings';
import { SETTING_TRACKING_LABELS, DEFAULT_TRACKING_LABELS } from '../../lib/constants';

interface TrackingLabelsCardProps {
  recordType: string;
  recordId: string;
  /** Optional extra Tailwind classes for the wrapper. */
  className?: string;
}

export function TrackingLabelsCard({ recordType, recordId, className }: TrackingLabelsCardProps) {
  const { data: settings = [] } = useAppSettings();
  const { data: rows = [], isPending } = useTrackingLabels(recordType, recordId);
  const addMut    = useAddTrackingLabel(recordType, recordId);
  const removeMut = useRemoveTrackingLabel(recordType, recordId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  // Admin-configured available labels from pmo_appsettings.
  const availableLabels = useMemo<string[]>(() => {
    const raw = settings.find((s) => s.pmo_key === SETTING_TRACKING_LABELS)?.pmo_value;
    if (!raw) return [...DEFAULT_TRACKING_LABELS];
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [...DEFAULT_TRACKING_LABELS]; }
    catch { return [...DEFAULT_TRACKING_LABELS]; }
  }, [settings]);

  // Labels already applied to this record.
  const appliedSet = useMemo(() => new Set(rows.map((r) => r.pmo_label)), [rows]);

  // Labels available to add (not yet applied).
  const unapplied = availableLabels.filter((l) => !appliedSet.has(l));

  async function handleAdd(label: string) {
    setPickerOpen(false);
    await addMut.mutateAsync(label);
  }

  async function handleRemove(trackingId: string, label: string) {
    setRemoving(trackingId);
    try { await removeMut.mutateAsync(trackingId); }
    finally { setRemoving(null); }
    void label; // suppress unused-var if label is only used for aria
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="flex items-center gap-2 mb-2.5">
        <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          Tracking Labels
        </span>
      </div>

      {isPending ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {rows.map((row) => (
            <span
              key={row.pmo_trackingid}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
            >
              {row.pmo_label}
              <button
                type="button"
                aria-label={`Remove ${row.pmo_label}`}
                onClick={() => handleRemove(row.pmo_trackingid, row.pmo_label)}
                disabled={removing === row.pmo_trackingid || removeMut.isPending}
                className="ml-0.5 rounded-full hover:bg-primary/20 transition-colors p-0.5 disabled:opacity-40"
              >
                {removing === row.pmo_trackingid
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <X className="h-2.5 w-2.5" />}
              </button>
            </span>
          ))}

          {/* Add button — only shown when there are unlabeled available choices */}
          {unapplied.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                <Plus className="h-2.5 w-2.5" /> Add label
              </button>

              {pickerOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-md border border-border bg-popover shadow-md py-1">
                  {unapplied.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleAdd(label)}
                      disabled={addMut.isPending}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/40 transition-colors disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {rows.length === 0 && unapplied.length === 0 && (
            <span className="text-xs text-muted-foreground italic">
              No tracking labels defined — an admin can add them in Settings.
            </span>
          )}
        </div>
      )}

      {/* Dismiss picker on outside click */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setPickerOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
