import { useState } from 'react';
import { Check, AlertTriangle, Shield, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { useProjectGates, useUpdateProjectGate, useCreateGateDecision, useGateDecisions } from '../../hooks/useProjectGates';
import { useArtifactReadiness } from '../../hooks/useRequiredArtifacts';
import { GATE_TYPE, GATE_STATUS, GATE_DECISION } from '../../lib/constants';
import * as dv from '../../lib/dataverseClient';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { fmtDateOnly, toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

interface GateWorkspaceProps {
  projectId: string;
}

const typeLabel = (v: number) =>
  v === GATE_TYPE.Initiation ? 'Initiation' : v === GATE_TYPE.Planning ? 'Planning' : v === GATE_TYPE.Execution ? 'Execution' : 'Closeout';

const statusMeta = (v: number) => ({
  label: v === GATE_STATUS.Passed ? 'Passed' : v === GATE_STATUS.Failed ? 'Failed' : v === GATE_STATUS.InProgress ? 'In Progress' : v === GATE_STATUS.Waived ? 'Waived' : 'Not Started',
  cls: v === GATE_STATUS.Passed ? 'text-emerald-600' : v === GATE_STATUS.Failed ? 'text-rose-600' : v === GATE_STATUS.InProgress ? 'text-blue-600' : 'text-muted-foreground',
  bg: v === GATE_STATUS.Passed ? 'bg-emerald-500' : v === GATE_STATUS.Failed ? 'bg-rose-500' : v === GATE_STATUS.InProgress ? 'bg-blue-500' : v === GATE_STATUS.Waived ? 'bg-muted-foreground' : 'bg-muted-foreground/30',
});

function GateDecisionHistory({ gateId }: { gateId: string }) {
  const { data: decisions = [] } = useGateDecisions(gateId);
  if (decisions.length === 0) return <p className="text-xs text-muted-foreground">No decisions recorded.</p>;
  return (
    <div className="space-y-1">
      {decisions.map((d) => (
        <div key={d.pmo_projectgatedecisionid} className="text-xs rounded-md bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={d.pmo_decision === GATE_DECISION.Approved ? 'text-emerald-600 font-medium' : d.pmo_decision === GATE_DECISION.Rejected ? 'text-rose-600 font-medium' : 'text-amber-600 font-medium'}>
              {d.pmo_decision === GATE_DECISION.Approved ? 'Approved' : d.pmo_decision === GATE_DECISION.Rejected ? 'Rejected' : 'Deferred'}
            </span>
            <span className="text-muted-foreground">{d['_pmo_decidedby_value@OData.Community.Display.V1.FormattedValue'] ?? 'Unknown'}</span>
            <span className="text-muted-foreground ml-auto">{fmtDateOnly(d.pmo_decisiondate)}</span>
          </div>
          {d.pmo_notes && <p className="text-muted-foreground mt-1">{d.pmo_notes}</p>}
        </div>
      ))}
    </div>
  );
}

export function GateWorkspace({ projectId }: GateWorkspaceProps) {
  const { data: gates = [], isLoading } = useProjectGates(projectId);
  const updateGate = useUpdateProjectGate(projectId);
  const createDecision = useCreateGateDecision(projectId);
  const { total: artTotal, done: artDone } = useArtifactReadiness(projectId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approvalGateId, setApprovalGateId] = useState<string | null>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | 'defer'>('approve');
  const [approvalRationale, setApprovalRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeGate = gates.find((g) => g.pmo_status === GATE_STATUS.NotStarted || g.pmo_status === GATE_STATUS.InProgress);
  const passedCount = gates.filter((g) => g.pmo_status === GATE_STATUS.Passed || g.pmo_status === GATE_STATUS.Waived).length;

  async function handleApproval() {
    if (!approvalGateId || !approvalRationale.trim()) return;
    setSubmitting(true);
    const gate = gates.find((g) => g.pmo_projectgateid === approvalGateId);
    const decisionType = approvalAction === 'approve' ? GATE_DECISION.Approved : approvalAction === 'reject' ? GATE_DECISION.Rejected : GATE_DECISION.Deferred;
    const newStatus = approvalAction === 'approve' ? GATE_STATUS.Passed : approvalAction === 'reject' ? GATE_STATUS.Failed : GATE_STATUS.InProgress;

    try {
      await createDecision.mutateAsync({
        pmo_name: `${gate?.pmo_name} — ${approvalAction === 'approve' ? 'Approved' : approvalAction === 'reject' ? 'Rejected' : 'Deferred'}`,
        pmo_decision: decisionType,
        pmo_decisiondate: toDataverseDateOnly(todayLocalYmd())!,
        pmo_notes: approvalRationale.trim(),
        'pmo_Gate@odata.bind': `/pmo_projectgates(${approvalGateId})`,
        'pmo_DecidedBy@odata.bind': `/systemusers(${dv.getCurrentUserId()})`,
      });
      await updateGate.mutateAsync({ id: approvalGateId, payload: {
        pmo_status: newStatus,
        pmo_rationale: approvalRationale.trim(),
        ...(approvalAction === 'approve' ? { pmo_completeddate: toDataverseDateOnly(todayLocalYmd()) } : {}),
      } });
      toast.success(`Gate ${approvalAction === 'approve' ? 'approved' : approvalAction === 'reject' ? 'rejected' : 'deferred'}`);
      setApprovalGateId(null);
      setApprovalRationale('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading gates...</div>;

  return (
    <div className="space-y-4">
      {/* Gate Timeline */}
      {gates.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-foreground">Lifecycle Progress</h4>
            <span className="text-xs text-muted-foreground">{passedCount}/{gates.length} passed</span>
          </div>
          <div className="flex items-center gap-1">
            {gates.map((g, i) => {
              const sm = statusMeta(g.pmo_status);
              return (
                <div key={g.pmo_projectgateid} className="flex items-center flex-1">
                  <button type="button" onClick={() => setExpandedId(expandedId === g.pmo_projectgateid ? null : g.pmo_projectgateid)}
                    className={cn('h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 transition-all', sm.bg,
                      expandedId === g.pmo_projectgateid && 'ring-2 ring-primary ring-offset-2')}>
                    {g.pmo_status === GATE_STATUS.Passed ? <Check className="h-4 w-4" /> : i + 1}
                  </button>
                  {i < gates.length - 1 && <div className={cn('h-0.5 flex-1', g.pmo_status === GATE_STATUS.Passed ? 'bg-emerald-500' : 'bg-muted')} />}
                </div>
              );
            })}
          </div>
          <div className="flex mt-1">
            {gates.map((g) => (
              <div key={g.pmo_projectgateid} className="flex-1 text-center">
                <p className="text-[10px] text-muted-foreground truncate">{typeLabel(g.pmo_gatetype)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Gate Card */}
      {activeGate && (
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Active Gate: {activeGate.pmo_name}
            </h4>
            <span className={cn('text-xs font-medium', statusMeta(activeGate.pmo_status).cls)}>
              {statusMeta(activeGate.pmo_status).label}
            </span>
          </div>

          {activeGate.pmo_targetdate && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Due: {fmtDateOnly(activeGate.pmo_targetdate)}
              {new Date(activeGate.pmo_targetdate) < new Date() && <span className="text-rose-600 font-medium ml-1">Overdue</span>}
            </div>
          )}

          {/* Readiness Conditions */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Readiness Conditions</p>
            {(() => {
              const gateIdx = gates.findIndex((g) => g.pmo_projectgateid === activeGate.pmo_projectgateid);
              const predecessorGate = gateIdx > 0 ? gates[gateIdx - 1] : null;
              const predPassed = !predecessorGate || predecessorGate.pmo_status === GATE_STATUS.Passed || predecessorGate.pmo_status === GATE_STATUS.Waived;
              const artifactsReady = artTotal === 0 || artDone >= artTotal;
              const conditions = [
                { label: 'Predecessor gate passed', met: predPassed, detail: predecessorGate ? `${predecessorGate.pmo_name}: ${statusMeta(predecessorGate.pmo_status).label}` : 'No predecessor' },
                { label: 'Required artifacts complete', met: artifactsReady, detail: artTotal > 0 ? `${artDone}/${artTotal}` : 'None required' },
              ];
              return conditions.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  {c.met ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" />}
                  <span className={c.met ? 'text-foreground' : 'text-rose-600'}>{c.label}</span>
                  <span className="text-muted-foreground ml-auto">{c.detail}</span>
                </div>
              ));
            })()}
          </div>

          {/* Approval Actions */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button size="sm" onClick={() => { setApprovalGateId(activeGate.pmo_projectgateid); setApprovalAction('approve'); }}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => { setApprovalGateId(activeGate.pmo_projectgateid); setApprovalAction('reject'); }}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => { setApprovalGateId(activeGate.pmo_projectgateid); setApprovalAction('defer'); }}>Defer</Button>
          </div>
        </div>
      )}

      {/* All Gates */}
      {gates.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <Shield className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">No governance gates configured</p>
          <p className="text-xs text-muted-foreground mt-1">Gate sets are provisioned during project creation from admin-configured templates.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Gates</p>
          {gates.map((g) => {
            const sm = statusMeta(g.pmo_status);
            const expanded = expandedId === g.pmo_projectgateid;
            return (
              <div key={g.pmo_projectgateid} className="rounded-lg border bg-card">
                <button type="button" className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => setExpandedId(expanded ? null : g.pmo_projectgateid)}>
                  <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0', sm.bg)}>
                    {g.pmo_status === GATE_STATUS.Passed ? <Check className="h-3 w-3" /> : g.pmo_gateorder}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{g.pmo_name}</p>
                    <p className="text-xs text-muted-foreground">{typeLabel(g.pmo_gatetype)}{g.pmo_targetdate ? ` · Due ${fmtDateOnly(g.pmo_targetdate)}` : ''}</p>
                  </div>
                  <span className={cn('text-xs font-medium', sm.cls)}>{sm.label}</span>
                  {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expanded && (
                  <div className="px-4 pb-4 border-t pt-3 space-y-2">
                    {g.pmo_rationale && <div><p className="text-xs font-semibold text-muted-foreground">Rationale</p><p className="text-xs text-foreground">{g.pmo_rationale}</p></div>}
                    {g.pmo_notes && <div><p className="text-xs font-semibold text-muted-foreground">Notes</p><p className="text-xs text-foreground">{g.pmo_notes}</p></div>}
                    <div><p className="text-xs font-semibold text-muted-foreground mb-1">Decision History</p><GateDecisionHistory gateId={g.pmo_projectgateid} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Approval Dialog */}
      {approvalGateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setApprovalGateId(null)}>
          <div className="bg-card rounded-lg border shadow-lg max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">
              {approvalAction === 'approve' ? 'Approve Gate' : approvalAction === 'reject' ? 'Reject Gate' : 'Defer Gate'}
            </h3>
            <div>
              <label className="text-sm font-medium">Rationale *</label>
              <textarea value={approvalRationale} onChange={(e) => setApprovalRationale(e.target.value)} rows={4}
                placeholder={approvalAction === 'approve' ? 'Why is this gate being approved?' : approvalAction === 'reject' ? 'Why is this gate being rejected?' : 'Why is this decision being deferred?'}
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setApprovalGateId(null)}>Cancel</Button>
              <Button size="sm" onClick={handleApproval} disabled={submitting || !approvalRationale.trim()}
                className={approvalAction === 'reject' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}>
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                {approvalAction === 'approve' ? 'Approve' : approvalAction === 'reject' ? 'Reject' : 'Defer'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
