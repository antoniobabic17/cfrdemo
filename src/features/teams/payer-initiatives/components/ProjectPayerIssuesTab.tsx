/**
 * ProjectPayerIssuesTab — Payer Initiatives Payer Issues surface inside
 * Project Detail.
 *
 * Many payer issues may attach to one project via the
 * pmo_PayerInitiatives_Project lookup on cr87a_payerissue (-> pmo_project;
 * added to PROD via scripts/add-payerinitiatives-project-lookup.py). Reads still
 * fall back to the legacy pmo_payerinitiatives_msdynproject lookup for rows not
 * yet re-pointed.
 * This tab lists payer issues currently linked, offers a multi-select to
 * attach more, and a detach button per row.
 *
 * Rendered only when the project's Primary Team is Payer Initiatives —
 * gating happens in ProjectDetailPage.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, X, Plus, Loader2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { toast } from '../../../../hooks/useToast';
import { MultiSelectCheckList } from '../../../../components/common/MultiSelectCheckList';
import {
  usePayerIssues,
  usePayerIssuesForProject,
  useSetPayerIssueProject,
} from '../hooks/usePayerIssues';

interface Props {
  projectId: string;
  canEdit: boolean;
}

export function ProjectPayerIssuesTab({ projectId, canEdit }: Props) {
  const { data: attached = [], isLoading: loadingAttached } = usePayerIssuesForProject(projectId);
  const { data: allIssues = [], isLoading: loadingAll } = usePayerIssues();
  const setLink = useSetPayerIssueProject();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const saving = setLink.isPending;

  const attachedIds = useMemo(() => new Set(attached.map((i) => i.cr87a_payerissueid)), [attached]);
  const availableOptions = useMemo(
    () => allIssues
      .filter((i) => !attachedIds.has(i.cr87a_payerissueid))
      .map((i) => {
        const name = i.cr87a_name ?? '(unnamed)';
        const payer = i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'];
        return { value: i.cr87a_payerissueid, label: payer ? `${name} — ${payer}` : name };
      }),
    [allIssues, attachedIds],
  );

  function openPicker() {
    setDraft([]);
    setPicking(true);
  }
  function cancelPicker() {
    setDraft([]);
    setPicking(false);
  }
  async function commitAttach() {
    if (draft.length === 0) {
      setPicking(false);
      return;
    }
    try {
      for (const id of draft) {
        await setLink.mutateAsync({ payerIssueId: id, projectId });
      }
      toast.success(`Attached ${draft.length} payer inquir${draft.length === 1 ? 'y' : 'ies'}.`);
      setPicking(false);
      setDraft([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Attach failed: ${msg}`);
    }
  }
  async function detach(payerIssueId: string) {
    try {
      await setLink.mutateAsync({ payerIssueId, projectId: null });
      toast.success('Payer inquiry detached.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Detach failed: ${msg}`);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Payer Inquiries attached to this project</h3>
          </div>
          {canEdit && !picking && (
            <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={openPicker}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Attach inquiries
            </Button>
          )}
        </div>

        {loadingAttached ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : attached.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No payer inquiries attached.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 overflow-hidden">
            {attached.map((i) => {
              const id = i.cr87a_payerissueidauto ?? '—';
              const name = i.cr87a_name ?? '(unnamed)';
              const payer = i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'];
              const status = i['cr87a_payerissuestatus@OData.Community.Display.V1.FormattedValue'];
              return (
                <li key={i.cr87a_payerissueid} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{id}</span>
                      {status && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{status}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{name}</p>
                    {payer && <p className="text-xs text-muted-foreground truncate">Payer: {payer}</p>}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => detach(i.cr87a_payerissueid)}
                      disabled={saving}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      title="Detach this inquiry from this project"
                      aria-label="Detach inquiry"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {picking && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Attach payer inquiries</h3>
          <p className="text-xs text-muted-foreground">
            Only payer inquiries not already attached to this project are shown.
            Selecting an inquiry here moves it from any other project — each
            inquiry belongs to one project at a time.
          </p>
          {loadingAll ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading payer inquiries…
            </div>
          ) : (
            <MultiSelectCheckList
              value={draft}
              onChange={setDraft}
              options={availableOptions}
              placeholder="Search by name or payer…"
            />
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={commitAttach} disabled={saving || draft.length === 0}>
              {saving ? 'Attaching…' : `Attach ${draft.length || ''}`.trim()}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelPicker} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
