import { useState, useMemo, useEffect } from 'react';
import {
  Check, ArrowLeft, X, Download, Shield, Loader2, MessageSquare, AlertTriangle, ChevronDown, ChevronRight, Save,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { SearchableSelect } from '../common/SearchableSelect';
import {
  INTAKE_CONFIGURABLE_FIELDS, ARTIFACT_TYPE_LABELS, REQUEST_STATUS,
  CONVERSION_TARGET, COMPLEXITY, STRATEGIC_PRIORITY, CFR_CATEGORY,
} from '../../lib/constants';
import { updateProjectRequest } from '../../api/projectRequests.api';
import { useCreateProject } from '../../hooks/useProjects';
import { useCreateProgram, usePrograms } from '../../hooks/usePrograms';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { useProjectTemplates } from '../../hooks/useProjectTemplates';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useResolvedPmoTeamsForIntake, useUserSearch } from '../../hooks/useIntakeLookups';
import { validateConversionReadiness } from '../../lib/intakeConversion';
import {
  PAYER_INITIATIVES_TEAM_ID,
  PAYER_INITIATIVES_TEAM_NAMES,
} from '../../features/teams/payer-initiatives/constants';
import { autoApproveAndConvert, HalfConvertedError } from '../../lib/intakeAutoConvert';
import { useDataSource } from '../../lib/taskSource';
import {
  readExtras, writeExtras, type IntakeExtras,
} from '../../lib/intakeExtras';
import type { ProjectRequest } from '../../models/projectRequest.model';
import type { GateSetItem } from '../../models/gateSetTemplate.model';
import type { ApprovalAction, StageArtifact } from '../../lib/intakeValidation';
import { toast } from '../../hooks/useToast';
import * as dv from '../../lib/dataverseClient';

function parseJsonArray<T>(json: string | undefined, fallback: T[]): T[] {
  if (!json) return fallback;
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}

function parseJsonObject(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try { const v = JSON.parse(json); return typeof v === 'object' && v !== null ? v : {}; } catch { return {}; }
}

const COMPLEXITY_OPTIONS = [
  { value: COMPLEXITY.Low,      label: 'Low' },
  { value: COMPLEXITY.Medium,   label: 'Medium' },
  { value: COMPLEXITY.High,     label: 'High' },
  { value: COMPLEXITY.Critical, label: 'Critical' },
];

const STRATEGIC_PRIORITY_OPTIONS = [
  { value: STRATEGIC_PRIORITY.MustHave,   label: 'Must Have' },
  { value: STRATEGIC_PRIORITY.ShouldHave, label: 'Should Have' },
  { value: STRATEGIC_PRIORITY.NiceToHave, label: 'Nice To Have' },
];

const CFR_CATEGORY_OPTIONS = [
  { value: CFR_CATEGORY.ItInfrastructure, label: 'IT Infrastructure' },
  { value: CFR_CATEGORY.FinanceSystems,   label: 'Finance Systems' },
  { value: CFR_CATEGORY.Compliance,       label: 'Compliance' },
  { value: CFR_CATEGORY.DataAndAnalytics, label: 'Data & Analytics' },
  { value: CFR_CATEGORY.Operations,       label: 'Operations' },
  { value: CFR_CATEGORY.Other,            label: 'Other' },
];

interface StageApprovalPanelProps {
  request: ProjectRequest;
  stage: GateSetItem;
  stageIndex: number;
  totalStages: number;
  approvalChain: ApprovalAction[];
  onActionComplete: () => void;
}

