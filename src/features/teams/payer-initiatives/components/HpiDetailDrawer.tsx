/**
 * Detail drawer for a single HPI. Shows every column from the active PIT
 * view, the AI-generated narrative if present, and the related-projects
 * list with attach / detach controls. Includes an inline edit mode.
 *
 * Schema notes:
 *   - rcm_issuenumber is Dataverse-autonumbered ("M-{SEQNUM:1}"), read-
 *     only in edit mode.
 *   - rcm_analyst is a Lookup to systemuser; edited via the team-scoped
 *     SearchableSelect and stored/read via _rcm_analyst_value.
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { Input } from '../../../../components/ui/input';
import { Loader2, ExternalLink, Unlink, ShieldAlert, Pencil, Save, PowerOff, Power, Trash2 } from 'lucide-react';
import {
  useHpiIssue,
  useRelatedProjects,
  useRelateProjectToHpi,
  useUpdateHpiIssue,
  useDeactivateHpiIssue,
  useReactivateHpiIssue,
  useDeleteHpiIssue,
} from '../hooks/useHpiIssues';
import { useEffectiveAdminRole } from '../../../../providers/ConfigurationProvider';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import {
  resolveAnalystLabel,
  useActivePayerInitiativesAnalysts,
} from '../hooks/usePayerInitiativesAnalysts';
import { SearchableSelect } from '../../../../components/common/SearchableSelect';
import { HpiProjectAttacher } from './HpiRelateProjectPicker';
import { toast } from '../../../../hooks/useToast';
import { hpiDisplayName, type HpiCreateInput, type ArRecoveryTypeValue, type RiskValue } from '../api/hpi.api';
import { AR_RECOVERY_TYPE_OPTIONS, RISK_OPTIONS } from '../api/hpi.api';
import { fmtDateOnly } from '../../../../lib/dateOnly';
import { markDeleting, unmarkDeleting } from '../../../../lib/deletingStore';
import { useQueryClient } from '@tanstack/react-query';


interface Props {
  hpiId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function riskVariant(risk?: string) {
  if (risk === 'External') return 'danger' as const;
  if (risk === 'Shared') return 'warning' as const;
  if (risk === 'Internal') return 'info' as const;
  return 'outline' as const;
}

export function HpiDetailDrawer({ hpiId, open, onOpenChange }: Props) {
  const { data: issue, isLoading } = useHpiIssue(hpiId ?? undefined);
  const { data: related = [], isLoading: relLoading, refetch } = useRelatedProjects(hpiId ?? undefined);
  const relate = useRelateProjectToHpi();
  const update = useUpdateHpiIssue();
  const deactivate = useDeactivateHpiIssue();
  const reactivate = useReactivateHpiIssue();
  const removeMut = useDeleteHpiIssue();
  const qc = useQueryClient();
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const isInactive = issue?.statecode === 1;

  async function handleDeactivate() {
    if (!hpiId) return;
    try {
      await deactivate.mutateAsync(hpiId);
      toast.success('HPI deactivated.');
      setConfirmDeactivateOpen(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(`Couldn't deactivate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleReactivate() {
    if (!hpiId) return;
    try {
      await reactivate.mutateAsync(hpiId);
      toast.success('HPI reactivated.');
    } catch (err) {
      toast.error(`Couldn't reactivate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleDelete() {
    if (!hpiId) return;
    const id = hpiId;
    // Mirror the project delete pattern: close + optimistically remove from the
    // gallery via the shared deletingStore, then await invalidation so the list
    // reconciles even as this drawer unmounts.
    setConfirmDeleteOpen(false);
    onOpenChange(false);
    markDeleting(id);
    try {
      await removeMut.mutateAsync(id);
      toast.success('HPI deleted.');
      await qc.invalidateQueries({ queryKey: ['hpi'] });
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`);
      await qc.invalidateQueries({ queryKey: ['hpi'] });
    } finally {
      unmarkDeleting(id);
    }
  }
  const { data: analystOptions = [], isLoading: analystsLoading } = useActivePayerInitiativesAnalysts();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<HpiCreateInput>>({});

  function startEdit() {
    if (!issue) return;
    setDraft({
      // "Name" edits rcm_statusdetails (rcm_name is the flow-owned M- mirror).
      rcm_statusdetails: issue.rcm_statusdetails ?? '',
      analystSystemUserId: issue._rcm_analyst_value ?? '',
      rcm_reservebucketpayer: issue.rcm_reservebucketpayer ?? '',
      rcm_risk: (typeof issue.rcm_risk === 'number' ? issue.rcm_risk as RiskValue : undefined),
      cr87a_credentialing: issue.cr87a_credentialing,
      cr87a_pathforward: issue.cr87a_pathforward,
      cr87a_arrecoverytype: issue.cr87a_arrecoverytype,
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }

  async function handleSave() {
    if (!hpiId) return;
    if (!draft.rcm_statusdetails?.trim()) {
      toast.error('Name is required.');
      return;
    }
    try {
      await update.mutateAsync({ id: hpiId, patch: draft });
      toast.success('HPI updated.');
      setEditing(false);
      setDraft({});
      } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't save: ${msg}`);
    }
  }

  async function handleDetach(projectId: string) {
    if (!hpiId) return;
    try {
      await relate.mutateAsync({ projectId, hpiId: null });
      toast.success('Project unrelated.');
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't unrelate: ${msg}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) cancelEdit(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {isLoading || !issue ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <DialogHeader>
              {/* Title row -- pr-24 leaves clear space on the right for
                  the absolutely-positioned Edit/Save pill AND Radix's
                  built-in close X (top-4 right-4). Both action buttons
                  are placed at top-4 too so they align horizontally. */}
              <div className="pr-24 min-w-0">
                <DialogTitle className="flex items-center gap-3 flex-wrap">
                  <span className="text-primary font-bold">
                    {issue.rcm_issuenumber || '—'}
                  </span>
                  <span className="text-foreground">
                    {editing ? (draft.rcm_statusdetails || '(unnamed)') : hpiDisplayName(issue)}
                  </span>
                  {!editing && issue['rcm_risk@OData.Community.Display.V1.FormattedValue'] && (
                    <Badge variant={riskVariant(issue['rcm_risk@OData.Community.Display.V1.FormattedValue'])} className="text-[10px]">
                      <ShieldAlert className="h-2.5 w-2.5 mr-0.5" /> {issue['rcm_risk@OData.Community.Display.V1.FormattedValue']}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {issue['_ownerid_value@OData.Community.Display.V1.FormattedValue']
                    ? `Owned by ${issue['_ownerid_value@OData.Community.Display.V1.FormattedValue']}`
                    : 'Health Plan Issue mapping'}
                </DialogDescription>
                {isInactive && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Inactive — hidden from the default gallery view.
                  </p>
                )}
                {!editing && (
                  <div className="flex items-center gap-2 pt-2">
                    {!isInactive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
                        onClick={() => setConfirmDeactivateOpen(true)}
                        disabled={deactivate.isPending}
                        title="Deactivate this HPI. Related projects keep the lookup; the row leaves the default gallery view."
                      >
                        {deactivate.isPending
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <PowerOff className="h-3.5 w-3.5 mr-1" />}
                        Deactivate
                      </Button>
                    ) : (
                      isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-emerald-800 border-emerald-300 hover:bg-emerald-50"
                          onClick={handleReactivate}
                          disabled={reactivate.isPending}
                          title="Reactivate this HPI. Row returns to the default gallery view."
                        >
                          {reactivate.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            : <Power className="h-3.5 w-3.5 mr-1" />}
                          Reactivate
                        </Button>
                      )
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-rose-700 border-rose-300 hover:bg-rose-50"
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={removeMut.isPending}
                        title="Permanently delete this HPI. Related projects will have the HPI lookup cleared."
                      >
                        {removeMut.isPending
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!editing ? (
                <Button
                  size="sm"
                  className="absolute top-3.5 right-14 h-7 px-3"
                  onClick={startEdit}
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="absolute top-3.5 right-14 h-7 px-3"
                  onClick={handleSave}
                  disabled={update.isPending}
                  title="Save"
                >
                  {update.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    : <Save className="h-3.5 w-3.5 mr-1" />}
                  {update.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
            </DialogHeader>

            {editing ? (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <EditField label="Issue Number">
                    <Input value={issue.rcm_issuenumber ?? ''} disabled readOnly className="text-muted-foreground italic" />
                    <p className="text-[10px] text-muted-foreground">Auto-generated by Dataverse; not editable.</p>
                  </EditField>
                  <EditField label="Name *">
                    <Input value={draft.rcm_statusdetails ?? ''} onChange={(e) => setDraft((d) => ({ ...d, rcm_statusdetails: e.target.value }))} />
                  </EditField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <EditField label="Analyst">
                    <SearchableSelect
                      value={draft.analystSystemUserId ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, analystSystemUserId: v }))}
                      options={analystOptions}
                      resolveLabel={resolveAnalystLabel}
                      placeholder={analystsLoading ? "Loading team…" : "Select an analyst…"}
                      disabled={analystsLoading}
                    />
                  </EditField>
                  <EditField label="Reserve Bucket / Payer">
                    <Input value={draft.rcm_reservebucketpayer ?? ''} onChange={(e) => setDraft((d) => ({ ...d, rcm_reservebucketpayer: e.target.value }))} />
                  </EditField>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <EditField label="Risk">
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.rcm_risk === undefined ? '' : String(draft.rcm_risk)}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        rcm_risk: e.target.value === '' ? undefined : (Number(e.target.value) as RiskValue),
                      }))}
                    >
                      <option value="">—</option>
                      {RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </EditField>
                  <EditField label="Credentialing">
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.cr87a_credentialing === undefined ? '' : draft.cr87a_credentialing ? 'true' : 'false'}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        cr87a_credentialing: e.target.value === '' ? undefined : e.target.value === 'true',
                      }))}
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </EditField>
                  <EditField label="Path Forward">
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.cr87a_pathforward === undefined ? '' : draft.cr87a_pathforward ? 'true' : 'false'}
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        cr87a_pathforward: e.target.value === '' ? undefined : e.target.value === 'true',
                      }))}
                    >
                      <option value="">—</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </EditField>
                </div>
                <EditField label="AR Recovery Type">
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={draft.cr87a_arrecoverytype === undefined ? '' : String(draft.cr87a_arrecoverytype)}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      cr87a_arrecoverytype: e.target.value === '' ? undefined : (Number(e.target.value) as ArRecoveryTypeValue),
                    }))}
                  >
                    <option value="">—</option>
                    {AR_RECOVERY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </EditField>
              </div>
            ) : (
              <>
                <section className="grid grid-cols-2 gap-3 pt-2">
                  <Field label="Analyst" value={issue['_rcm_analyst_value@OData.Community.Display.V1.FormattedValue']} />
                  <Field label="Reserve Bucket / Payer" value={issue.rcm_reservebucketpayer} />
                  <Field label="Credentialing" value={issue['cr87a_credentialing@OData.Community.Display.V1.FormattedValue']} />
                  <Field label="Path Forward" value={issue['cr87a_pathforward@OData.Community.Display.V1.FormattedValue']} />
                  <Field label="AR Recovery Type" value={issue['cr87a_arrecoverytype@OData.Community.Display.V1.FormattedValue']} />
                  <Field
                    label="Created"
                    value={issue.createdon ? fmtDateOnly(issue.createdon) : undefined}
                  />
                </section>

                {issue.cr87a_aigeneratedprojectsummary && (
                  <section className="pt-3">
                    <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                      AI Project Summary
                    </h4>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {issue.cr87a_aigeneratedprojectsummary}
                    </p>
                  </section>
                )}
              </>
            )}

            <section className="pt-4 border-t mt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Related Project ({relLoading ? '…' : related.length})
                </h4>
              </div>
              {related.length === 0 && (
                <div className="mb-3">
                  <HpiProjectAttacher
                    hpiId={issue.rcm_payerdeckissueid}
                    onAttached={() => refetch()}
                    excludeProjectIds={related.map((p) => p.msdyn_projectid)}
                  />
                </div>
              )}
              {relLoading ? (
                <p className="text-xs text-muted-foreground">Loading related projects…</p>
              ) : related.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No projects related yet. Use the picker above to attach one.
                </p>
              ) : (
                <ul className="space-y-1">
                  {related.map((p) => (
                    <li key={p.msdyn_projectid} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border bg-card">
                      <span className="text-sm text-foreground truncate">
                        {p.pmo_legacyprojectid && (
                          <span className="text-[11px] text-muted-foreground mr-1.5">[{p.pmo_legacyprojectid}]</span>
                        )}
                        {p.msdyn_subject ?? '(untitled)'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            // Close synchronously so the dialog is gone before
                            // the router repaints for the new route.
                            onOpenChange(false);
                            const id = p.msdyn_projectid;
                            setTimeout(() => { window.location.hash = `#/projects/${id}`; }, 0);
                          }}
                          title="Open project"
                          className="h-7 px-2 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </button>
                        <Button
                          variant="ghost" size="sm" className="h-7 px-2 text-rose-600 hover:text-rose-700"
                          onClick={() => handleDetach(p.msdyn_projectid)}
                          disabled={relate.isPending}
                          title="Unrelate"
                        >
                          <Unlink className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        <ConfirmDialog
          open={confirmDeactivateOpen}
          title="Deactivate this HPI?"
          message={'Deactivated HPIs are hidden from the default gallery view but remain linked to their related projects. An admin can reactivate later.'}
          confirmLabel="Deactivate"
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmDeactivateOpen(false)}
          isLoading={deactivate.isPending}
        />
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete this HPI?"
          message={'This permanently removes the HPI from Dataverse. Any related projects will have their HPI lookup cleared automatically. This action cannot be undone.'}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDeleteOpen(false)}
          isLoading={removeMut.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || '—'}</p>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
