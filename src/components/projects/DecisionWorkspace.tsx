import { useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Calendar } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { SearchableSelect } from '../common/SearchableSelect';
import { useProjectDecisions, useCreateProjectDecision, useUpdateProjectDecision, useDeactivateProjectDecision } from '../../hooks/useProjectDecisions';
import { useProjectMeetingLinks } from '../../hooks/useProjectMeetingLinks';
import { DECISION_STATUS, DECISION_IMPACT } from '../../lib/constants';
import { cn } from '../../lib/utils';
import type { ProjectDecision, ProjectDecisionCreate, ProjectDecisionUpdate } from '../../models/projectDecision.model';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
// Decision Owner picker: org-wide user search (2026-07-22 per operator request).
// Previously used useProjectScopedUsers which limited results to primary +
// contributing team members, but projects without a fleshed-out team roster
// (e.g. the "Chandra test" project) surfaced an empty picker with no way to
// pick anyone. Same picker semantics as the Project Manager / Executive
// Sponsor pickers on the Governance tab.
import { useUserSearch } from '../../hooks/useIntakeLookups';
import { fmtDateOnly, todayLocalYmd } from '../../lib/dateOnly';
import { emitMonitorItemAssigned } from '../../lib/notify';
import { getCurrentUserId } from '../../lib/dataverseClient';

interface DecisionWorkspaceProps {
  projectId: string;
  canEdit?: boolean;
}

const statusLabel = (v: number) => v === DECISION_STATUS.Approved ? 'Approved' : v === DECISION_STATUS.Rejected ? 'Rejected' : v === DECISION_STATUS.Deferred ? 'Deferred' : 'Proposed';
const statusCls = (v: number) => v === DECISION_STATUS.Approved ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : v === DECISION_STATUS.Rejected ? 'bg-rose-100 text-rose-700 border-rose-300' : v === DECISION_STATUS.Deferred ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-slate-100 text-slate-700 border-slate-300';
const impactLabel = (v?: number) => v === DECISION_IMPACT.High ? 'High' : v === DECISION_IMPACT.Medium ? 'Medium' : v === DECISION_IMPACT.Low ? 'Low' : null;
const impactCls = (v?: number) => v === DECISION_IMPACT.High ? 'text-rose-600' : v === DECISION_IMPACT.Medium ? 'text-amber-600' : 'text-muted-foreground';

