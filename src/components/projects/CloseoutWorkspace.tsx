import { useState } from 'react';
import { Check, Circle, AlertTriangle, Plus, CheckCircle2, Loader2, Archive } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useCloseoutReadiness, useCreateProjectCloseout, useUpdateProjectCloseout } from '../../hooks/useProjectCloseout';
import { useArtifactReadiness } from '../../hooks/useRequiredArtifacts';
import { useProjectGates } from '../../hooks/useProjectGates';
import { GATE_TYPE, GATE_STATUS, ARTIFACT_STATUS, ARTIFACT_TYPE } from '../../lib/constants';
import * as dv from '../../lib/dataverseClient';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';
import { useDataSource, usesCustomTables } from '../../lib/taskSource';

interface CloseoutWorkspaceProps {
  projectId: string;
}

export function CloseoutWorkspace({ projectId }: CloseoutWorkspaceProps) {
  const dataSource = useDataSource();
  const { total, done, isReady, items } = useCloseoutReadiness(projectId);
  const { definitions, statuses } = useArtifactReadiness(projectId);
  const { data: gates = [] } = useProjectGates(projectId);
  const createItem = useCreateProjectCloseout(projectId);
  const updateItem = useUpdateProjectCloseout(projectId);

  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const closeoutGate = gates.find((g) => g.pmo_gatetype === GATE_TYPE.Closeout);
  const closeoutGateReady = !closeoutGate || closeoutGate.pmo_status === GATE_STATUS.Passed || closeoutGate.pmo_status === GATE_STATUS.Waived;

  const closeoutArtifacts = definitions.filter((d) =>
    d.pmo_isrequired && (d.pmo_artifacttype === ARTIFACT_TYPE.CloseoutReport || d.pmo_artifacttype === ARTIFACT_TYPE.LessonsLearned),
  );
  const closeoutArtifactsDone = closeoutArtifacts.filter((a) => {
    const s = statuses.find((st) => st['_pmo_requiredartifact_value'] === a.pmo_requiredartifactid);
    return s && (s.pmo_status === ARTIFACT_STATUS.Complete || s.pmo_status === ARTIFACT_STATUS.Waived);
  }).length;

  const lessonsItem = items.find((i) => i.pmo_lessonslearned != null && i.pmo_lessonslearned !== '');
  const summaryItem = items.find((i) => i.pmo_outcomesummary != null && i.pmo_outcomesummary !== '');
  const hasLessons = !!lessonsItem?.pmo_lessonslearned;
  const hasSummary = !!summaryItem?.pmo_outcomesummary;

  const dimensions = [
    { label: 'Required Items', status: total === 0 ? 'complete' : done >= total ? 'complete' : done > 0 ? 'partial' : 'missing', detail: total > 0 ? `${done}/${total}` : 'None defined' },
    { label: 'Artifacts', status: closeoutArtifacts.length === 0 ? 'complete' : closeoutArtifactsDone >= closeoutArtifacts.length ? 'complete' : 'partial', detail: closeoutArtifacts.length > 0 ? `${closeoutArtifactsDone}/${closeoutArtifacts.length}` : 'None required' },
    { label: 'Gate', status: closeoutGateReady ? 'complete' : 'missing', detail: closeoutGate ? (closeoutGateReady ? 'Passed' : 'Pending') : 'Not configured' },
    { label: 'Lessons Learned', status: hasLessons ? 'complete' : 'missing', detail: hasLessons ? 'Captured' : 'Not captured' },
    { label: 'Outcome Summary', status: hasSummary ? 'complete' : 'missing', detail: hasSummary ? 'Captured' : 'Not captured' },
  ];
  const allReady = dimensions.every((d) => d.status === 'complete');
  const readyCount = dimensions.filter((d) => d.status === 'complete').length;

  async function handleAddItem() {
    if (!newItem.trim()) return;
    await createItem.mutateAsync({
      pmo_name: newItem.trim(),
      pmo_checklistitem: newItem.trim(),
      pmo_notes: newNotes.trim() || undefined,
      'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
    });
    toast.success('Closeout item added');
    setAddOpen(false);
    setNewItem('');
    setNewNotes('');
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      if (usesCustomTables(dataSource)) {
        // Custom source: the authored row is pmo_project; archive BOTH it and
        // the same-GUID msdyn_project shell so the list (reads pmo_projects,
        // statecode eq 0) hides it and the reverse-sync stays consistent.
        await dv.deactivate('pmo_projects', projectId).catch(() => undefined);
        await dv.update('msdyn_projects', projectId, { statecode: 1 });
      } else {
        await dv.update('msdyn_projects', projectId, { statecode: 1 });
      }
      toast.success('Project archived');
      setArchiveConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setArchiving(false);
    }
  }

  const firstItem = items[0];

  return (
    <div className="space-y-4">
      {/* Readiness Banner */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-foreground">Closeout Readiness</h4>
          <span className={cn('text-sm font-bold', allReady ? 'text-emerald-600' : 'text-amber-600')}>
            {readyCount}/{dimensions.length} complete
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-3">
          <div className={cn('h-full rounded-full', allReady ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${(readyCount / dimensions.length) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {dimensions.map((d) => (
            <span key={d.label} className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border',
              d.status === 'complete' ? 'border-emerald-300 bg-emerald-100/60 text-emerald-700' :
              d.status === 'partial' ? 'border-amber-300 bg-amber-100/60 text-amber-700' :
              'border-rose-300 bg-rose-100/60 text-rose-700',
            )}>
              {d.status === 'complete' ? <Check className="h-3 w-3" /> : d.status === 'partial' ? <AlertTriangle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* Required Completion Items */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">
            Required Items
            {total > 0 && <span className={cn('ml-2 text-xs font-normal', isReady ? 'text-emerald-600' : 'text-amber-600')}>{done}/{total}</span>}
          </h4>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closeout items defined.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div key={item.pmo_projectcloseoutid} className="flex items-center gap-3 py-1.5">
                <button type="button"
                  className={cn('h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                    item.pmo_iscomplete ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-muted-foreground/40')}
                  onClick={() => updateItem.mutate({ id: item.pmo_projectcloseoutid, payload: {
                    pmo_iscomplete: !item.pmo_iscomplete,
                    pmo_completeddate: !item.pmo_iscomplete ? toDataverseDateOnly(todayLocalYmd()) : undefined,
                    'pmo_CompletedBy@odata.bind': !item.pmo_iscomplete ? `/systemusers(${dv.getCurrentUserId()})` : null,
                  } })}>
                  {item.pmo_iscomplete && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
                <div className="flex-1">
                  <p className={cn('text-sm', item.pmo_iscomplete ? 'text-muted-foreground line-through' : 'text-foreground')}>{item.pmo_checklistitem}</p>
                  {item.pmo_notes && <p className="text-xs text-muted-foreground mt-0.5">{item.pmo_notes}</p>}
                </div>
                {item.pmo_iscomplete && item['_pmo_completedby_value@OData.Community.Display.V1.FormattedValue'] && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{item['_pmo_completedby_value@OData.Community.Display.V1.FormattedValue']}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lessons Learned */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">Lessons Learned</h4>
        <textarea
          defaultValue={firstItem?.pmo_lessonslearned ?? ''}
          onBlur={(e) => {
            if (firstItem && e.target.value !== (firstItem.pmo_lessonslearned ?? '')) {
              updateItem.mutate({ id: firstItem.pmo_projectcloseoutid, payload: { pmo_lessonslearned: e.target.value } },
                { onSuccess: () => toast.success('Lessons learned saved') });
            }
          }}
          rows={4}
          placeholder="What went well? What could be improved? What would you do differently?"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Outcome Summary */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-semibold text-foreground mb-2">Outcome Summary</h4>
        <textarea
          defaultValue={firstItem?.pmo_outcomesummary ?? ''}
          onBlur={(e) => {
            if (firstItem && e.target.value !== (firstItem.pmo_outcomesummary ?? '')) {
              updateItem.mutate({ id: firstItem.pmo_projectcloseoutid, payload: { pmo_outcomesummary: e.target.value } },
                { onSuccess: () => toast.success('Outcome summary saved') });
            }
          }}
          rows={4}
          placeholder="What was delivered? What is the final state? Who owns ongoing operations?"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Archive */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Archive Project</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Deactivate the project record after all closeout requirements are met.</p>
          </div>
          <Button size="sm" variant={allReady ? 'default' : 'outline'} disabled={!allReady} onClick={() => setArchiveConfirmOpen(true)}>
            <Archive className="h-3.5 w-3.5 mr-1" />Archive
          </Button>
        </div>
        {!allReady && <p className="text-xs text-amber-600 mt-2">Complete all readiness dimensions before archiving.</p>}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Closeout Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="What needs to be completed" />
            <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Notes (optional)" />
            <Button size="sm" onClick={handleAddItem} disabled={createItem.isPending || !newItem.trim()}>
              {createItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Add
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveConfirmOpen}
        title="Archive Project"
        message="This will deactivate the project record. This action can be reversed by reactivating the record in Dataverse."
        confirmLabel="Archive"
        isLoading={archiving}
        onConfirm={handleArchive}
        onCancel={() => setArchiveConfirmOpen(false)}
      />
    </div>
  );
}
