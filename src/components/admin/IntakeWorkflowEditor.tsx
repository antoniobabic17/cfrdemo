import { useState, useMemo } from 'react';
import { Save, Loader2, Plus, Pencil, Trash2, AlertTriangle, ArrowRight, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  WORKFLOW_SCOPE, TARGET_ENTITY_TYPE,
  CONVERSION_INTAKE_FIELDS, CONVERSION_PROJECT_FIELDS,
  GATE_TYPE, ARTIFACT_TYPE,
} from '../../lib/constants';
import { validateConversionRules, validateWorkflowIntegrity } from '../../lib/intakeValidation';
import {
  useIntakeWorkflows, useCreateGateSetTemplate, useUpdateGateSetTemplate, useGateSetItems,
  useCreateGateSetItem,
} from '../../hooks/useGateSetTemplates';
import type { GateSetTemplate } from '../../models/gateSetTemplate.model';
import { IntakeStageEditor } from './IntakeStageEditor';
import { toast } from '../../hooks/useToast';

interface ConversionMapping {
  intakeField: string;
  projectField: string;
  transform: 'direct' | 'odata_bind';
}

const DEFAULT_MAPPINGS: ConversionMapping[] = [
  { intakeField: 'pmo_name', projectField: 'msdyn_subject', transform: 'direct' },
  { intakeField: 'pmo_description', projectField: 'msdyn_description', transform: 'direct' },
  { intakeField: '_pmo_targetteam_value', projectField: 'pmo_PrimaryTeam@odata.bind', transform: 'odata_bind' },
];

function mappingsToJson(mappings: ConversionMapping[]): string {
  return JSON.stringify(mappings.map((m) => ({
    intakeField: m.intakeField,
    projectField: m.projectField,
    transform: m.transform,
  })));
}

function jsonToMappings(json: string | undefined): ConversionMapping[] {
  if (!json) return [...DEFAULT_MAPPINGS];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [...DEFAULT_MAPPINGS];
    return parsed.map((r: Record<string, string>) => ({
      intakeField: r.intakeField ?? '',
      projectField: r.projectField ?? '',
      transform: (r.transform as 'direct' | 'odata_bind') ?? 'direct',
    }));
  } catch { return [...DEFAULT_MAPPINGS]; }
}


interface WorkflowFormProps {
  workflow?: GateSetTemplate;
  onClose: () => void;
}