export function StageApprovalPanel({
  request, stage, stageIndex, totalStages, approvalChain, onActionComplete,
}: StageApprovalPanelProps) {
  const [approveRationale, setApproveRationale] = useState('');
  const [sendBackQuestion, setSendBackQuestion] = useState('');
  const [rejectRationale, setRejectRationale] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [savingInline, setSavingInline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState<'approve' | 'sendback' | 'reject' | null>(null);

  const isLastStage = stageIndex >= totalStages - 1;
  const isProgram = request.pmo_conversiontarget === CONVERSION_TARGET.Program;

  // Inline-editor local state — pre-seeded from the persisted request.
  // These are only consumed when isLastStage && missingFields.length > 0.
  const persistedExtras = useMemo(() => readExtras(request), [request]);
  const [primaryTeamId, setPrimaryTeamId]       = useState<string>(request['_pmo_targetteam_value'] ?? '');
  const [pmId, setPmId]                         = useState<string>(persistedExtras.projectManagerId ?? '');
  const [sponsorId, setSponsorId]               = useState<string>(persistedExtras.executiveSponsorId ?? '');
  const [complexity, setComplexity]             = useState<string>(persistedExtras.complexity != null ? String(persistedExtras.complexity) : '');
  const [strategicPriority, setStrategicPriority] = useState<string>(persistedExtras.strategicPriority != null ? String(persistedExtras.strategicPriority) : '');
  const [cfrCategory, setCfrCategory]           = useState<string>(persistedExtras.cfrCategory != null ? String(persistedExtras.cfrCategory) : '');
  const [targetProgramId, setTargetProgramId]   = useState<string>(persistedExtras.targetProgramId ?? '');

  // Re-seed local state if the underlying request changes (e.g. after Send Back / refetch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrimaryTeamId(request['_pmo_targetteam_value'] ?? '');
    setPmId(persistedExtras.projectManagerId ?? '');
    setSponsorId(persistedExtras.executiveSponsorId ?? '');
    setComplexity(persistedExtras.complexity != null ? String(persistedExtras.complexity) : '');
    setStrategicPriority(persistedExtras.strategicPriority != null ? String(persistedExtras.strategicPriority) : '');
    setCfrCategory(persistedExtras.cfrCategory != null ? String(persistedExtras.cfrCategory) : '');
    setTargetProgramId(persistedExtras.targetProgramId ?? '');
  }, [request, persistedExtras]);

  const pmoTeams = useResolvedPmoTeamsForIntake();
  // Payer Initiatives teams manage their work by HPI / Payer Inquiries
  // rather than the CFR taxonomy, so the CFR Category field is hidden
  // and not required when Payer Initiatives is the currently-selected
  // Primary Team. Matches the existing team-scoped rules used elsewhere
  // in the wizard for target completion date / estimated budget.
  const isPayerInitiativesSelected = useMemo(() => {
    if (!primaryTeamId) return false;
    if (primaryTeamId.toLowerCase() === PAYER_INITIATIVES_TEAM_ID.toLowerCase()) return true;
    const label = pmoTeams.find((t) => t.value.toLowerCase() === primaryTeamId.toLowerCase())?.label
      ?? request['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue']
      ?? '';
    const namesLower = new Set(PAYER_INITIATIVES_TEAM_NAMES.map((n) => n.trim().toLowerCase()));
    return namesLower.has(label.trim().toLowerCase());
  }, [primaryTeamId, pmoTeams, request]);
  const { data: programsRaw = [] } = usePrograms();
  const programOptions = useMemo(
    () => programsRaw.map((p) => ({ value: p.msdyn_projectprogramid, label: p.msdyn_name })),
    [programsRaw],
  );
  const { searchUsers, resolveUserLabel } = useUserSearch();
  const { data: templates } = useProjectTemplates();
  const { data: settings } = useAppSettings();
  const createProject = useCreateProject();
  const createProgram = useCreateProgram();
  const auditChange = useChangeAudit();
  const dataSource = useDataSource();

  const requiredFields = parseJsonArray<string>(stage.pmo_requiredfieldsjson, []);
  const stageArtifacts = parseJsonArray<StageArtifact>(request.pmo_stageartifactsjson, [])
    .filter((a) => a.stageOrder === stageIndex);
  const stageData = parseJsonObject(request.pmo_stagedatajson);
  const stageEntry = stageData[`stage_${stageIndex}`] as Record<string, unknown> | undefined;
  const capturedFields = (stageEntry?.fields as Record<string, unknown>) ?? {};

  const stageSendBacks = approvalChain.filter(
    (a) => a.stageOrder === stageIndex && (a.action === 'sent_back' || a.action === 'resubmitted'),
  );

  const currentUserId = useMemo(() => {
    try { return dv.getCurrentUserId(); } catch { return ''; }
  }, []);

  // Build the patch the inline editors would write, then synthesize an
  // "effective" request that overlays it on the persisted record. Used by
  // validateConversionReadiness so the missing-fields banner reacts to local
  // edits in real time.
  const inlineExtrasPatch = useMemo<Partial<IntakeExtras>>(() => {
    const patch: Partial<IntakeExtras> = {};
    if (pmId)               patch.projectManagerId = pmId;
    if (sponsorId)          patch.executiveSponsorId = sponsorId;
    if (complexity)         patch.complexity = Number(complexity);
    if (strategicPriority)  patch.strategicPriority = Number(strategicPriority);
    if (cfrCategory)        patch.cfrCategory = Number(cfrCategory);
    // Always include targetProgramId so the user can clear a previously-set
    // program by selecting -- None --. Empty string is handled by writeExtras
    // (deletes the key) and by buildProjectPayload (skips the lookup bind).
    patch.targetProgramId = targetProgramId;
    return patch;
  }, [pmId, sponsorId, complexity, strategicPriority, cfrCategory, targetProgramId]);

  const effectiveRequest = useMemo<ProjectRequest>(() => ({
    ...request,
    pmo_extractedfieldsjson: writeExtras(request, inlineExtrasPatch),
    ...(primaryTeamId ? { '_pmo_targetteam_value': primaryTeamId } : {}),
  }), [request, inlineExtrasPatch, primaryTeamId]);

  const missingFields = useMemo(
    () => (isLastStage ? validateConversionReadiness(effectiveRequest) : []),
    [isLastStage, effectiveRequest],
  );

  const needs = (label: string) => missingFields.includes(label);

  // Per-field unsaved-edit detection so we can keep editors visible until Save.
  const edited = {
    primaryTeam:        primaryTeamId !== (request['_pmo_targetteam_value'] ?? ''),
    projectManager:     pmId !== (persistedExtras.projectManagerId ?? ''),
    executiveSponsor:   sponsorId !== (persistedExtras.executiveSponsorId ?? ''),
    complexity:         complexity !== (persistedExtras.complexity != null ? String(persistedExtras.complexity) : ''),
    strategicPriority:  strategicPriority !== (persistedExtras.strategicPriority != null ? String(persistedExtras.strategicPriority) : ''),
    cfrCategory:        cfrCategory !== (persistedExtras.cfrCategory != null ? String(persistedExtras.cfrCategory) : ''),
    targetProgram:      targetProgramId !== (persistedExtras.targetProgramId ?? ''),
  };

  // Show a field if it's currently missing OR the approver typed something locally
  // that hasn't been saved yet — so they can see and adjust their entry before Save.
  const shows = (label: string, isEdited: boolean) => needs(label) || isEdited;

  // Aggregate — used by the section gate, Save button enable, and Approve disabled rule.
  const hasInlineEdits =
    edited.primaryTeam || edited.projectManager || edited.executiveSponsor ||
    edited.complexity || edited.strategicPriority || edited.cfrCategory ||
    edited.targetProgram;

  const approveDisabled =
    saving ||
    approveRationale.trim().length < 1 ||
    (isLastStage && missingFields.length > 0);

  async function saveInlineEdits() {
    if (!hasInlineEdits) return;
    setSavingInline(true);
    try {
      const persistPayload: Record<string, unknown> = {
        pmo_extractedfieldsjson: writeExtras(request, inlineExtrasPatch),
      };
      if (primaryTeamId) {
        persistPayload['pmo_TargetTeam@odata.bind'] = `/teams(${primaryTeamId})`;
      }
      await updateProjectRequest(request.pmo_projectrequestid, persistPayload);
      toast.success('Approval-readiness fields saved');
      onActionComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingInline(false);
    }
  }

  async function handleApprove() {
    if (approveRationale.trim().length < 1) return;
    setSavingAction('approve');
    setSaving(true);
    try {
      // 1) For non-final stages: same behavior as before — write the chain entry,
      //    advance the stage number, leave status at Draft for the next stage.
      if (!isLastStage) {
        const newEntry: ApprovalAction = {
          stageOrder: stageIndex,
          action: 'approved',
          actorId: currentUserId,
          actorName: 'Current User',
          timestamp: new Date().toISOString(),
          rationale: approveRationale.trim(),
        };
        const chain = [...approvalChain, newEntry];
        await updateProjectRequest(request.pmo_projectrequestid, {
          pmo_approvalchain: JSON.stringify(chain),
          pmo_currentstagenumber: stageIndex + 1,
          pmo_status: REQUEST_STATUS.Draft,
        });
        auditChange({
          entityType: 'intake',
          entityId: request.pmo_projectrequestid,
          entityName: request.pmo_name ?? 'Untitled Request',
          action: 'approve',
          changes: [
            { kind: 'field', field: 'stage',     label: 'Stage',     old: stageIndex + 1, new: stageIndex + 2 },
            { kind: 'field', field: 'rationale', label: 'Rationale', old: null,           new: approveRationale.trim() },
          ],
        });
        toast.success(`Stage ${stageIndex + 1} approved`);
        onActionComplete();
        return;
      }

      // 2) Final stage — auto-convert path. Persist inline edits FIRST so the
      //    Dataverse record matches what we're about to convert from.
      if (hasInlineEdits) {
        const persistPayload: Record<string, unknown> = {
          pmo_extractedfieldsjson: writeExtras(request, inlineExtrasPatch),
        };
        if (primaryTeamId) {
          persistPayload['pmo_TargetTeam@odata.bind'] = `/teams(${primaryTeamId})`;
        }
        await updateProjectRequest(request.pmo_projectrequestid, persistPayload);
      }

      // 3) Re-validate against the in-memory effective view (defensive — the
      //    Approve button is already disabled when missingFields > 0, but a
      //    race against the parent refetch could conceivably get us here).
      const stillMissing = validateConversionReadiness(effectiveRequest);
      if (stillMissing.length > 0) {
        toast.error(`Still missing: ${stillMissing.join(', ')}`);
        return;
      }

      // 4) Delegate the approve+convert sequence to the shared helper. Same
      //    code path is reused by the GovernedIntakeWizard auto-bypass flow,
      //    so any future fix here only needs to land in intakeAutoConvert.ts.
      try {
        await autoApproveAndConvert({
          request: effectiveRequest,
          approvalChain,
          stageOrder: stageIndex,
          currentUserId,
          approvalRationale: approveRationale.trim(),
          settings,
          templates,
          createProject,
          createProgram,
          auditChange,
          dataSource,
        });
      } catch (err) {
        if (err instanceof HalfConvertedError) {
          toast.error(err.message);
          return;
        }
        throw err;
      }

      toast.success(`Approved and converted to ${isProgram ? 'program' : 'project'}.`);
      onActionComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }

  async function handleSendBack() {
    if (!sendBackQuestion.trim()) return;
    setSavingAction('sendback');
    setSaving(true);
    try {
      const newEntry: ApprovalAction = {
        stageOrder: stageIndex,
        action: 'sent_back',
        actorId: currentUserId,
        actorName: 'Current User',
        timestamp: new Date().toISOString(),
        rationale: '',
        clarificationQuestion: sendBackQuestion.trim(),
      };
      const chain = [...approvalChain, newEntry];

      await updateProjectRequest(request.pmo_projectrequestid, {
        pmo_approvalchain: JSON.stringify(chain),
        pmo_status: REQUEST_STATUS.AwaitingClarification,
        pmo_clarificationquestion: sendBackQuestion.trim(),
        // Clear the prior response so the banner only shows the current Q.
        // Cast: model types this as string|undefined, but Dataverse needs
        // an explicit null in the PATCH body to actually wipe the field.
        pmo_clarificationresponse: null as unknown as string,
      });
      auditChange({
        entityType: 'intake',
        entityId: request.pmo_projectrequestid,
        entityName: request.pmo_name ?? 'Untitled Request',
        action: 'sendback',
        changes: [
          { kind: 'field', field: 'pmo_status',              label: 'Status',                  old: 'Submitted', new: 'Awaiting Clarification' },
          { kind: 'field', field: 'pmo_clarificationquestion', label: 'Clarification question', old: null,        new: sendBackQuestion.trim() },
        ],
      });

      toast.success('Sent back for clarification');
      onActionComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send back failed');
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }

  async function handleReject() {
    if (!rejectRationale.trim()) return;
    setSavingAction('reject');
    setSaving(true);
    try {
      const newEntry: ApprovalAction = {
        stageOrder: stageIndex,
        action: 'rejected',
        actorId: currentUserId,
        actorName: 'Current User',
        timestamp: new Date().toISOString(),
        rationale: rejectRationale.trim(),
      };
      const chain = [...approvalChain, newEntry];

      await updateProjectRequest(request.pmo_projectrequestid, {
        pmo_approvalchain: JSON.stringify(chain),
        pmo_status: REQUEST_STATUS.Rejected,
        pmo_rejectionreason: rejectRationale.trim(),
      });
      auditChange({
        entityType: 'intake',
        entityId: request.pmo_projectrequestid,
        entityName: request.pmo_name ?? 'Untitled Request',
        action: 'reject',
        changes: [
          { kind: 'field', field: 'pmo_status',         label: 'Status',           old: 'Submitted', new: 'Rejected' },
          { kind: 'field', field: 'pmo_rejectionreason', label: 'Rejection reason', old: null,        new: rejectRationale.trim() },
        ],
      });

      toast.success('Request rejected');
      setConfirmReject(false);
      onActionComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }

  const stageLabel = stage.pmo_stagelabel || stage.pmo_name || `Stage ${stageIndex + 1}`;

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            Stage {stageIndex + 1}: {stageLabel} — Approval Review
          </h3>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmReject(true)}
          disabled={saving}
        >
          <X className="h-4 w-4 mr-1" />
          Reject Request
        </Button>
      </div>

      {/* Required fields review */}
      {requiredFields.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Submitted Fields</p>
          <div className="grid grid-cols-2 gap-2">
            {requiredFields.map((field) => (
              <div key={field} className="p-2 rounded-md bg-muted/30 border">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{INTAKE_CONFIGURABLE_FIELDS[field] ?? field}</p>
                <p className="text-sm text-foreground mt-0.5">
                  {capturedFields[field] != null ? String(capturedFields[field]) : (request as unknown as Record<string, unknown>)[field] != null ? String((request as unknown as Record<string, unknown>)[field]) : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Artifacts */}
      {stageArtifacts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attached Artifacts</p>
          {stageArtifacts.map((art, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border">
              <Download className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm flex-1">{art.fileName}</span>
              <span className="text-xs text-muted-foreground">{ARTIFACT_TYPE_LABELS[art.artifactType] ?? 'Artifact'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Clarification exchange — collapsible to keep panel scan-able */}
      {stageSendBacks.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            {historyExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span>Clarification History ({stageSendBacks.length})</span>
          </button>
          {historyExpanded && (
            <div className="space-y-2 pl-1">
              {stageSendBacks.map((sb, i) => {
                const isQuestion = sb.action === 'sent_back';
                return (
                  <div
                    key={i}
                    className={`p-2 rounded-md border ${isQuestion ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${isQuestion ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}`}
                      >
                        <MessageSquare className="h-3 w-3" />
                        {isQuestion ? 'Question' : 'Response'}
                      </span>
                      <span className="text-muted-foreground">{new Date(sb.timestamp).toLocaleString()}</span>
                    </div>
                    <p className={`text-sm mt-1 whitespace-pre-wrap ${isQuestion ? 'text-amber-900' : 'text-emerald-900'}`}>
                      {isQuestion ? sb.clarificationQuestion : sb.clarificationResponse}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Auto-conversion inline editors — only when this is the final stage AND
          conversion-required fields are missing. The approver fills them in
          here, the Approve button auto-converts on click.
          On project flows the panel also opens unconditionally on the last
          stage so the (optional) Program picker is always reachable. */}
      {isLastStage && (missingFields.length > 0 || hasInlineEdits || !isProgram) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          {missingFields.length > 0 ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900">
                  Fill these in — approving will create the {isProgram ? 'program' : 'project'} automatically.
                </p>
                <p className="text-xs text-amber-800 mt-0.5">Missing: {missingFields.join(', ')}</p>
              </div>
            </div>
          ) : hasInlineEdits ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-amber-900">Unsaved changes — click Save to persist your edits.</p>
            </div>
          ) : (
            <p className="text-sm font-medium text-amber-900">
              Approval ready. Optionally assign a parent program below before approving.
            </p>
          )}

          {shows('Primary Team', edited.primaryTeam) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">Primary Team *</label>
              <SearchableSelect
                value={primaryTeamId}
                onChange={(v) => setPrimaryTeamId(v)}
                options={pmoTeams}
                placeholder="Select primary team"
              />
            </div>
          )}

          {shows('Project Manager', edited.projectManager) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">Project Manager *</label>
              <SearchableSelect
                value={pmId}
                onChange={(v) => setPmId(v)}
                onSearch={searchUsers}
                resolveLabel={resolveUserLabel}
                placeholder="Search for project manager"
              />
            </div>
          )}

          {shows('Executive Sponsor', edited.executiveSponsor) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">Executive Sponsor *</label>
              <SearchableSelect
                value={sponsorId}
                onChange={(v) => setSponsorId(v)}
                onSearch={searchUsers}
                resolveLabel={resolveUserLabel}
                placeholder="Search for executive sponsor"
              />
            </div>
          )}

          {shows('Complexity', edited.complexity) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">Complexity *</label>
              <Select value={complexity} onValueChange={setComplexity}>
                <SelectTrigger className="w-full bg-white"><SelectValue placeholder="Select complexity" /></SelectTrigger>
                <SelectContent>
                  {COMPLEXITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {shows('Strategic Priority', edited.strategicPriority) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">Strategic Priority *</label>
              <Select value={strategicPriority} onValueChange={setStrategicPriority}>
                <SelectTrigger className="w-full bg-white"><SelectValue placeholder="Select strategic priority" /></SelectTrigger>
                <SelectContent>
                  {STRATEGIC_PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isPayerInitiativesSelected && shows('CFR Category', edited.cfrCategory) && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">CFR Category *</label>
              <Select value={cfrCategory} onValueChange={setCfrCategory}>
                <SelectTrigger className="w-full bg-white"><SelectValue placeholder="Select CFR category" /></SelectTrigger>
                <SelectContent>
                  {CFR_CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Optional Program assignment — only meaningful for project flows.
              Always rendered on the last stage so the approver can set, change,
              or clear it before conversion. The selected program GUID is
              persisted into pmo_extractedfieldsjson.aip_intakeExtras.targetProgramId
              and stamped on the new project as msdyn_Program@odata.bind. */}
          {!isProgram && (
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-amber-900">
                Program <span className="font-normal normal-case tracking-normal text-amber-800">(optional)</span>
              </label>
              <Select
                value={targetProgramId || '__none__'}
                onValueChange={(v) => setTargetProgramId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="— No program —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No program —</SelectItem>
                  {programOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-amber-800">
                The new project will be linked to this program on creation. Leave blank to convert without a program.
              </p>
            </div>
          )}

          {/* Persist edits without approving — so values survive Send Back, refresh,
              or new clarification cycles without forcing the approver to re-enter them. */}
          <div className="flex items-center justify-end pt-2 border-t border-amber-200">
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={saveInlineEdits}
              disabled={!hasInlineEdits || savingInline || saving}
            >
              {savingInline ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              {hasInlineEdits ? 'Save' : 'Saved'}
            </Button>
          </div>
        </div>
      )}

      {/* Approval actions */}
      <div className="space-y-3 pt-3 border-t">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            {isLastStage ? `Approve & convert to ${isProgram ? 'program' : 'project'}` : 'Approve this stage'}
          </p>
          <Textarea
            rows={2}
            value={approveRationale}
            onChange={(e) => setApproveRationale(e.target.value)}
            placeholder="Rationale for approval..."
          />
          <Button
            className="mt-2"
            onClick={handleApprove}
            disabled={approveDisabled}
          >
            {savingAction === 'approve' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            {isLastStage ? `Approve & Create ${isProgram ? 'Program' : 'Project'}` : 'Approve Stage'}
          </Button>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Send back for clarification</p>
          <Textarea
            rows={2}
            value={sendBackQuestion}
            onChange={(e) => setSendBackQuestion(e.target.value)}
            placeholder="Question for the requester..."
          />
          <Button
            variant="outline"
            className="mt-2"
            onClick={handleSendBack}
            disabled={saving || !sendBackQuestion.trim()}
          >
            {savingAction === 'sendback' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ArrowLeft className="h-4 w-4 mr-1" />}
            Send Back
          </Button>
        </div>
      </div>

      <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Rejecting this request is permanent. The requester must submit a new request.
          </p>
          <Textarea
            rows={3}
            value={rejectRationale}
            onChange={(e) => setRejectRationale(e.target.value)}
            placeholder="Rejection reason (required)..."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReject(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={saving || !rejectRationale.trim()}
            >
              {savingAction === 'reject' && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
