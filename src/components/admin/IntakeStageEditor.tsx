import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown, Plus, Loader2, Save, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { INTAKE_CONFIGURABLE_FIELDS, ARTIFACT_TYPE_LABELS, GATE_TYPE, ENTITY_SETS } from '../../lib/constants';
import { validateRequiredFields, validateRequiredArtifactTypes } from '../../lib/intakeValidation';
import { useCreateGateSetItem, useUpdateGateSetItem, useDeleteGateSetItem, useGateSetItems } from '../../hooks/useGateSetTemplates';
import type { GateSetItem } from '../../models/gateSetTemplate.model';
import { toast } from '../../hooks/useToast';
import * as dv from '../../lib/dataverseClient';

interface IntakeStageEditorProps {
  workflowId: string;
}

const FIELD_KEYS = Object.keys(INTAKE_CONFIGURABLE_FIELDS);
const ARTIFACT_ENTRIES = Object.entries(ARTIFACT_TYPE_LABELS).map(([v, l]) => ({ value: Number(v), label: l }));

function parseJsonArray<T>(json: string | undefined, fallback: T[]): T[] {
  if (!json) return fallback;
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}

interface StageFormState {
  label: string;
  requiredFields: string[];
  requiredArtifacts: number[];
  requiresApproval: boolean;
  approverGroupId: string;
}

function stageToForm(stage: GateSetItem): StageFormState {
  return {
    label: stage.pmo_stagelabel || stage.pmo_name || '',
    requiredFields: parseJsonArray<string>(stage.pmo_requiredfieldsjson, []),
    requiredArtifacts: parseJsonArray<number>(stage.pmo_requiredartifacttypesjson, []),
    requiresApproval: stage.pmo_requiresapproval ?? false,
    approverGroupId: stage.pmo_approvergroupid ?? '',
  };
}

