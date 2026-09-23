/**
 * ProjectHpiTab — Payer Initiatives HPI surface inside Project Detail.
 *
 * Visual parity with ProjectPayerIssuesTab — rich detail card for the
 * attached HPI with an X-to-detach (confirmed) interaction, and an
 * "Attach HPI" picker that only appears when nothing is attached.
 *
 * Single-valued lookup on msdyn_project (pmo_HpiIssue). Rendered only
 * when the project's Primary Team is Payer Initiatives — gating happens
 * in ProjectDetailPage so this component assumes a valid Payer
 * Initiatives project.
 */
import { useState } from 'react';
import { Tag, X, Plus, Pencil, ShieldAlert, FolderKanban, Loader2 } from 'lucide-react';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import { toast } from '../../../../hooks/useToast';
import { useHpiIssue, useHpiIssues } from '../hooks/useHpiIssues';
import { HpiDetailDrawer } from './HpiDetailDrawer';
import { hpiDisplayName } from '../api/hpi.api';
import { useUpdateProject } from '../../../../hooks/useProjects';

interface Props {
  projectId: string;
  currentHpiId?: string;
  currentHpiLabel?: string;
  canEdit: boolean;
}

function riskVariant(risk?: string) {
  if (risk === 'External') return 'danger' as const;
  if (risk === 'Shared') return 'warning' as const;
  if (risk === 'Internal') return 'info' as const;
  return 'outline' as const;
}

export function ProjectHpiTab({ projectId, currentHpiId, currentHpiLabel, canEdit }: Props) {
  const updateMutation = useUpdateProject(projectId);
  const { data: issue, isLoading: loadingDetail } = useHpiIssue(currentHpiId);
  const { data: allIssues = [], isLoading: loadingAll } = useHpiIssues();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Open the full HPI detail drawer in place so the HPI can be edited (e.g. set
  // AR Recovery Type to "Tracking Only" when a project completes) WITHOUT leaving
  // the project. The drawer reuses useHpiIssue's query key, so saving there
  // refreshes this tab's attached-HPI card automatically.
  const [editHpiOpen, setEditHpiOpen] = useState(false);
  const saving = updateMutation.isPending;

  function openPicker() {
    setDraft('');
    setPicking(true);
  }
  function cancelPicker() {
    setPicking(false);
    setDraft('');
  }
  async function commitAttach() {
    if (!draft) {
      setPicking(false);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        'pmo_PayerInitiatives_HpiIssue@odata.bind': `/rcm_payerdeckissues(${draft})`,
      });
      toast.success('HPI linked.');
      setPicking(false);
      setDraft('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t link HPI: ${msg}`);
    }
  }
  async function detach() {
    try {
      await updateMutation.mutateAsync({
        'pmo_PayerInitiatives_HpiIssue@odata.bind': null,
      });
      toast.success('HPI detached from this project.');
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn’t detach: ${msg}`);
    }
  }

  // Detail card for the attached HPI. Mirrors the Payer Issues attached-
  // list row style: bold ID, badges for risk/cred/path, payer/AR type
  // details, optional status text, X button on the right with confirmation.
  const credYes = issue?.cr87a_credentialing === true;
  const pathYes = issue?.cr87a_pathforward === true;
  // Display fallbacks: while the full record is loading, show what we have
  // from the formatted-value annotation that came back on the project read.
  const headlineNumber = issue?.rcm_issuenumber ?? currentHpiLabel ?? '—';
  // Name comes from rcm_statusdetails via hpiDisplayName (rcm_name is the
  // M- number thanks to the RCM autonumber flow). Only show it when it adds
  // info beyond the issue-number badge already rendered.
  const displayName = issue ? hpiDisplayName(issue) : undefined;
  const headlineName = displayName && displayName !== headlineNumber ? displayName : undefined;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">HPI attached to this project</h3>
          </div>
          {canEdit && !currentHpiId && !picking && (
            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={openPicker}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Attach HPI
            </Button>
          )}
        </div>

        {!currentHpiId ? (
          <p className="text-sm italic text-muted-foreground">No HPI attached.</p>
        ) : loadingDetail ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading HPI…
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-primary tracking-tight">
                  {headlineNumber}
                </span>
                {issue?.['rcm_risk@OData.Community.Display.V1.FormattedValue'] && (
                  <Badge variant={riskVariant(issue['rcm_risk@OData.Community.Display.V1.FormattedValue'])} className="text-[10px] px-1.5 py-0">
                    <ShieldAlert className="h-2.5 w-2.5 mr-0.5" />
                    {issue['rcm_risk@OData.Community.Display.V1.FormattedValue']}
                  </Badge>
                )}
                {credYes && (
                  <Badge variant="success" className="text-[10px] px-1.5 py-0">Cred</Badge>
                )}
                {pathYes && (
                  <Badge variant="info" className="text-[10px] px-1.5 py-0">Path Fwd</Badge>
                )}
                {issue?.['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue'] && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {issue['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue']}
                  </Badge>
                )}
              </div>
              {headlineName && (
                <p className="text-sm font-medium text-foreground">{headlineName}</p>
              )}
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <Field label="Payer / Bucket" value={issue?.rcm_reservebucketpayer} />
                <Field label="AR Recovery Type" value={issue?.['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue']} />
              </div>
              {issue?.rcm_statusdetails && (
                <p className="text-xs text-foreground/80 whitespace-pre-wrap">
                  {issue.rcm_statusdetails}
                </p>
              )}
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
                <FolderKanban className="h-3 w-3 shrink-0" />
                <span>This project</span>
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditHpiOpen(true)}
                  disabled={saving}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-50"
                  title="Edit this HPI (e.g. set it to Tracking) without leaving the project"
                  aria-label="Edit HPI"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={saving}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  title="Remove this HPI from the project"
                  aria-label="Remove HPI"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {picking && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Attach HPI</h3>
          <p className="text-xs text-muted-foreground">
            Select an existing HPI to link to this project. Each project links to one HPI.
          </p>
          {loadingAll ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading HPI list…
            </div>
          ) : (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— Select an HPI —</option>
              {allIssues.map((i) => {
                const num = i.rcm_issuenumber ?? '';
                const label = hpiDisplayName(i);
                const text = label === num ? (num || '(unnamed)') : `${num || '—'} — ${label}`;
                return (
                  <option key={i.rcm_payerdeckissueid} value={i.rcm_payerdeckissueid}>
                    {text}
                  </option>
                );
              })}
            </select>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={commitAttach} disabled={saving || !draft}>
              {saving ? 'Attaching…' : 'Attach'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelPicker} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Full HPI editor, opened in place from the "Edit HPI" button so the
          HPI can be updated (status / AR Recovery Type -> "Tracking Only",
          etc.) without navigating back to the HPI section. */}
      {currentHpiId && (
        <HpiDetailDrawer
          hpiId={editHpiOpen ? currentHpiId : null}
          open={editHpiOpen}
          onOpenChange={setEditHpiOpen}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Remove HPI from this project?"
        message={`Are you sure you want to remove this issue number${headlineNumber !== '—' ? ` (${headlineNumber})` : ''}? This unlinks the HPI from the project — the HPI itself stays in the catalog.`}
        confirmLabel="Remove"
        onConfirm={detach}
        onCancel={() => setConfirmOpen(false)}
        isLoading={saving}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <p className="uppercase tracking-widest font-semibold text-[9px] text-muted-foreground/60">{label}</p>
      <p className="truncate text-foreground/90">{value || '—'}</p>
    </div>
  );
}