function ConversionRuleMapper({ mappings, onChange }: {
  mappings: ConversionMapping[];
  onChange: (mappings: ConversionMapping[]) => void;
}) {
  const usedIntake = new Set(mappings.map((m) => m.intakeField));
  const usedProject = new Set(mappings.map((m) => m.projectField));
  const selectCls = 'h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  function updateMapping(idx: number, side: 'intake' | 'project', value: string) {
    const next = [...mappings];
    if (side === 'intake') {
      const def = CONVERSION_INTAKE_FIELDS.find((f) => f.field === value);
      next[idx] = { ...next[idx], intakeField: value, transform: def?.transform ?? 'direct' };
    } else {
      const def = CONVERSION_PROJECT_FIELDS.find((f) => f.field === value);
      next[idx] = { ...next[idx], projectField: value, transform: def?.transform ?? next[idx].transform };
    }
    onChange(next);
  }

  function removeMapping(idx: number) { onChange(mappings.filter((_, i) => i !== idx)); }

  function addMapping() {
    const nextIntake = CONVERSION_INTAKE_FIELDS.find((f) => !usedIntake.has(f.field));
    const nextProject = CONVERSION_PROJECT_FIELDS.find((f) => !usedProject.has(f.field));
    if (!nextIntake || !nextProject) return;
    onChange([...mappings, { intakeField: nextIntake.field, projectField: nextProject.field, transform: nextIntake.transform }]);
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center text-xs text-muted-foreground font-semibold uppercase tracking-wider px-1">
        <span>Request Field</span>
        <span />
        <span>Project Field</span>
        <span />
      </div>
      {mappings.map((m, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
          <select value={m.intakeField} onChange={(e) => updateMapping(i, 'intake', e.target.value)} className={selectCls}>
            <option value="">-- Select --</option>
            {CONVERSION_INTAKE_FIELDS.map((f) => (
              <option key={f.field} value={f.field} disabled={usedIntake.has(f.field) && f.field !== m.intakeField}>
                {f.label}
              </option>
            ))}
          </select>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <select value={m.projectField} onChange={(e) => updateMapping(i, 'project', e.target.value)} className={selectCls}>
            <option value="">-- Select --</option>
            {CONVERSION_PROJECT_FIELDS.map((f) => (
              <option key={f.field} value={f.field} disabled={usedProject.has(f.field) && f.field !== m.projectField}>
                {f.label}
              </option>
            ))}
          </select>
          <button onClick={() => removeMapping(i)} className="p-1 rounded text-muted-foreground hover:text-destructive" title="Remove mapping">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addMapping} disabled={usedIntake.size >= CONVERSION_INTAKE_FIELDS.length || usedProject.size >= CONVERSION_PROJECT_FIELDS.length}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Mapping
      </Button>
    </div>
  );
}

function WorkflowForm({ workflow, onClose }: WorkflowFormProps) {
  const isNew = !workflow;
  const [name, setName] = useState(workflow?.pmo_name ?? '');
  const [targetEntity, setTargetEntity] = useState<number>(workflow?.pmo_targetentitytype ?? TARGET_ENTITY_TYPE.Project);
  const [isDefault, setIsDefault] = useState(workflow?.pmo_isdefault ?? false);
  const [mappings, setMappings] = useState<ConversionMapping[]>(() => jsonToMappings(workflow?.pmo_conversionrulesjson));
  const createMut = useCreateGateSetTemplate();
  const updateMut = useUpdateGateSetTemplate();
  const saving = createMut.isPending || updateMut.isPending;

  const rulesJson = useMemo(() => mappingsToJson(mappings), [mappings]);
  const rulesValidation = useMemo(() => validateConversionRules(rulesJson), [rulesJson]);

  const { data: stages = [] } = useGateSetItems(workflow?.pmo_gatesettemplateid);
  const integrityResult = useMemo(() => {
    if (!workflow) return null;
    return validateWorkflowIntegrity(
      { ...workflow, pmo_name: name, pmo_conversionrulesjson: rulesJson },
      stages,
    );
  }, [workflow, name, rulesJson, stages]);

  const hasErrors = !name.trim() || !rulesValidation.valid;

  async function handleSave() {
    if (hasErrors) return;
    const payload = {
      pmo_name: name.trim(),
      pmo_workflowscope: WORKFLOW_SCOPE.IntakeWorkflow,
      pmo_targetentitytype: targetEntity,
      pmo_isdefault: isDefault,
      pmo_conversionrulesjson: rulesJson,
    };
    if (isNew) {
      await createMut.mutateAsync(payload);
      toast.success(`Intake workflow "${name.trim()}" created`);
    } else {
      await updateMut.mutateAsync({ id: workflow.pmo_gatesettemplateid, payload });
      toast.success(`Intake workflow "${name.trim()}" updated`);
    }
    if (isNew) onClose();
  }

  async function handleDeactivate() {
    if (!workflow || !confirm(`Deactivate workflow "${workflow.pmo_name}"?`)) return;
    await updateMut.mutateAsync({ id: workflow.pmo_gatesettemplateid, payload: { statecode: 1 } });
    toast.success('Workflow deactivated');
    onClose();
  }

  const selectCls = 'w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-4">
      <p className="text-sm font-medium text-foreground">{isNew ? 'New Intake Workflow' : `Edit: ${workflow.pmo_name}`}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Workflow Name *</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Standard Project Request" />
          {!name.trim() && <p className="text-xs text-destructive mt-1">Name is required.</p>}
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Target Entity</label>
          <select value={targetEntity} onChange={(e) => setTargetEntity(Number(e.target.value))} className={selectCls}>
            <option value={TARGET_ENTITY_TYPE.Project}>Project</option>
            <option value={TARGET_ENTITY_TYPE.Program}>Program</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
        Default workflow (auto-selected when only one exists)
      </label>

      <div>
        <label className="text-xs text-muted-foreground mb-2 block">Field Mapping (Request &rarr; Project)</label>
        <p className="text-xs text-muted-foreground mb-3">When this request is approved, these fields are copied from the request to the new project.</p>
        <ConversionRuleMapper mappings={mappings} onChange={setMappings} />
        {rulesValidation.errors.map((e, i) => <p key={i} className="text-xs text-destructive mt-1">{e}</p>)}
      </div>

      {integrityResult && !integrityResult.valid && (
        <div className="rounded-md border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-medium text-amber-700">Workflow Integrity Warnings</span>
          </div>
          {integrityResult.errors.map((e, i) => <p key={i} className="text-xs text-amber-600 ml-6">{e}</p>)}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || hasErrors}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {isNew ? 'Create' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {!isNew && (
          <Button variant="ghost" size="sm" onClick={handleDeactivate} className="ml-auto text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-1" />Deactivate
          </Button>
        )}
      </div>

      {!isNew && (
        <div className="border-t pt-3">
          <IntakeStageEditor workflowId={workflow.pmo_gatesettemplateid} />
        </div>
      )}
    </div>
  );
}

export function IntakeWorkflowConfigSection() {
  const { data: workflows = [], isPending } = useIntakeWorkflows();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const createMut = useCreateGateSetTemplate();
  const createStageMut = useCreateGateSetItem();
  const [settingUp, setSettingUp] = useState(false);

  async function handleQuickSetup() {
    setSettingUp(true);
    try {
      const wf = await createMut.mutateAsync({
        pmo_name: 'Standard Project Request',
        pmo_workflowscope: WORKFLOW_SCOPE.IntakeWorkflow,
        pmo_targetentitytype: TARGET_ENTITY_TYPE.Project,
        pmo_isdefault: true,
        pmo_conversionrulesjson: JSON.stringify(DEFAULT_MAPPINGS),
      });
      const wfId = wf.pmo_gatesettemplateid;
      const bind = `/pmo_gatesettemplates(${wfId})`;
      await createStageMut.mutateAsync({
        pmo_name: 'Submission', pmo_stagelabel: 'Submission', pmo_gatetype: GATE_TYPE.Initiation, pmo_gateorder: 0,
        pmo_requiredfieldsjson: JSON.stringify(['pmo_name', 'pmo_description']),
        pmo_requiredartifacttypesjson: '[]', pmo_requiresapproval: false,
        'pmo_GateSet@odata.bind': bind,
      });
      await createStageMut.mutateAsync({
        pmo_name: 'Business Case', pmo_stagelabel: 'Business Case', pmo_gatetype: GATE_TYPE.Planning, pmo_gateorder: 1,
        pmo_requiredfieldsjson: JSON.stringify(['pmo_businessjustification']),
        pmo_requiredartifacttypesjson: JSON.stringify([ARTIFACT_TYPE.BusinessCase]),
        pmo_requiresapproval: true, pmo_approvergroupid: '00000000-0000-0000-0000-000000000000',
        'pmo_GateSet@odata.bind': bind,
      });
      await createStageMut.mutateAsync({
        pmo_name: 'Review & Approve', pmo_stagelabel: 'Review & Approve', pmo_gatetype: GATE_TYPE.Execution, pmo_gateorder: 2,
        pmo_requiredfieldsjson: '[]', pmo_requiredartifacttypesjson: '[]',
        pmo_requiresapproval: true, pmo_approvergroupid: '00000000-0000-0000-0000-000000000000',
        'pmo_GateSet@odata.bind': bind,
      });
      toast.success('Quick setup complete — 3-stage workflow created. Edit it to customize.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Quick setup failed');
    } finally {
      setSettingUp(false);
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading intake workflows...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Intake Workflows</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define governed intake processes. Each workflow has ordered stages with required fields, artifacts, and approval gates.
            Users submit requests through these workflows — projects/programs are created only through approved conversion.
          </p>
        </div>
        {editingId !== 'new' && (
          <Button size="sm" variant="outline" onClick={() => setEditingId('new')}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Workflow
          </Button>
        )}
      </div>

      {editingId === 'new' && <WorkflowForm onClose={() => setEditingId(null)} />}

      {workflows.length === 0 && editingId !== 'new' && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            No intake workflows configured. Users cannot submit requests until a workflow is created.
          </p>
          <Button variant="secondary" onClick={handleQuickSetup} disabled={settingUp}>
            {settingUp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Quick Setup — Create 3-Stage Workflow
          </Button>
          <p className="text-xs text-muted-foreground">Creates a Submission → Business Case → Review &amp; Approve workflow you can customize.</p>
        </div>
      )}

      {workflows.map((wf) => (
        <div key={wf.pmo_gatesettemplateid}>
          {editingId === wf.pmo_gatesettemplateid ? (
            <WorkflowForm workflow={wf} onClose={() => setEditingId(null)} />
          ) : (
            <div className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{wf.pmo_name}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded bg-muted font-medium">
                    {wf.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program ? 'Program' : 'Project'}
                  </span>
                  {wf.pmo_isdefault && <span className="text-primary font-medium">Default</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditingId(wf.pmo_gatesettemplateid)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