export function DecisionWorkspace({ projectId, canEdit = true }: DecisionWorkspaceProps) {
  const { data: decisions = [], isLoading } = useProjectDecisions(projectId);
  const { data: meetings = [] } = useProjectMeetingLinks(projectId);
  const createDecision = useCreateProjectDecision(projectId);
  const updateDecision = useUpdateProjectDecision(projectId);
  const deactivateDecision = useDeactivateProjectDecision(projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editingDecision, setEditingDecision] = useState<ProjectDecision | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState(String(DECISION_STATUS.Proposed));
  const [impact, setImpact] = useState('');
  const [impactDesc, setImpactDesc] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [meetingLinkId, setMeetingLinkId] = useState('');
  const [decisionDate, setDecisionDate] = useState(todayLocalYmd());

  const { searchUsers, resolveUserLabel } = useUserSearch();

  function openCreate() {
    setEditingDecision(null);
    setTitle(''); setDescription(''); setRationale(''); setStatus(String(DECISION_STATUS.Proposed));
    setImpact(''); setImpactDesc(''); setOwnerId(''); setMeetingLinkId('');
    setDecisionDate(todayLocalYmd());
    setFormOpen(true);
  }

  function openEdit(d: ProjectDecision) {
    setEditingDecision(d);
    setTitle(d.pmo_name); setDescription(d.pmo_description ?? ''); setRationale(d.pmo_rationale ?? '');
    setStatus(String(d.pmo_status)); setImpact(d.pmo_impact != null ? String(d.pmo_impact) : '');
    setImpactDesc(d.pmo_impactdescription ?? ''); setOwnerId(d['_pmo_decisionowner_value'] ?? '');
    setMeetingLinkId(d['_pmo_meetinglink_value'] ?? '');
    setDecisionDate(d.pmo_decisiondate);
    setFormOpen(true);
  }

  function handleSave() {
    if (!title.trim() || !description.trim()) return;
    setFormOpen(false);
    if (editingDecision) {
      const payload: ProjectDecisionUpdate = {
        pmo_name: title.trim(), pmo_description: description.trim(), pmo_rationale: rationale.trim() || undefined,
        pmo_status: Number(status), pmo_impact: impact ? Number(impact) : undefined, pmo_impactdescription: impactDesc.trim() || undefined,
      };
      if (ownerId) payload['pmo_DecisionOwner@odata.bind'] = `/systemusers(${ownerId})`;
      if (meetingLinkId) payload['pmo_MeetingLink@odata.bind'] = `/pmo_projectmeetinglinks(${meetingLinkId})`;
      const prevOwner = (editingDecision['_pmo_decisionowner_value'] ?? '').replace(/[{}]/g, '').trim().toLowerCase();
      updateDecision.mutate(
        { id: editingDecision.pmo_projectdecisionid, payload },
        {
          onSuccess: () => {
            // Notify only when the owner changed to a different person.
            if (ownerId && ownerId.toLowerCase() !== prevOwner) {
              void emitMonitorItemAssigned({ assigneeUserId: ownerId, actorUserId: getCurrentUserId(), kind: 'decision', itemName: title.trim(), projectId });
            }
          },
        },
      );
    } else {
      const payload: ProjectDecisionCreate = {
        pmo_name: title.trim(), pmo_description: description.trim(), pmo_rationale: rationale.trim() || undefined,
        pmo_decisiondate: decisionDate, pmo_status: Number(status),
        pmo_impact: impact ? Number(impact) : undefined, pmo_impactdescription: impactDesc.trim() || undefined,
        'pmo_Project@odata.bind': `/msdyn_projects(${projectId})`,
      };
      if (ownerId) payload['pmo_DecisionOwner@odata.bind'] = `/systemusers(${ownerId})`;
      if (meetingLinkId) payload['pmo_MeetingLink@odata.bind'] = `/pmo_projectmeetinglinks(${meetingLinkId})`;
      createDecision.mutate(payload, {
        onSuccess: () => {
          if (ownerId) {
            void emitMonitorItemAssigned({ assigneeUserId: ownerId, actorUserId: getCurrentUserId(), kind: 'decision', itemName: title.trim(), projectId });
          }
        },
      });
    }
  }

  const meetingOptions = meetings.map((m) => ({ value: m.pmo_projectmeetinglinkid, label: `${m.pmo_meetingsubject} (${fmtDateOnly(m.pmo_meetingdatetime)})` }));
  const selectCls = 'w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Decision Log</h3>
        <Button size="sm" onClick={openCreate} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}><Plus className="h-3.5 w-3.5 mr-1" />Add Decision</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>
      ) : decisions.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <p className="text-sm font-medium text-foreground">No decisions recorded</p>
          <p className="text-xs text-muted-foreground mt-1">Decisions can also be captured from meeting action items.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => {
            const expanded = expandedId === d.pmo_projectdecisionid;
            const saving = !!(d as unknown as { _saving?: boolean })._saving;
            const linkedMeeting = meetings.find((m) => m.pmo_projectmeetinglinkid === d['_pmo_meetinglink_value']);
            return (
              <div key={d.pmo_projectdecisionid} className="rounded-lg border bg-card relative">
                {saving && (
                  <div className="absolute inset-0 bg-card/70 flex items-center justify-center z-10 rounded-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                <button type="button" className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => !saving && setExpandedId(expanded ? null : d.pmo_projectdecisionid)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{d.pmo_name ?? d.pmo_description}</span>
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', statusCls(d.pmo_status))}>{statusLabel(d.pmo_status)}</span>
                      {d.pmo_impact != null && <span className={cn('text-[10px] font-medium', impactCls(d.pmo_impact))}>{impactLabel(d.pmo_impact)} Impact</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{fmtDateOnly(d.pmo_decisiondate)}</span>
                      {d['_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue'] && <span>Owner: {d['_pmo_decisionowner_value@OData.Community.Display.V1.FormattedValue']}</span>}
                      {linkedMeeting && <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{linkedMeeting.pmo_meetingsubject}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={saving} onClick={(e) => { e.stopPropagation(); openEdit(d); }}><Pencil className="h-3 w-3" /></Button>}
                    {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={saving || deactivateDecision.isPending} onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete decision "${d.pmo_name ?? d.pmo_description}"? This cannot be undone.`)) {
                        deactivateDecision.mutate(d.pmo_projectdecisionid);
                      }
                    }}><Trash2 className="h-3 w-3 text-destructive" /></Button>}
                  </div>
                </button>
                {expanded && (
                  <div className="px-4 pb-4 border-t pt-3 space-y-2 text-xs">
                    <div><p className="font-semibold text-muted-foreground">Description</p><p className="text-foreground whitespace-pre-wrap">{d.pmo_description}</p></div>
                    {d.pmo_rationale && <div><p className="font-semibold text-muted-foreground">Rationale</p><p className="text-foreground">{d.pmo_rationale}</p></div>}
                    {d.pmo_impactdescription && <div><p className="font-semibold text-muted-foreground">Impact Description</p><p className="text-foreground">{d.pmo_impactdescription}</p></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingDecision ? 'Edit Decision' : 'Add Decision'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-sm font-medium">Title *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Decision title" /></div>
            <div><label className="text-sm font-medium">Description *</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What was decided" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <div><label className="text-sm font-medium">Rationale</label>
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} placeholder="Why this decision was made" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-sm font-medium">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
                  <option value={String(DECISION_STATUS.Proposed)}>Proposed</option>
                  <option value={String(DECISION_STATUS.Approved)}>Approved</option>
                  <option value={String(DECISION_STATUS.Rejected)}>Rejected</option>
                  <option value={String(DECISION_STATUS.Deferred)}>Deferred</option>
                </select></div>
              <div><label className="text-sm font-medium">Impact</label>
                <select value={impact} onChange={(e) => setImpact(e.target.value)} className={selectCls}>
                  <option value="">None</option>
                  <option value={String(DECISION_IMPACT.High)}>High</option>
                  <option value={String(DECISION_IMPACT.Medium)}>Medium</option>
                  <option value={String(DECISION_IMPACT.Low)}>Low</option>
                </select></div>
              <div><label className="text-sm font-medium">Date</label><Input type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} /></div>
            </div>
            {impact && <div><label className="text-sm font-medium">Impact Description</label><Input value={impactDesc} onChange={(e) => setImpactDesc(e.target.value)} placeholder="Describe the impact" /></div>}
            <div><label className="text-sm font-medium">Decision Owner</label><SearchableSelect value={ownerId} onChange={setOwnerId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for owner" /></div>
            {meetingOptions.length > 0 && (
              <div><label className="text-sm font-medium">Linked Meeting</label>
                <select value={meetingLinkId} onChange={(e) => setMeetingLinkId(e.target.value)} className={selectCls}>
                  <option value="">None</option>
                  {meetingOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></div>
            )}
            <Button size="sm" onClick={handleSave} disabled={createDecision.isPending || updateDecision.isPending || !title.trim() || !description.trim()}>
              {(createDecision.isPending || updateDecision.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {editingDecision ? 'Save' : 'Add'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
