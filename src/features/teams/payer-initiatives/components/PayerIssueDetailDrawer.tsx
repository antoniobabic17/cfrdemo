/**
 * PayerIssueDetailDrawer — full record view for one cr87a_payerissue with
 * inline edit, lifecycle actions, and project attach/detach. Mirrors
 * HpiDetailDrawer so the two feature surfaces behave identically.
 *
 * Editable fields: Name, Short Description, Detailed Issue, Status, Type.
 * Payer / status / type picklists come from payerIssues.api option maps.
 * Delete is admin-only (useEffectiveAdminRole), matching HPI.
 * Project link uses the pmo_PayerInitiatives_Project lookup (custom source);
 * projectId here is the same-GUID pmo_projectid.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import { Loader2, ExternalLink, Unlink, Pencil, Save, PowerOff, Power, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import { useEffectiveAdminRole } from '../../../../providers/ConfigurationProvider';
import { SearchableSelect } from '../../../../components/common/SearchableSelect';
import { toast } from '../../../../hooks/useToast';
import {
  usePayerIssue,
  useUpdatePayerIssue,
  useDeactivatePayerIssue,
  useReactivatePayerIssue,
  useDeletePayerIssue,
  useSetPayerIssueProject,
} from '../hooks/usePayerIssues';
import { useActivePayerInitiativeProjects } from '../hooks/useHpiIssues';
import { useActivePayerInitiativesAnalysts, resolveAnalystLabel } from '../hooks/usePayerInitiativesAnalysts';
import {
  PAYER_ISSUE_STATUS_OPTIONS,
  PAYER_ISSUE_TYPE_OPTIONS,
  type PayerIssueUpdateInput,
} from '../api/payerIssues.api';
import { PayerIssueAttachments } from './PayerIssueAttachments';
import { markDeleting, unmarkDeleting } from '../../../../lib/deletingStore';
import { toEdmDate, fmtDateOnly } from '../../../../lib/dateOnly';
import { useQueryClient } from '@tanstack/react-query';

import { setIntakeSeed } from '../../../../lib/intakeSeed';
import { PAYER_INITIATIVES_TEAM_NAMES } from '../constants';
import { usePmoTeamsForIntake } from '../../../../hooks/useIntakeLookups';
import { FolderPlus } from 'lucide-react';

interface Props {
  payerIssueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PayerIssueDetailDrawer({ payerIssueId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { data: issue, isLoading } = usePayerIssue(payerIssueId ?? undefined);
  const update = useUpdatePayerIssue();
  const deactivate = useDeactivatePayerIssue();
  const reactivate = useReactivatePayerIssue();
  const removeMut = useDeletePayerIssue();
  const setProject = useSetPayerIssueProject();

  // Resolve the Payer Initiatives team GUID at RUNTIME by name — the hardcoded
  // PROD GUID does not exist in DEV/UAT (AAD migration made team ids env-specific).
  const { data: pmoTeams = [] } = usePmoTeamsForIntake();
  const payerTeamId = useMemo(() => {
    const names = new Set(PAYER_INITIATIVES_TEAM_NAMES.map((n) => n.trim().toLowerCase()));
    return pmoTeams.find((t) => names.has((t.label ?? '').trim().toLowerCase()))?.value;
  }, [pmoTeams]);
  const qc = useQueryClient();
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';
  const isInactive = issue?.statecode === 1;

  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayerIssueUpdateInput>({});

  // Prefer the new pmo_project lookup; fall back to legacy msdyn lookup.
  const projectId = issue?.['_pmo_payerinitiatives_project_value'] ?? issue?.['_pmo_payerinitiatives_msdynproject_value'];
  const projectName = issue?.['_pmo_payerinitiatives_project_value@OData.Community.Display.V1.FormattedValue'] ?? issue?.['_pmo_payerinitiatives_msdynproject_value@OData.Community.Display.V1.FormattedValue'];
  const payer = issue?.['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'];

  const { data: projectOptions = [], isLoading: projectsLoading } = useActivePayerInitiativeProjects();
  const { data: analystOptions = [], isLoading: analystsLoading } = useActivePayerInitiativesAnalysts();
  const analystLabel = issue?.['_cr87a_assignedanalyst_value@OData.Community.Display.V1.FormattedValue'];

  function startEdit() {
    if (!issue) return;
    setDraft({
      cr87a_name: issue.cr87a_name ?? '',
      cr87a_shortdescription: issue.cr87a_shortdescription ?? '',
      cr87a_detailedissue: issue.cr87a_detailedissue ?? '',
      cr87a_payerissuestatus: issue.cr87a_payerissuestatus ?? null,
      cr87a_payerissuetype: issue.cr87a_payerissuetype ?? null,
      analystSystemUserId: issue['_cr87a_assignedanalyst_value'] ?? '',
      // DateOnly column returns a bare YYYY-MM-DD; feed it straight to the
      // <input type=date> (toEdmDate normalizes; avoids new Date() TZ off-by-one).
      rcm_accepteddate: toEdmDate(issue.rcm_accepteddate) ?? '',
      cr87a_response: issue.cr87a_response ?? '',
    });
    setEditing(true);
  }
  function cancelEdit() { setEditing(false); setDraft({}); }

  async function handleSave() {
    if (!payerIssueId) return;
    if (!draft.cr87a_name?.trim()) { toast.error('Name is required.'); return; }
    try {
      const patch = {
        ...draft,
        rcm_accepteddate: draft.rcm_accepteddate !== undefined
          ? (toEdmDate(draft.rcm_accepteddate) ?? null)
          : undefined,
        cr87a_response: draft.cr87a_response !== undefined
          ? ((draft.cr87a_response ?? '').trim() === '' ? null : draft.cr87a_response)
          : undefined,
      };
      await update.mutateAsync({ id: payerIssueId, patch });
      toast.success('Payer inquiry updated.');
      setEditing(false); setDraft({});
    } catch (err) {
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleDeactivate() {
    if (!payerIssueId) return;
    try {
      await deactivate.mutateAsync(payerIssueId);
      toast.success('Payer inquiry deactivated.');
      setConfirmDeactivateOpen(false); onOpenChange(false);
    } catch (err) {
      toast.error(`Couldn't deactivate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleReactivate() {
    if (!payerIssueId) return;
    try {
      await reactivate.mutateAsync(payerIssueId);
      toast.success('Payer inquiry reactivated.');
    } catch (err) {
      toast.error(`Couldn't reactivate: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleDelete() {
    if (!payerIssueId) return;
    const id = payerIssueId;
    // Mirror the project delete pattern: close + optimistically remove the row
    // from the gallery via the shared deletingStore, then await invalidation so
    // the list reconciles reliably even though this drawer is unmounting.
    setConfirmDeleteOpen(false);
    onOpenChange(false);
    markDeleting(id);
    try {
      await removeMut.mutateAsync(id);
      toast.success('Payer inquiry deleted.');
      await qc.invalidateQueries({ queryKey: ['payerIssues'] });
    } catch (err) {
      toast.error(`Couldn't delete: ${err instanceof Error ? err.message : String(err)}`);
      await qc.invalidateQueries({ queryKey: ['payerIssues'] });
    } finally {
      unmarkDeleting(id);
    }
  }
  async function handleAttach(pid: string) {
    if (!payerIssueId || !pid) return;
    try {
      await setProject.mutateAsync({ payerIssueId, projectId: pid });
      toast.success('Project linked.');
    } catch (err) {
      toast.error(`Couldn't link: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function handleDetach() {
    if (!payerIssueId) return;
    try {
      await setProject.mutateAsync({ payerIssueId, projectId: null });
      toast.success('Project unlinked.');
    } catch (err) {
      toast.error(`Couldn't unlink: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Create a project FROM this inquiry. Seeds the REAL project intake wizard at
  // step 1 (in-memory seed; no record pre-created): inquiry NAME as the request
  // name, Payer Initiatives as the team (so the wizard's own PI rules run), and
  // the inquiry pre-attached. User then drives the normal wizard. Cancel leaves
  // nothing orphaned.
  function handleCreateProject() {
    if (!payerIssueId || !issue) return;
    const name = issue.cr87a_name?.trim() || issue.cr87a_payerissueidauto || 'Untitled Inquiry';
    setIntakeSeed({
      targetTeamId: payerTeamId,
      values: {
        pmo_name: name,
        ...(issue.cr87a_shortdescription ? { pmo_description: issue.cr87a_shortdescription } : {}),
      },
      payerIssueIds: [payerIssueId],
    });
    onOpenChange(false);
    setTimeout(() => navigate('/intake/new?seed=1'), 0);
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
              <div className="pr-24 min-w-0">
                <DialogTitle className="flex items-center gap-3 flex-wrap">
                  {/* Match the gallery tile format: mono/primary ID + medium name.
                      Suppress the name when it merely duplicates the auto-ID (records
                      whose cr87a_name was stamped with the PAYISSUE-#### id) so the
                      header doesn't read "PAYISSUE-2325 PAYISSUE-2325". */}
                  {issue.cr87a_payerissueidauto && (
                    <span className="font-mono text-xs tabular-nums text-primary font-semibold">{issue.cr87a_payerissueidauto}</span>
                  )}
                  {(() => {
                    const name = editing ? (draft.cr87a_name || '') : (issue.cr87a_name ?? '');
                    const trimmed = name.trim();
                    const dupesId = trimmed !== '' && trimmed === (issue.cr87a_payerissueidauto ?? '').trim();
                    if (dupesId) return null;
                    return (
                      <span className="font-medium text-foreground">
                        {trimmed || (editing ? '(unnamed)' : (issue.cr87a_payerissueidauto ? '' : 'Payer Inquiry'))}
                      </span>
                    );
                  })()}
                </DialogTitle>
                <DialogDescription>
                  {payer ? `Payer: ${payer}` : 'Payer inquiry'}
                </DialogDescription>
                {isInactive && (
                  <p className="text-[11px] text-amber-700 mt-1">Inactive — hidden from the default view.</p>
                )}
                {!editing && (
                  <div className="flex items-center gap-2 pt-2">
                    {!isInactive ? (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
                        onClick={() => setConfirmDeactivateOpen(true)} disabled={deactivate.isPending}
                        title="Deactivate this payer inquiry.">
                        {deactivate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <PowerOff className="h-3.5 w-3.5 mr-1" />}
                        Deactivate
                      </Button>
                    ) : (
                      isAdmin && (
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs text-emerald-800 border-emerald-300 hover:bg-emerald-50"
                          onClick={handleReactivate} disabled={reactivate.isPending}
                          title="Reactivate this payer inquiry.">
                          {reactivate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Power className="h-3.5 w-3.5 mr-1" />}
                          Reactivate
                        </Button>
                      )
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs text-rose-700 border-rose-300 hover:bg-rose-50"
                        onClick={() => setConfirmDeleteOpen(true)} disabled={removeMut.isPending}
                        title="Permanently delete this payer inquiry.">
                        {removeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!editing ? (
                <Button size="sm" className="absolute top-3.5 right-14 h-7 px-3" onClick={startEdit} title="Edit">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              ) : (
                <Button size="sm" className="absolute top-3.5 right-14 h-7 px-3" onClick={handleSave} disabled={update.isPending} title="Save">
                  {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  {update.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
            </DialogHeader>

            {editing ? (
              <div className="space-y-3 pt-2">
                <EditField label="Name *">
                  <Input value={draft.cr87a_name ?? ''} onChange={(e) => setDraft((d) => ({ ...d, cr87a_name: e.target.value }))} />
                </EditField>
                <div className="grid grid-cols-2 gap-3">
                  {/* Payer is a source-system lookup — display only, kept visible
                      in edit mode so it does not appear to vanish. */}
                  <EditField label="Payer">
                    <div className="h-9 flex items-center text-sm text-foreground">
                      {payer ?? '—'}
                    </div>
                  </EditField>
                  <EditField label="Type">
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.cr87a_payerissuetype == null ? '' : String(draft.cr87a_payerissuetype)}
                      onChange={(e) => setDraft((d) => ({ ...d, cr87a_payerissuetype: e.target.value === '' ? null : Number(e.target.value) }))}
                    >
                      <option value="">—</option>
                      {PAYER_ISSUE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </EditField>
                  {/* Created By is a system audit field — display only, even in edit mode. */}
                  <EditField label="Created By">
                    <div className="h-9 flex items-center text-sm text-foreground">
                      {issue['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                    </div>
                  </EditField>
                </div>
                <EditField label="Short Description">
                  <Input value={draft.cr87a_shortdescription ?? ''} onChange={(e) => setDraft((d) => ({ ...d, cr87a_shortdescription: e.target.value }))} />
                </EditField>
                <EditField label="Detailed Issue">
                  <Textarea rows={4} value={draft.cr87a_detailedissue ?? ''} onChange={(e) => setDraft((d) => ({ ...d, cr87a_detailedissue: e.target.value }))} />
                </EditField>
              </div>
            ) : (
              <section className="grid grid-cols-2 gap-3 pt-2">
                <Field label="Payer" value={payer} />
                <Field label="Created By" value={issue['_createdby_value@OData.Community.Display.V1.FormattedValue']} />
                <Field label="Type" value={issue['cr87a_payerissuetype@OData.Community.Display.V1.FormattedValue']} />
                <Field label="Created" value={issue.createdon ? new Date(issue.createdon).toLocaleDateString() : undefined} />
                {issue.cr87a_shortdescription && <div className="col-span-2"><Field label="Short Description" value={issue.cr87a_shortdescription} /></div>}
                {issue.cr87a_detailedissue && <div className="col-span-2"><Field label="Detailed Issue" value={issue.cr87a_detailedissue} /></div>}
              </section>
            )}

            {/* Disposition group — visually separated in a tinted container. */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Accepted Date</p>
                  {editing ? (
                    <Input type="date" value={draft.rcm_accepteddate ?? ''} onChange={(e) => setDraft((d) => ({ ...d, rcm_accepteddate: e.target.value }))} />
                  ) : (
                    <p className="text-sm text-foreground">{fmtDateOnly(issue.rcm_accepteddate)}</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Status</p>
                  {editing ? (
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.cr87a_payerissuestatus == null ? '' : String(draft.cr87a_payerissuestatus)}
                      onChange={(e) => setDraft((d) => ({ ...d, cr87a_payerissuestatus: e.target.value === '' ? null : Number(e.target.value) }))}
                    >
                      <option value="">—</option>
                      {PAYER_ISSUE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <p className="text-sm text-foreground">{issue['cr87a_payerissuestatus@OData.Community.Display.V1.FormattedValue'] ?? '—'}</p>
                  )}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Analyst</p>
                {editing ? (
                  <SearchableSelect
                    value={draft.analystSystemUserId ?? ''}
                    onChange={(v) => setDraft((d) => ({ ...d, analystSystemUserId: v || null }))}
                    options={analystOptions}
                    resolveLabel={resolveAnalystLabel}
                    placeholder={analystsLoading ? 'Loading team…' : 'Select an analyst…'}
                    disabled={analystsLoading}
                  />
                ) : (
                  <p className="text-sm text-foreground">{analystLabel ?? '—'}</p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Response</p>
                {editing ? (
                  <Textarea rows={3} value={draft.cr87a_response ?? ''} onChange={(e) => setDraft((d) => ({ ...d, cr87a_response: e.target.value }))} />
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">{issue.cr87a_response || '—'}</p>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Attached Project</h4>
              {projectId && projectName ? (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border bg-card">
                  <span className="text-sm text-foreground truncate">{projectName}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => { onOpenChange(false); const id = projectId; setTimeout(() => navigate(`/projects/${id}`), 0); }}
                      title="Open project"
                      className="h-7 px-2 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-rose-600 hover:text-rose-700"
                      onClick={handleDetach} disabled={setProject.isPending} title="Unlink">
                      <Unlink className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <SearchableSelect
                  value=""
                  onChange={handleAttach}
                  options={projectOptions.map((p) => ({ value: p.msdyn_projectid, label: p.pmo_legacyprojectid ? `${p.pmo_legacyprojectid} — ${p.msdyn_subject ?? '(untitled)'}` : (p.msdyn_subject ?? '(untitled)') }))}
                  placeholder={projectsLoading ? 'Loading projects…' : 'Pick a project to link…'}
                  disabled={setProject.isPending || projectsLoading}
                />
              )}
              </div>
              {/* Create a project FROM this inquiry (always visible). Seeds a
                  draft request + opens the intake wizard prefilled. */}
              <div className="pt-1">
                  <Button size="sm" onClick={handleCreateProject} className="h-8">
                    <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
                    Create Project from this Inquiry
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Opens the intake wizard prefilled (name + Payer Initiatives team +
                    this inquiry attached). Save as draft, cancel to discard, or finish
                    to create the project.
                  </p>
                </div>
            </div>

            <PayerIssueAttachments issue={issue} />
          </>
        )}
        <ConfirmDialog
          open={confirmDeactivateOpen}
          title="Deactivate this payer inquiry?"
          message="Deactivated payer inquiries are hidden from the default view but keep their project link. An admin can reactivate later."
          confirmLabel="Deactivate"
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmDeactivateOpen(false)}
          isLoading={deactivate.isPending}
        />
        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete this payer inquiry?"
          message="This permanently removes the payer inquiry from Dataverse. This action cannot be undone."
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
      <p className="text-sm text-foreground whitespace-pre-wrap">{value || '—'}</p>
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