function ApproverGroupPicker({ value, onChange, hasError }: {
  value: string; onChange: (v: string) => void; hasError: boolean;
}) {
  const { data: aadTeams = [], isPending } = useQuery({
    queryKey: ['aadGroupTeams'],
    queryFn: async () => {
      const teams = await dv.list<{ teamid: string; name: string; azureactivedirectoryobjectid?: string }>(
        ENTITY_SETS.team,
        { $select: ['teamid', 'name', 'azureactivedirectoryobjectid'], $filter: 'teamtype eq 2', $orderby: 'name asc' },
      );
      return teams.filter((t) => !!t.azureactivedirectoryobjectid);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isPending) {
    return <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Loading security groups...</p>;
  }

  if (aadTeams.length === 0) {
    return (
      <div>
        <label className="text-xs text-muted-foreground">Approver Group *</label>
        <p className="text-xs text-amber-600 mt-1">No AAD security groups are synced to this environment. Sync a group in the Power Platform admin center first.</p>
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="AAD Group Object ID (manual)" className="mt-1" />
        {hasError && <p className="text-xs text-destructive mt-1">Approver group is required when approval is enabled.</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="text-xs text-muted-foreground">Approver Group *</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring mt-1"
      >
        <option value="">-- Select approver group --</option>
        {aadTeams.map((t) => (
          <option key={t.teamid} value={t.azureactivedirectoryobjectid!}>{t.name}</option>
        ))}
      </select>
      {hasError && <p className="text-xs text-destructive mt-1">Approver group is required when approval is enabled.</p>}
    </div>
  );
}

function StageCard({ stage, index, total, workflowId, onMoveUp, onMoveDown }: {
  stage: GateSetItem;
  index: number;
  total: number;
  workflowId: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<StageFormState>(stageToForm(stage));
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [artErrors, setArtErrors] = useState<string[]>([]);
  const updateItem = useUpdateGateSetItem();
  const deleteItem = useDeleteGateSetItem();

  function toggleField(field: string) {
    setForm((f) => {
      const next = f.requiredFields.includes(field)
        ? f.requiredFields.filter((ff) => ff !== field)
        : [...f.requiredFields, field];
      const result = validateRequiredFields(JSON.stringify(next));
      setFieldErrors(result.errors);
      return { ...f, requiredFields: next };
    });
  }

  function toggleArtifact(val: number) {
    setForm((f) => {
      const next = f.requiredArtifacts.includes(val)
        ? f.requiredArtifacts.filter((a) => a !== val)
        : [...f.requiredArtifacts, val];
      const result = validateRequiredArtifactTypes(JSON.stringify(next));
      setArtErrors(result.errors);
      return { ...f, requiredArtifacts: next };
    });
  }

  const hasApprovalError = form.requiresApproval && !form.approverGroupId.trim();
  const hasErrors = fieldErrors.length > 0 || artErrors.length > 0 || hasApprovalError || !form.label.trim();

  async function handleSave() {
    if (hasErrors) return;
    await updateItem.mutateAsync({
      id: stage.pmo_gatesetitemid,
      gateSetId: workflowId,
      payload: {
        pmo_name: form.label.trim(),
        pmo_stagelabel: form.label.trim(),
        pmo_requiredfieldsjson: JSON.stringify(form.requiredFields),
        pmo_requiredartifacttypesjson: JSON.stringify(form.requiredArtifacts),
        pmo_requiresapproval: form.requiresApproval,
        pmo_approvergroupid: form.requiresApproval ? form.approverGroupId.trim() : undefined,
      },
    });
    toast.success(`Stage "${form.label.trim()}" saved`);
  }

  async function handleDelete() {
    if (!confirm(`Delete stage "${form.label || stage.pmo_name}"?`)) return;
    await deleteItem.mutateAsync({ id: stage.pmo_gatesetitemid, gateSetId: workflowId });
    toast.success('Stage deleted');
  }

  const label = form.label || stage.pmo_name || `Stage ${index + 1}`;

  return (
    <div className="rounded-lg border bg-card">
      <button type="button" className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setExpanded(!expanded)}>
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
          {index + 1}
        </span>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium text-foreground flex-1">{label}</span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{form.requiredFields.length} fields</span>
          <span>·</span>
          <span>{form.requiredArtifacts.length} artifacts</span>
          {form.requiresApproval && (
            <>
              <span>·</span>
              <Shield className="h-3 w-3 text-amber-500" />
            </>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Stage Label *</label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g., Business Case Review" />
            {!form.label.trim() && <p className="text-xs text-destructive mt-1">Stage label is required.</p>}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Required Fields</label>
            <div className="grid grid-cols-2 gap-1.5">
              {FIELD_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.requiredFields.includes(k)} onChange={() => toggleField(k)} className="rounded" />
                  {INTAKE_CONFIGURABLE_FIELDS[k]}
                </label>
              ))}
            </div>
            {fieldErrors.map((e, i) => <p key={i} className="text-xs text-destructive mt-1">{e}</p>)}
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Required Artifact Types</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ARTIFACT_ENTRIES.map((a) => (
                <label key={a.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.requiredArtifacts.includes(a.value)} onChange={() => toggleArtifact(a.value)} className="rounded" />
                  {a.label}
                </label>
              ))}
            </div>
            {artErrors.map((e, i) => <p key={i} className="text-xs text-destructive mt-1">{e}</p>)}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} className="rounded" />
              Requires PMO Approval
            </label>
            {form.requiresApproval && (
              <ApproverGroupPicker
                value={form.approverGroupId}
                onChange={(v) => setForm({ ...form, approverGroupId: v })}
                hasError={hasApprovalError}
              />
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t">
            <Button size="sm" onClick={handleSave} disabled={updateItem.isPending || hasErrors}>
              {updateItem.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save Stage
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onMoveUp} disabled={index === 0}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onMoveDown} disabled={index === total - 1}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleteItem.isPending}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntakeStageEditor({ workflowId }: IntakeStageEditorProps) {
  const { data: stages = [], isPending } = useGateSetItems(workflowId);
  const createItem = useCreateGateSetItem();
  const updateItem = useUpdateGateSetItem();

  const sortedStages = [...stages].sort((a, b) => a.pmo_gateorder - b.pmo_gateorder);

  async function addStage() {
    const nextOrder = sortedStages.length;
    await createItem.mutateAsync({
      pmo_name: `Stage ${nextOrder + 1}`,
      pmo_gatetype: GATE_TYPE.Initiation,
      pmo_gateorder: nextOrder,
      pmo_stagelabel: `Stage ${nextOrder + 1}`,
      pmo_requiredfieldsjson: '[]',
      pmo_requiredartifacttypesjson: '[]',
      pmo_requiresapproval: false,
      'pmo_GateSet@odata.bind': `/pmo_gatesettemplates(${workflowId})`,
    });
    toast.success('Stage added');
  }

  async function moveStage(idx: number, direction: 'up' | 'down') {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sortedStages.length) return;
    const current = sortedStages[idx];
    const target = sortedStages[targetIdx];
    await Promise.all([
      updateItem.mutateAsync({ id: current.pmo_gatesetitemid, gateSetId: workflowId, payload: { pmo_gateorder: target.pmo_gateorder } }),
      updateItem.mutateAsync({ id: target.pmo_gatesetitemid, gateSetId: workflowId, payload: { pmo_gateorder: current.pmo_gateorder } }),
    ]);
  }

  if (isPending) {
    return <div className="flex items-center gap-2 py-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading stages...</span></div>;
  }

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stages ({sortedStages.length})</p>
        <Button size="sm" variant="outline" onClick={addStage} disabled={createItem.isPending}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add Stage
        </Button>
      </div>

      {sortedStages.length === 0 && (
        <p className="text-sm text-muted-foreground py-3">No stages defined. Add at least one stage to make this workflow usable.</p>
      )}

      {sortedStages.map((stage, i) => (
        <StageCard
          key={stage.pmo_gatesetitemid}
          stage={stage}
          index={i}
          total={sortedStages.length}
          workflowId={workflowId}
          onMoveUp={() => moveStage(i, 'up')}
          onMoveDown={() => moveStage(i, 'down')}
        />
      ))}
    </div>
  );
}
