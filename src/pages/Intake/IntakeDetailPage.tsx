import { useState, useRef } from 'react';
import { getCachedDataSource, usesCustomTables } from '../../lib/taskSource';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, AlertTriangle, Link2, ArrowRight, CheckCircle2, FolderKanban, Clock } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { isDeepLinkAvailable, buildDeepLink } from '../../lib/deepLink';
import { toast } from '../../hooks/useToast';
import { ReadOnlyField } from '../../components/common/ReadOnlyField';
import { StatusBadge } from '../../components/common/StatusBadge';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import {
  useCancelRequest,
  useRejectRequest,
  useCreateProjectRequest, useRouteOperational, useRedirectRequest,
  useRequestClarification, useResolveClarification, useLinkParentRequest,
  useUpdateProjectRequest,
} from '../../hooks/useProjectRequests';
import { useIntakeTriage } from '../../hooks/useIntakeTriage';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { openDocument, uploadDocumentAndConfirm } from '../../lib/sharePointClient';
import { FileSourceBadge } from '../../components/common/FileSourceBadge';
import { usePrograms } from '../../hooks/usePrograms';
import { MultiSelectCheckList } from '../../components/common/MultiSelectCheckList';
import { keywordOverlapScore } from '../../lib/intakeRoutingConfig';
import { resolveCurrentUserId, getCurrentUserId } from '../../lib/dataverseClient';
import { REQUEST_STATUS, REQUEST_TYPE, RESOURCE_METRIC_TYPE, LINE_OF_BUSINESS, COMPLEXITY, STRATEGIC_PRIORITY, CFR_CATEGORY, ARTIFACT_TYPE_LABELS, TARGET_ENTITY_TYPE, AFFECTED_SYSTEM_SELECT_OPTIONS, arrayToMultiSelect, multiSelectToArray, affectedSystemLabels } from '../../lib/constants';
import { fetchPmoTeams } from '../../lib/pmoTeams';
import { readExtras, writeExtras } from '../../lib/intakeExtras';
import { setIntakeSeed } from '../../lib/intakeSeed';
import { usePmoTeamField } from '../../providers/ConfigurationProvider';
import { useEffectiveFeatureToggle as useFeatureToggle } from '../../hooks/useEffectiveFeatureToggles';
import { useUserSearch } from '../../hooks/useIntakeLookups';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { ProjectOnboardingWizard } from '../Projects/ProjectOnboardingWizard';
import { updateProjectRequest } from '../../api/projectRequests.api';
import type { ProjectRequest } from '../../models/projectRequest.model';
import { GovernedIntakeWizard } from './GovernedIntakeWizard';
import { StageTimeline } from '../../components/intake/StageTimeline';
import { StageApprovalPanel } from '../../components/intake/StageApprovalPanel';
import { useGateSetItems, useIntakeWorkflow } from '../../hooks/useGateSetTemplates';
import type { ApprovalAction } from '../../lib/intakeValidation';
import { applyConversionRules, carryOverArtifacts } from '../../lib/intakeConversion';
import { useCurrentUserTeams } from '../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { PAYER_INITIATIVES_TEAM_ID } from '../../features/teams/payer-initiatives/constants';
import { attachPayerIssuesToProject } from '../../features/teams/payer-initiatives/api/payerIssues.api';
import { fmtDateOnly } from '../../lib/dateOnly';
import { emitClarificationRequested, emitRequestDecision, emitRequestCancelledToTeam, emitRoleAssigned } from '../../lib/notify';


// ─── Team lookup ─────────────────────────────────────────────────────────────

interface SystemTeam { teamid: string; name: string; pmo_pmoteam?: boolean; }

function useOwnerTeams() {
  const pmoTeamField = usePmoTeamField();
  return useQuery({
    queryKey: ['ownerTeams', pmoTeamField],
    queryFn: () => fetchPmoTeams<SystemTeam>(pmoTeamField, ['teamid', 'name']),
    staleTime: Infinity,
  });
}

/**
 * Resolve a holding-pen user id (extras.projectManagerId /
 * extras.executiveSponsorId) to a display name.
 *
 * The extras live in pmo_extractedfieldsjson as bare GUIDs, so unlike the real
 * lookup columns there is no `@OData...FormattedValue` annotation to read the
 * name from -- it takes a systemusers round-trip. Program intakes collect a
 * Program Manager and nothing else (buildProjectSetupStage's program branch),
 * so without this the approver reviewing a program request in the queue can't
 * see who will own it.
 */
function useResolvedUserName(userId: string | undefined) {
  const { resolveUserLabel } = useUserSearch();
  const { data } = useQuery({
    queryKey: ['intakeExtrasUserName', userId],
    queryFn: () => resolveUserLabel(userId!),
    enabled: !!userId,
    staleTime: Infinity,
  });
  return data;
}

// ─── Shared form helpers ──────────────────────────────────────────────────────

function FormField({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Status style map (extended for Phase 1 statuses) ────────────────────────

const STATUS_STYLE_MAP: Record<string, string> = {
  'Draft': 'draft',
  'Submitted': 'pending',
  'In Triage': 'in progress',
  'Approved': 'approved',
  'Rejected': 'rejected',
  'Converted': 'completed',
  'Awaiting Clarification': 'pending',
  'Routed – Operational': 'in progress',
  'Redirected': 'inactive',
  'Cancelled': 'rejected',
};

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number | undefined }) {
  if (confidence == null) return null;
  const cls =
    confidence >= 70 ? 'bg-green-100 text-green-700' :
    confidence >= 50 ? 'bg-amber-100 text-amber-700' :
    'bg-red-100 text-red-700';
  const label =
    confidence >= 70 ? `${confidence}% — High` :
    confidence >= 50 ? `${confidence}% — Moderate` :
    `${confidence}% — Low Confidence – Human Review Required`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Step 1: Express intake form ─────────────────────────────────────────────

interface Step1FormValues {
  pmo_submissiontext: string;
  pmo_name: string;
  systemIds: string[];
  pmo_lineofbusiness: string;
  // Project Setup extras (holding-pen). Optional on this express form
  // -- the requester can fill them in if known, otherwise PMO collects
  // them during approval.
  projectManagerId: string;
  executiveSponsorId: string;
  complexity: string;
  strategicPriority: string;
  cfrCategory: string;
  targetProgramId: string;
}

// Retained as fallback for non-governed intake (legacy express submission)
export function NewRequestView() {
  const navigate = useNavigate();
  const createMutation = useCreateProjectRequest();
  const qc = useQueryClient();
  const { data: programs = [] } = usePrograms();
  const { data: allRequests = [] } = useProjectRequests();
  const { searchUsers, resolveUserLabel } = useUserSearch();

  const [step, setStep] = useState<1 | 2>(1);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [similarWarning, setSimilarWarning] = useState<ProjectRequest | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<Step1FormValues>({
    defaultValues: { pmo_submissiontext: '', pmo_name: '', systemIds: [], pmo_lineofbusiness: '', projectManagerId: '', executiveSponsorId: '', complexity: '', strategicPriority: '', cfrCategory: '', targetProgramId: '' },
  });

  const submissionText = watch('pmo_submissiontext');

  async function onStep1Submit(values: Step1FormValues) {
    // Create draft record
    const payload: Parameters<typeof createMutation.mutate>[0] = {
      pmo_name: values.pmo_name || values.pmo_submissiontext.slice(0, 100),
      pmo_submissiontext: values.pmo_submissiontext,
      pmo_lineofbusiness: values.pmo_lineofbusiness ? Number(values.pmo_lineofbusiness) : undefined,
    };
    // Affected Systems -> the standardized multi-select Choice column.
    if (Array.isArray(values.systemIds) && values.systemIds.length > 0) {
      payload.pmo_affectedsystems = arrayToMultiSelect(values.systemIds) ?? undefined;
    }
    // Stuff any provided Project Setup fields into the holding-pen JSON.
    const extrasPatch: Record<string, unknown> = {};
    if (values.projectManagerId)   extrasPatch.projectManagerId   = values.projectManagerId;
    if (values.executiveSponsorId) extrasPatch.executiveSponsorId = values.executiveSponsorId;
    if (values.complexity)         extrasPatch.complexity         = Number(values.complexity);
    if (values.strategicPriority)  extrasPatch.strategicPriority  = Number(values.strategicPriority);
    if (values.cfrCategory)        extrasPatch.cfrCategory        = Number(values.cfrCategory);
    if (values.targetProgramId)    extrasPatch.targetProgramId    = values.targetProgramId;
    if (Object.keys(extrasPatch).length > 0) {
      payload.pmo_extractedfieldsjson = writeExtras({}, extrasPatch);
    }

    // Stamp the current user as the requester so the approved record
    // shows "Requested By" instead of falling back to createdby.
    const currentUserId = await resolveCurrentUserId();
    if (currentUserId) payload['pmo_RequestedBy@odata.bind'] = `/systemusers(${currentUserId})`;

    createMutation.mutate(payload, {
      onSuccess: async (created) => {
        const id = (created as { pmo_projectrequestid: string }).pmo_projectrequestid;
        setDraftId(id);

        // Upload pending files
        if (pendingFiles.length > 0) {
          setUploading(true);
          await Promise.all(pendingFiles.map((f) => uploadDocumentAndConfirm(f, { recordType: 'Intake Request', recordId: id })));
          setUploading(false);
          qc.invalidateQueries({ queryKey: ['intakeAttachments', id] });
        }

        // Client-side similarity check
        const searchText = [values.pmo_name, values.pmo_submissiontext].filter(Boolean).join(' ');
        const match = allRequests
          .filter((r) =>
            r.pmo_status !== REQUEST_STATUS.Rejected &&
            r.pmo_status !== REQUEST_STATUS.Converted
          )
          .map((r) => ({
            r,
            score: keywordOverlapScore(searchText, [r.pmo_name, r.pmo_submissiontext].filter(Boolean).join(' ')),
          }))
          .filter((x) => x.score >= 0.25)
          .sort((a, b) => b.score - a.score)[0];

        if (match) setSimilarWarning(match.r);

        setStep(2);
      },
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  }

  function removeFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmitFinal() {
    if (!draftId) return;
    navigate(`/intake/${draftId}`);
  }

  if (step === 2 && draftId) {
    return (
      <div className="space-y-6 max-w-2xl">
        <PageHeader
          title="Review & Submit"
          subtitle="Review your pre-filled request before submitting to the PMO queue"
          showBack
          onBack={() => setStep(1)}
        />

        {similarWarning && (
          <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-800">A similar request may already exist</p>
              <p className="text-amber-700 mt-0.5">
                <button
                  className="underline hover:no-underline"
                  onClick={() => navigate(`/intake/${similarWarning.pmo_projectrequestid}`)}
                >
                  {similarWarning.pmo_autonumber ? `${similarWarning.pmo_autonumber} — ` : ''}{similarWarning.pmo_name}
                </button>
              </p>
              <p className="text-amber-600 mt-1 text-xs">You can continue submitting or navigate to the existing request.</p>
            </div>
          </div>
        )}

        <div className="rounded-md border bg-muted/30 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Draft saved — open to submit</p>
          <p className="text-sm text-foreground">
            Your draft has been saved. Open the request to review all fields and then click <strong>Submit for Review</strong>.
          </p>
        </div>

        {pendingFiles.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Attached Files</p>
            {pendingFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5" />
                <span>{f.name}</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => navigate('/intake')}>Cancel</Button>
          <Button onClick={onSubmitFinal} disabled={uploading}>
            <ArrowRight className="h-4 w-4 mr-1.5" />
            Open Request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="New Request"
        subtitle="Describe what you need in plain language — the PMO will handle classification"
        showBack
        onBack={() => navigate('/intake')}
      />

      <ErrorBanner error={createMutation.error as Error | null} />

      <form onSubmit={handleSubmit(onStep1Submit)} className="space-y-5">
        <FormField
          label="What do you need?"
          required
          hint="Describe the work, problem, or change you need in your own words. No need to classify it."
        >
          <Textarea
            {...register('pmo_submissiontext', { required: 'Please describe your request' })}
            rows={5}
            placeholder="E.g. We need a new report in Power BI showing weekly denials by payer. The current dashboard doesn't break it down enough for the billing team…"
          />
          {errors.pmo_submissiontext && (
            <p className="text-xs text-destructive">{errors.pmo_submissiontext.message}</p>
          )}
        </FormField>

        <FormField label="Short title (optional)" hint="If left blank, the first line of your description will be used.">
          <Input
            {...register('pmo_name')}
            placeholder="Optional brief title"
            maxLength={200}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-5">
          <FormField label="Affected Systems" hint="Pick one or more.">
            <Controller
              name="systemIds"
              control={control}
              render={({ field }) => (
                <MultiSelectCheckList
                  value={field.value ?? []}
                  onChange={(next) => field.onChange(next)}
                  options={AFFECTED_SYSTEM_SELECT_OPTIONS}
                  placeholder="Search systems..."
                />
              )}
            />
          </FormField>

          <FormField label="Line of business">
            <Controller
              name="pmo_lineofbusiness"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select LOB…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(LINE_OF_BUSINESS.Enteral)}>Enteral</SelectItem>
                    <SelectItem value={String(LINE_OF_BUSINESS.Infusion)}>Infusion</SelectItem>
                    <SelectItem value={String(LINE_OF_BUSINESS.Both)}>Both</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        </div>

        {/* Project Setup (optional on the express form) */}
        <div className="rounded-lg border border-border/60 bg-muted/10 p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Project Setup</p>
            <p className="text-xs text-muted-foreground">Optional -- if you already know who'll lead this work or how it should be classified, fill these in. Otherwise PMO will collect them during approval.</p>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <FormField label="Project Manager">
              <Controller name="projectManagerId" control={control} render={({ field }) => (
                <SearchableSelect value={field.value} onChange={(v) => field.onChange(v ?? '')} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for project manager" />
              )} />
            </FormField>
            <FormField label="Executive Sponsor">
              <Controller name="executiveSponsorId" control={control} render={({ field }) => (
                <SearchableSelect value={field.value} onChange={(v) => field.onChange(v ?? '')} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="Search for executive sponsor" />
              )} />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-5">
            <FormField label="Complexity">
              <Controller name="complexity" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select complexity" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(COMPLEXITY.Low)}>Low</SelectItem>
                    <SelectItem value={String(COMPLEXITY.Medium)}>Medium</SelectItem>
                    <SelectItem value={String(COMPLEXITY.High)}>High</SelectItem>
                    <SelectItem value={String(COMPLEXITY.Critical)}>Critical</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField label="Strategic Priority">
              <Controller name="strategicPriority" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(STRATEGIC_PRIORITY.MustHave)}>Must Have</SelectItem>
                    <SelectItem value={String(STRATEGIC_PRIORITY.ShouldHave)}>Should Have</SelectItem>
                    <SelectItem value={String(STRATEGIC_PRIORITY.NiceToHave)}>Nice To Have</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </FormField>
            <FormField label="CFR Category">
              <Controller name="cfrCategory" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(CFR_CATEGORY.ItInfrastructure)}>IT Infrastructure</SelectItem>
                    <SelectItem value={String(CFR_CATEGORY.FinanceSystems)}>Finance Systems</SelectItem>
                    <SelectItem value={String(CFR_CATEGORY.Compliance)}>Compliance</SelectItem>
                    <SelectItem value={String(CFR_CATEGORY.DataAndAnalytics)}>Data & Analytics</SelectItem>
                    <SelectItem value={String(CFR_CATEGORY.Operations)}>Operations</SelectItem>
                    <SelectItem value={String(CFR_CATEGORY.Other)}>Other</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <FormField label="Program (optional)" hint="If this work belongs under an existing program, link it now and skip the manual assignment later.">
              <Controller name="targetProgramId" control={control} render={({ field }) => (
                <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="— No program —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No program —</SelectItem>
                    {programs.map((pg) => (
                      <SelectItem key={pg.msdyn_projectprogramid} value={pg.msdyn_projectprogramid}>{pg.msdyn_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </FormField>
          </div>
        </div>

        {/* File attachments */}
        <FormField label="Supporting materials (optional)" hint="Attach screenshots, documents, or reference files.">
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5 mr-1.5" />
              Attach files
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            {pendingFiles.length > 0 && (
              <ul className="space-y-1">
                {pendingFiles.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 text-foreground">{f.name}</span>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => removeFile(i)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/intake')}>Cancel</Button>
          <Button type="submit" disabled={createMutation.isPending || uploading || !submissionText.trim()}>
            {createMutation.isPending || uploading ? 'Saving…' : 'Next: Review & Submit'}
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Governed stage section (shown when request has an intake workflow) ───────

function GovernedStageSection({ request, onActionComplete, canResumeDraft, onResume }: {
  request: ProjectRequest | undefined;
  onActionComplete: () => void;
  canResumeDraft?: boolean;
  onResume?: () => void;
}) {
  const workflowId = request?.['_pmo_intakeworkflowid_value'];
  const { data: stages = [] } = useGateSetItems(workflowId ?? undefined);
  const { data: workflow } = useIntakeWorkflow(workflowId ?? undefined);

  if (!request || !workflowId || stages.length === 0) return null;

  const rawStageNum = request.pmo_currentstagenumber ?? 0;
  const status = request.pmo_status ?? 0;
  const approvalChain: ApprovalAction[] = (() => {
    try { return JSON.parse(request.pmo_approvalchain ?? '[]'); } catch { return []; }
  })();
  const sortedStages = [...stages].sort((a, b) => a.pmo_gateorder - b.pmo_gateorder);
  // pmo_currentstagenumber is meant to be a 0-based array index into
  // sortedStages. A historical wizard bug wrote pmo_gateorder values (which
  // are arbitrary, often 100/200/300) here instead. Stay resilient: if the
  // raw number is out of array range but matches a known gateorder, fall back
  // to that stage's array index.
  let currentStage = rawStageNum;
  let activeStage = sortedStages[currentStage];
  if (!activeStage) {
    const byGateOrder = sortedStages.findIndex((s) => s.pmo_gateorder === rawStageNum);
    if (byGateOrder >= 0) {
      currentStage = byGateOrder;
      activeStage = sortedStages[byGateOrder];
    }
  }
  const isAwaitingApproval = status === REQUEST_STATUS.Submitted || status === REQUEST_STATUS.InTriage || status === REQUEST_STATUS.AwaitingClarification;
  const isConverted = status === REQUEST_STATUS.Converted;
  // Show the resume banner for the creator whenever the request is a draft --
  // including stage 0 (a brand-new draft that has never been advanced). The
  // banner also carries the only Continue Draft button on the page (a duplicate
  // in the page header was removed in 4915fd4 on the assumption that this
  // banner rendered for every draft; the currentStage > 0 gate that existed
  // between then and 2026-07-06 accidentally hid the button for fresh drafts).
  const isBetweenStages = status === REQUEST_STATUS.Draft && canResumeDraft;
  const isDraftAndNotMine = status === REQUEST_STATUS.Draft && canResumeDraft === false;
  const submitterName = request['_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue']
    ?? request['_createdby_value@OData.Community.Display.V1.FormattedValue']
    ?? 'the submitter';
  const activeStageLabel = activeStage?.pmo_stagelabel || activeStage?.pmo_name || `Stage ${currentStage + 1}`;
  // Effective step total shown to the user: the wizard synthesises a
  // "Project Setup" step on project flows (see buildProjectSetupStage in
  // GovernedIntakeWizard.tsx). Match that here so "Stage N of M" in the
  // banner agrees with the wizard's own step counter and with the "M-Stage"
  // label on the intake selector card.
  const isProgramFlow = workflow?.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program;
  const effectiveTotalStages = sortedStages.length + (isProgramFlow ? 0 : 1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Intake Progress</p>
        <StageTimeline
          stages={sortedStages}
          currentStageNumber={currentStage}
          status={status}
        />
      </div>

      {isConverted && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Approved &amp; Converted</p>
            <p className="text-xs text-emerald-700">All stages approved. A project was created from this request.</p>
          </div>
        </div>
      )}

      {isBetweenStages && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 flex items-center gap-3">
          <ArrowRight className="h-5 w-5 text-blue-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800">Stage {currentStage + 1} of {effectiveTotalStages}</p>
            <p className="text-xs text-blue-700">Now at <strong>{activeStageLabel}</strong> — complete the required fields for this stage and {currentStage === 0 ? 'submit' : 're-submit'} for review.</p>
          </div>
          {canResumeDraft && onResume && (
            <Button size="sm" onClick={onResume} className="shrink-0">
              Continue Draft
            </Button>
          )}
        </div>
      )}

      {isDraftAndNotMine && !isBetweenStages && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">This request is still a draft</p>
            <p className="text-xs text-amber-800 mt-0.5">{submitterName} must click <strong>Submit for Review</strong> on their own draft before it enters the approval queue. You won’t see Approve / Reject controls until they do.</p>
          </div>
        </div>
      )}

      {isAwaitingApproval && activeStage?.pmo_requiresapproval && (
        <StageApprovalPanel
          request={request}
          stage={activeStage}
          stageIndex={currentStage}
          totalStages={sortedStages.length}
          approvalChain={approvalChain}
          onActionComplete={onActionComplete}
        />
      )}
    </div>
  );
}

// ─── PMO Triage Workspace ─────────────────────────────────────────────────────

function ExistingRequestView({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { request: req, attachments, similarRequests, isLoading, error } = useIntakeTriage(id);
  const { data: teamsRaw = [] } = useOwnerTeams();
  // Mirror the wizard's primary-team filter: hide Payer Initiatives from
  // the reassign-team dropdown unless the viewer is a real member of that
  // team or an admin. Admins always have full intake-queue ability.
  const myTeamsSet = useCurrentUserTeams();
  const effectiveAdminRoleForPicker = useEffectiveAdminRole();
  // Case-insensitive GUID compare — Dataverse hands back mixed casing.
  const lowerPayerTeamIdForPicker = PAYER_INITIATIVES_TEAM_ID.toLowerCase();
  const isPayerInitiativesMemberForPicker = myTeamsSet
    ? Array.from(myTeamsSet).some((id) => id.toLowerCase() === lowerPayerTeamIdForPicker)
    : false;
  const teams = teamsRaw.filter((t) => {
    if ((t.teamid ?? '').toLowerCase() !== lowerPayerTeamIdForPicker) return true;
    if (effectiveAdminRoleForPicker !== 'none') return true;
    return isPayerInitiativesMemberForPicker;
  });
  // When the admin 'intake.bypassApproval' toggle is ON, intake skips the
  // human-review approval step entirely — so a confidence score (which
  // exists to flag rows for human review) becomes confusing noise. Hide it.
  const bypassApproval = useFeatureToggle('intake.bypassApproval');
  // const submitMutation = useSubmitRequest(id); // header button disabled; triggered via GovernedStageSection
  // const approveMutation = useApproveRequest(id); // header button disabled; triggered via GovernedStageSection
  const cancelMutation = useCancelRequest(id);
  const rejectMutation = useRejectRequest(id);
  // const triageMutation = useMoveToTriage(id); // header button disabled; triggered via GovernedStageSection
  const routeOpMutation = useRouteOperational(id);
  const redirectMutation = useRedirectRequest(id);
  const clarifyMutation = useRequestClarification(id);
  const resolveClrMutation = useResolveClarification(id);
  const linkParentMutation = useLinkParentRequest(id);
  const updateMutation = useUpdateProjectRequest(id);

  // Routing QA: editable target team for triage workspace
  const [editingTeam, setEditingTeam] = useState(false);
  const [teamDraft, setTeamDraft] = useState('');

  function beginTeamEdit() {
    setTeamDraft(req?._pmo_targetteam_value ?? '');
    setEditingTeam(true);
  }

  function cancelTeamEdit() {
    setEditingTeam(false);
    setTeamDraft('');
  }

  async function saveTeamOverride() {
    if (!req) return;
    const originalTeamId = req._pmo_targetteam_value;
    const originalTeamName = req['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'] ?? originalTeamId ?? 'unknown';
    const newTeamName = teams.find((t) => t.teamid === teamDraft)?.name ?? teamDraft;

    const routingQaNote = originalTeamId && originalTeamId !== teamDraft
      ? `\nPMO override: changed from ${originalTeamName} to ${newTeamName} on ${new Date().toLocaleDateString()}`
      : undefined;

    const payload: Record<string, unknown> = {};
    if (teamDraft) payload['pmo_TargetTeam@odata.bind'] = `/teams(${teamDraft})`;
    if (routingQaNote) {
      payload.pmo_routingrecommendation = (req.pmo_routingrecommendation ?? '') + routingQaNote;
    }
    await updateMutation.mutateAsync(payload as Parameters<typeof updateMutation.mutateAsync>[0]);
    setEditingTeam(false);
  }

  // Dialog states


  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectComments, setRedirectComments] = useState('');
  const [routeOpOpen, setRouteOpOpen] = useState(false);
  const [routeOpTeam, setRouteOpTeam] = useState('');
  const [clarifyResponseOpen, setClarifyResponseOpen] = useState(false);
  const [clarifyResponse, setClarifyResponse] = useState('');
  const [linkParentOpen, setLinkParentOpen] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ProjectRequest | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const statusLabel = req?.['pmo_status@OData.Community.Display.V1.FormattedValue'] ?? '—';
  const canSubmit = req?.pmo_status === REQUEST_STATUS.Draft;
  const canTriage = req?.pmo_status === REQUEST_STATUS.Submitted;
  const canApproveReject =
    req?.pmo_status === REQUEST_STATUS.Submitted || req?.pmo_status === REQUEST_STATUS.InTriage;
  const canRoute =
    req?.pmo_status === REQUEST_STATUS.Submitted || req?.pmo_status === REQUEST_STATUS.InTriage;
  const canClarify =
    req?.pmo_status === REQUEST_STATUS.Submitted || req?.pmo_status === REQUEST_STATUS.InTriage;
  const canRespondClarify = req?.pmo_status === REQUEST_STATUS.AwaitingClarification;
  const canConvert = req?.pmo_status === REQUEST_STATUS.Approved && !req?.['_pmo_convertedproject_value'];

  // Continue-Draft button: only shown to the creator while the request is still Draft.
  const currentUserId = useCurrentUserId();
  const isDraft = req?.pmo_status === REQUEST_STATUS.Draft;
  const isCreator = (() => {
    if (!currentUserId || !req?.['_createdby_value']) return false;
    return req['_createdby_value'].replace(/[{}]/g, '').toLowerCase() === currentUserId.toLowerCase();
  })();
  const canResumeDraft = isDraft && isCreator;
  // Requester CANCEL (withdraw) their OWN request while it's still pre-decision
  // (Draft / Submitted / InTriage). Cancel is the requester's only outcome —
  // rejecting is the assigned team's job (StageApprovalPanel). Owner-only. Sets
  // Cancelled + a reason so the row stays in the queue as "Request: Cancelled".





  const canCancelRequest = isCreator &&
    (req?.pmo_status === REQUEST_STATUS.Draft ||
     req?.pmo_status === REQUEST_STATUS.Submitted ||
     req?.pmo_status === REQUEST_STATUS.InTriage);

  // Cross-team request action path. These lightweight requests carry NO intake
  // workflow, so GovernedStageSection (which needs a workflow) never renders and
  // the assigned team had no way to act (the bug Chandra hit: "Draft", no
  // buttons). Give the TARGET TEAM (members) + admins two controls when the
  // request is undecided: open it in the wizard (prefilled) to complete their
  // team's questions, or Reject it outright with a required reason.
  const targetTeamId = req?.['_pmo_targetteam_value'];
  const isTargetTeamMember = !!targetTeamId && !!myTeamsSet &&
    Array.from(myTeamsSet).some((t) => t.toLowerCase() === targetTeamId.toLowerCase());
  const isAdminViewer = effectiveAdminRoleForPicker !== 'none';
  const hasWorkflow = !!req?.['_pmo_intakeworkflowid_value'];
  const isUndecided = req?.pmo_status === REQUEST_STATUS.Submitted ||
    req?.pmo_status === REQUEST_STATUS.InTriage ||
    req?.pmo_status === REQUEST_STATUS.Draft;
  // Show the workflow-less team action block only when there is no governed
  // workflow to drive the decision, the request is still open, and the viewer
  // is on the assigned team (or an admin) but is NOT the requester.
  const canAssignedTeamAct = !hasWorkflow && isUndecided && !isCreator &&
    (isTargetTeamMember || isAdminViewer);
  const [teamRejectOpen, setTeamRejectOpen] = useState(false);
  const [teamRejectReason, setTeamRejectReason] = useState('');

  const [convertWizardOpen, setConvertWizardOpen] = useState(false);
  const { data: intakeWorkflow } = useIntakeWorkflow(req?.['_pmo_intakeworkflowid_value'] ?? undefined);

  // Holding-pen manager/sponsor for the review panel below. A program intake
  // reuses extras.projectManagerId as the PROGRAM manager (it maps to
  // proj_Manager at conversion -- intakeConversion.buildProgramPayload), so the
  // label follows the flow. Detect the flow from the workflow's target entity
  // type, falling back to the request type for rows whose workflow is missing.
  const isProgramRequest =
    intakeWorkflow?.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program ||
    req?.pmo_requesttype === REQUEST_TYPE.NewProgram;
  const reqExtras = req ? readExtras(req) : {};
  const managerName = useResolvedUserName(reqExtras.projectManagerId);
  const sponsorName = useResolvedUserName(reqExtras.executiveSponsorId);
  const requestedForName = useResolvedUserName(reqExtras.requestedForUserId);
  // Acting user's name + target-team name enrich the requester's decision
  // notification for cross-team requests ("Jane from BI accepted/rejected …").
  const actorName = useResolvedUserName(currentUserId ?? undefined);
  const targetTeamName = req?.['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'] ?? undefined;

  const conversionResult = req && intakeWorkflow
    ? applyConversionRules(req, intakeWorkflow.pmo_conversionrulesjson)
    : null;

  async function handleProjectCreated(projectId: string) {
    if (!id || !req) return;
    // Custom projects have no msdyn shell — bind the pmo_project ref lookup.
    const convBind = usesCustomTables(getCachedDataSource())
      ? { 'pmo_ConvertedProjectRef@odata.bind': `/pmo_projects(${projectId})` }
      : { 'pmo_ConvertedProject@odata.bind': `/msdyn_projects(${projectId})` };
    await updateProjectRequest(id, {
      ...convBind,
      pmo_status: REQUEST_STATUS.Converted,
    });
    if (req.pmo_stageartifactsjson) {
      try {
        const cfrCategory = (() => {
          try {
            const extracted = req.pmo_extractedfieldsjson ? JSON.parse(req.pmo_extractedfieldsjson) : null;
            return extracted?.cfrCategory;
          } catch { return undefined; }
        })();
        await carryOverArtifacts(req.pmo_stageartifactsjson, projectId, cfrCategory);
      } catch { /* artifact carry-over is best-effort */ }
    }
    // Payer Initiatives — attach selected payer issues from the wizard's
    // extras.payerIssueIds to the new project. Best-effort; if any single
    // PATCH fails the others continue. The HPI single-valued lookup was
    // already written via buildProjectPayload's @odata.bind.
    try {
      const extras = readExtras(req);
      if (extras.payerIssueIds && extras.payerIssueIds.length > 0) {
        await attachPayerIssuesToProject(extras.payerIssueIds, projectId);
      }
    } catch (err) {
      console.warn('Payer issue attach failed (non-fatal):', err);
    }
    qc.invalidateQueries({ queryKey: ['projectRequest', id] });
    // Notify the submitter their request was converted to a project.
    const recipient = req['_pmo_requestedby_value'] ?? req['_createdby_value'];
    if (recipient) {
      void emitRequestDecision({ recipientUserId: recipient, requestId: req.pmo_projectrequestid, requestName: req.pmo_name ?? 'your request', decision: 'converted', actorName, teamName: targetTeamName });
    }
    // Notify PM / Executive Sponsor carried over from the intake wizard onto
    // the new project (skip self-assign). Actor = the approver converting.
    {
      const convExtras = readExtras(req);
      const actor = getCurrentUserId();
      if (convExtras.projectManagerId) void emitRoleAssigned({ assigneeUserId: convExtras.projectManagerId, actorUserId: actor, role: 'Project Manager', entityKind: 'project', entityId: projectId, entityName: req.pmo_name });
      if (convExtras.executiveSponsorId) void emitRoleAssigned({ assigneeUserId: convExtras.executiveSponsorId, actorUserId: actor, role: 'Executive Sponsor', entityKind: 'project', entityId: projectId, entityName: req.pmo_name });
    }
    navigate(`/projects/${projectId}`);
  }

  function handleCancelRequest() {
    if (!id || !req) return;
    const reason = cancelReason.trim();
    cancelMutation.mutate(reason, {
      onSuccess: () => {
        setCancelOpen(false); setCancelReason('');
        // Tell the assigned team the ask was withdrawn (best-effort). The
        // request itself stays in the queue as "Request: Cancelled".
        const teamId = req['_pmo_targetteam_value'];
        if (teamId) {
          void emitRequestCancelledToTeam({
            teamId,
            teamName: targetTeamName,
            requestId: req.pmo_projectrequestid,
            requestName: req.pmo_name ?? 'their request',
            actorUserId: currentUserId,
            actorName,
            reason,
          });
        }
      },
    });
  }

  // Assigned-team Reject for a workflow-less cross-team request. Requires a
  // reason; notifies the requester with the operator-specified copy.
  // Assigned team works the request: open the REAL project intake wizard at step
  // 1, seeded from the request (name/description/justification/priority + target
  // team) so the wizard's own team-driven rules run. No pre-created record.
  function handleTeamOpenInWizard() {
    if (!req) return;
    const seedValues: Record<string, unknown> = {};
    if (req.pmo_name) seedValues.pmo_name = req.pmo_name;
    if (req.pmo_description) seedValues.pmo_description = req.pmo_description;
    if (req.pmo_businessjustification) seedValues.pmo_businessjustification = req.pmo_businessjustification;
    if (req.pmo_priority != null) seedValues.pmo_priority = req.pmo_priority;
    setIntakeSeed({
      targetTeamId: req['_pmo_targetteam_value'] ?? undefined,
      values: seedValues,
    });
    navigate('/intake/new?seed=1');
  }

  function handleTeamReject() {
    const reason = teamRejectReason.trim();
    if (!reason) return;
    rejectMutation.mutate(reason, {
      onSuccess: () => {
        setTeamRejectOpen(false); setTeamRejectReason('');
        const recipient = req?.['_pmo_requestedby_value'] ?? req?.['_createdby_value'];
        if (recipient && req) {
          void emitRequestDecision({
            recipientUserId: recipient,
            requestId: req.pmo_projectrequestid,
            requestName: req.pmo_name ?? 'your request',
            decision: 'rejected',
            actorName,
            teamName: targetTeamName,
            message: reason,
          });
        }
      },
    });
  }

  function handleClarify() {
    const question = clarifyQuestion;
    clarifyMutation.mutate(question, {
      onSuccess: () => {
        setClarifyOpen(false); setClarifyQuestion('');
        const recipient = req?.['_pmo_requestedby_value'] ?? req?.['_createdby_value'];
        if (recipient && req) {
          void emitClarificationRequested({ recipientUserId: recipient, requestId: req.pmo_projectrequestid, requestName: req.pmo_name ?? 'your request', question });
        }
      },
    });
  }

  function handleRedirect() {
    redirectMutation.mutate(redirectComments, {
      onSuccess: () => { setRedirectOpen(false); setRedirectComments(''); },
    });
  }

  function handleRouteOp() {
    routeOpMutation.mutate(routeOpTeam || undefined, {
      onSuccess: () => { setRouteOpOpen(false); setRouteOpTeam(''); },
    });
  }

  function handleResolveClarify() {
    // Append a 'resubmitted' entry to the approval chain so the response shows
    // up in the StageApprovalPanel's Clarification History accordion. Pair it
    // with the most-recent 'sent_back' entry's stageOrder so the same stage's
    // history groups together.
    let approvalChainJson: string | undefined;
    try {
      const existingChain: ApprovalAction[] = req?.pmo_approvalchain
        ? JSON.parse(req.pmo_approvalchain)
        : [];
      const lastSendBack = [...existingChain].reverse().find((a) => a.action === 'sent_back');
      const stageOrder = lastSendBack?.stageOrder ?? (req?.pmo_currentstagenumber ?? 0);
      const lastQuestion = lastSendBack?.clarificationQuestion ?? req?.pmo_clarificationquestion ?? '';
      const newEntry: ApprovalAction = {
        stageOrder,
        action: 'resubmitted',
        actorId: currentUserId ?? '',
        actorName: 'Current User',
        timestamp: new Date().toISOString(),
        rationale: '',
        clarificationQuestion: lastQuestion,
        clarificationResponse: clarifyResponse.trim(),
      };
      approvalChainJson = JSON.stringify([...existingChain, newEntry]);
    } catch {
      approvalChainJson = undefined;
    }
    resolveClrMutation.mutate({ response: clarifyResponse, approvalChainJson }, {
      onSuccess: () => { setClarifyResponseOpen(false); setClarifyResponse(''); },
    });
  }

  function handleLinkParent() {
    if (!selectedParent) return;
    linkParentMutation.mutate(selectedParent.pmo_projectrequestid, {
      onSuccess: () => { setLinkParentOpen(false); setSelectedParent(null); },
    });
  }

  const confidence = req?.pmo_routingconfidence;
  // const fallbackTeamId = useAppSetting(SETTING_FALLBACK_TRIAGE_TEAM); // header Route button disabled

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title={req?.pmo_name ?? 'Request Detail'}
        subtitle={req?.pmo_autonumber}
        showBack
        onBack={() => navigate('/intake')}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Continue Draft lives inside the between-stages banner below --
                showing it twice (header + banner) was confusing. */}
            {/*
              Header action buttons (Submit, Triage, Approve, Reject, Route, Redirect,
              Convert, Clarify, etc.) are intentionally disabled. All approval / state
              transitions must happen via the GovernedStageSection form below -- running
              two parallel approval surfaces was causing inconsistent state. Buttons
              are kept visible (grayed out) so the surface still communicates which
              actions exist for this request type. Copy Link remains active because
              it's purely a read-only convenience.
            */}
            {canSubmit && (
              <Button size="sm" disabled title="Use the approval form below">
                Submit for Review
              </Button>
            )}
            {canTriage && (
              <Button size="sm" variant="outline" disabled title="Use the approval form below">
                Move to Triage
              </Button>
            )}
            {canApproveReject && (
              <>
                <Button size="sm" variant="secondary" disabled title="Use the approval form below">Reject</Button>
                <Button size="sm" disabled title="Use the approval form below">Approve</Button>
              </>
            )}
            {canRoute && (
              <>
                <Button size="sm" variant="outline" disabled title="Use the approval form below">Route → Operational</Button>
                <Button size="sm" variant="outline" disabled title="Use the approval form below">Redirect</Button>
              </>
            )}
            {canConvert && (
              <Button size="sm" disabled title="Use the approval form below">
                <FolderKanban className="h-3.5 w-3.5 mr-1.5" />
                Convert to Project
              </Button>
            )}
            {canClarify && (
              <Button size="sm" variant="outline" disabled title="Use the approval form below">Request Clarification</Button>
            )}
            {canRespondClarify && (
              <Button size="sm" onClick={() => setClarifyResponseOpen(true)}>Submit Clarification Response</Button>
            )}
            {canCancelRequest && (
              <Button size="sm" variant="secondary" onClick={() => setCancelOpen(true)}
                className="text-rose-700 hover:text-rose-800">
                Cancel Request
              </Button>
            )}
            {/* Assigned-team action path for a workflow-less cross-team request:
                open it in the wizard (prefilled) to complete the team's questions,
                or Reject with a required reason. Requester never sees these. */}
            {canAssignedTeamAct && (
              <>
                <Button size="sm" onClick={handleTeamOpenInWizard}>
                  Open in Wizard
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setTeamRejectOpen(true)}
                  className="text-rose-700 hover:text-rose-800">
                  Reject
                </Button>
              </>
            )}
            {isDeepLinkAvailable() && (
              <Button size="sm" variant="outline" onClick={() => {
                const link = buildDeepLink({ page: 'intake', id: id! });
                if (link) { navigator.clipboard.writeText(link); toast.success('Link copied'); }
              }}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" />Copy Link
              </Button>
            )}
          </div>
        }
      />

      <ErrorBanner error={error as Error | null} />

      {/* Clarification banner — lifted above the approval panel so the submitter sees it first */}
      {req?.pmo_clarificationquestion && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">
              Clarification Request ({req['pmo_clarificationstate@OData.Community.Display.V1.FormattedValue'] ?? '—'})
            </p>
            {canRespondClarify && (
              <Button size="sm" className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setClarifyResponseOpen(true)}>
                Respond to Clarification
              </Button>
            )}
          </div>
          <div className="text-sm">
            <p className="font-medium text-amber-900">Question:</p>
            <p className="text-amber-800">{req.pmo_clarificationquestion}</p>
          </div>
          {req.pmo_clarificationresponse && (
            <div className="text-sm mt-2 pt-2 border-t border-amber-200">
              <p className="font-medium text-amber-900">Response:</p>
              <p className="text-amber-800">{req.pmo_clarificationresponse}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Governed intake stage timeline + approval panel ── */}
      <GovernedStageSection
        request={req}
        onActionComplete={() => { qc.invalidateQueries({ queryKey: ['projectRequest', id] }); qc.invalidateQueries({ queryKey: ['pendingApprovals'] }); qc.invalidateQueries({ queryKey: ['projectRequests'] }); }}
        canResumeDraft={canResumeDraft}
        onResume={() => id && navigate(`/intake/new?resume=${id}`)}
      />

      {isLoading ? (
        <LoadingOverlay isLoading label="Loading request…" />
      ) : req ? (
        <div className="space-y-6">

          {/* Request context */}
          <div className="space-y-5">

            {/* Status + confidence */}
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={STATUS_STYLE_MAP[statusLabel] ?? 'inactive'} label={statusLabel} />
              {confidence != null && !bypassApproval && <ConfidenceBadge confidence={confidence} />}
            </div>

            {/* Original submission text (read-only, verbatim) */}
            {req.pmo_submissiontext && (
              <div className="rounded-md border bg-muted/30 p-4 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Original Submission (verbatim)</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{req.pmo_submissiontext}</p>
              </div>
            )}



          {/* ── Right panel: structured fields ────────────────────────── */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <ReadOnlyField label="Request Title" value={req.pmo_name} />
              <ReadOnlyField label="Auto Number" value={req.pmo_autonumber} />
              <ReadOnlyField
                label="Type"
                value={req['pmo_requesttype@OData.Community.Display.V1.FormattedValue']}
              />
              <ReadOnlyField
                label="Priority"
                value={req['pmo_priority@OData.Community.Display.V1.FormattedValue']}
              />
              <ReadOnlyField
                label="Requested By"
                value={req['_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue']}
              />
              {/* Holding-pen manager. On a PROGRAM intake this is the only
                  Project-Setup field the wizard collects, and it was never
                  surfaced here -- approvers had no way to see who would own
                  the program before approving it. Resolved from a bare GUID
                  in extras (no FormattedValue annotation, unlike real lookup
                  columns). '(pending)' when the requester left it for PMO to
                  collect during approval. */}
              {(reqExtras.projectManagerId || isProgramRequest) && (
                <ReadOnlyField
                  label={isProgramRequest ? 'Program Manager' : 'Project Manager'}
                  value={reqExtras.projectManagerId ? (managerName ?? 'Resolving…') : '(pending)'}
                />
              )}
              {reqExtras.executiveSponsorId && (
                <ReadOnlyField
                  label="Executive Sponsor"
                  value={sponsorName ?? 'Resolving…'}
                />
              )}
              {reqExtras.requestedForUserId && (
                <ReadOnlyField
                  label="Requested for"
                  value={requestedForName ?? 'Resolving…'}
                />
              )}
              {/* Editable target team with routing QA capture */}
              {!editingTeam ? (
                <div className="flex items-center justify-between gap-2">
                  <ReadOnlyField
                    label="Target Team"
                    value={req['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue']}
                  />
                  {canRoute && (
                    <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs mt-4" onClick={beginTeamEdit}>
                      Reassign
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Target Team</p>
                  <select
                    value={teamDraft}
                    onChange={(e) => setTeamDraft(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">— select team —</option>
                    {teams.map((t) => (
                      <option key={t.teamid} value={t.teamid}>{t.name}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={saveTeamOverride} disabled={updateMutation.isPending || !teamDraft}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelTeamEdit}>Cancel</Button>
                  </div>
                </div>
              )}
              {/* The intake.afterTeamPicker slot for the Payer Initiatives
                  HPI picker was moved into GovernedIntakeWizard's Project
                  Setup stage, gated on the SELECTED Primary Team rather
                  than viewer team membership. The slot registration has
                  also been removed from features/teams/payer-initiatives. */}
              {(() => {
                // Prefer the standardized multi-select Choice; fall back to the
                // legacy single lookup's FormattedValue for pre-migration rows.
                const arr = multiSelectToArray(req.pmo_affectedsystems);
                let value: string | undefined =
                  req['pmo_affectedsystems@OData.Community.Display.V1.FormattedValue']
                  ?? (arr.length > 0 ? affectedSystemLabels(arr) : undefined);
                if (!value) value = req['_pmo_affectedsystem_value@OData.Community.Display.V1.FormattedValue'];
                return (
                  <ReadOnlyField
                    label={arr.length > 1 ? 'Affected Systems' : 'Affected System'}
                    value={value}
                  />
                );
              })()}
              <ReadOnlyField
                label="Line of Business"
                value={req['pmo_lineofbusiness@OData.Community.Display.V1.FormattedValue']}
              />
              <ReadOnlyField
                label="Requested Start"
                value={req.pmo_requestedstartdate ? fmtDateOnly(req.pmo_requestedstartdate) : undefined}
              />
              <ReadOnlyField
                label="Target Completion"
                value={req.pmo_targetcompletiondate ? fmtDateOnly(req.pmo_targetcompletiondate) : undefined}
              />
              {/* Labor vs Financial: show only the field matching how the request
                  is tracked. Null resource-metric-type is treated as Labor. */}
              {req.pmo_resourcemetrictype === RESOURCE_METRIC_TYPE.Financial ? (
                <ReadOnlyField
                  label="Estimated Budget"
                  value={req.pmo_estimatedbudget != null ? `$${req.pmo_estimatedbudget.toLocaleString()}` : undefined}
                />
              ) : (
                <ReadOnlyField
                  label="Forecasted Labor Hours"
                  value={req.pmo_forecastedlaborhours != null ? `${req.pmo_forecastedlaborhours.toLocaleString()} h` : undefined}
                />
              )}
              {req.pmo_description && (
                <ReadOnlyField label="Description" value={req.pmo_description} />
              )}
              {req.pmo_businessjustification && (
                <ReadOnlyField label="Business Justification" value={req.pmo_businessjustification} />
              )}
              {req.pmo_triagecomments && (
                <ReadOnlyField label="Triage Comments" value={req.pmo_triagecomments} />
              )}
              {req.pmo_rejectionreason && (
                <ReadOnlyField label={req.pmo_status === REQUEST_STATUS.Cancelled ? 'Cancellation Reason' : 'Rejection Reason'} value={req.pmo_rejectionreason} />
              )}
              {req['_pmo_convertedproject_value'] && (
                <ReadOnlyField
                  label="Converted Project"
                  value={req['_pmo_convertedproject_value@OData.Community.Display.V1.FormattedValue']}
                />
              )}
              {req['_pmo_parentrequest_value'] && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Related Request</p>
                  <button
                    className="text-sm text-blue-600 hover:underline"
                    onClick={() => navigate(`/intake/${req['_pmo_parentrequest_value']}`)}
                  >
                    {req['_pmo_parentrequest_value@OData.Community.Display.V1.FormattedValue'] ?? 'View'}
                  </button>
                </div>
              )}
            </div>

            {/* Stage attachments — grouped by artifact type using the
                annotationId -> artifactType map the wizard persists in
                pmo_stageartifactsjson. Approvers need to see WHICH
                document is the Business Case vs the Project Charter
                vs RACI before they can sign off. Each file opens
                through the SDK so the URL is always a valid blob URL,
                independent of the Dataverse env. Anything we can't
                map (older drafts that pre-date stageartifactsjson)
                falls under "Other". */}
            {attachments.length > 0 && (() => {
              // Parse the wizard's map once. Defensive against malformed
              // JSON — fall back to an empty array so everything just
              // shows up under "Other" instead of breaking the page.
              type StageArt = { annotationId: string; artifactType: number; fileName?: string; stageOrder?: number };
              let stageArts: StageArt[] = [];
              try {
                stageArts = JSON.parse(req.pmo_stageartifactsjson ?? '[]') as StageArt[];
              } catch { /* malformed — render everything as Other */ }
              // Key by fileName (not annotationId) so grouping survives migration to
              // SharePoint, where the doc id changes but the filename does not.
              // stageOrder disambiguates same-name-twice; first occurrence wins.
              const typeByFileName = new Map<string, number>();
              [...stageArts]
                .sort((x, y) => (x.stageOrder ?? 0) - (y.stageOrder ?? 0))
                .forEach((a) => {
                  const key = (a.fileName ?? '').toLowerCase();
                  if (key && !typeByFileName.has(key)) typeByFileName.set(key, a.artifactType);
                });
              // Group annotations by their resolved artifact-type label.
              // Stable key for unmapped files so the section renders even
              // when the wizard's map is empty.
              const OTHER = 'Other';
              const groups = new Map<string, typeof attachments>();
              for (const a of attachments) {
                const t = typeByFileName.get((a.fileName ?? '').toLowerCase());
                const label = t != null ? (ARTIFACT_TYPE_LABELS[t] ?? OTHER) : OTHER;
                if (!groups.has(label)) groups.set(label, []);
                groups.get(label)!.push(a);
              }
              // Render label order: follow ARTIFACT_TYPE_LABELS declaration
              // order for predictability, then any extras, then Other last.
              const declaredOrder = Object.values(ARTIFACT_TYPE_LABELS);
              const orderedLabels = [
                ...declaredOrder.filter((l) => groups.has(l) && l !== OTHER),
                ...[...groups.keys()].filter((l) => !declaredOrder.includes(l) && l !== OTHER),
                ...(groups.has(OTHER) ? [OTHER] : []),
              ];
              return (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Submitted Artifacts</p>
                  {orderedLabels.map((label) => (
                    <div key={label} className="space-y-1">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</p>
                      <div className="space-y-1">
                        {groups.get(label)!.map((a) => (
                          <button
                            key={a.annotationId}
                            type="button"
                            onClick={() => {
                              openDocument(a).catch((err) => {
                                toast.error(err instanceof Error ? err.message : 'Could not open file');
                              });
                            }}
                            className="flex w-full items-center gap-2 text-sm rounded-md border border-transparent hover:border-border hover:bg-muted/40 px-2 py-1 text-left transition-colors"
                          >
                            <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-blue-600 hover:underline truncate">{a.fileName ?? 'Attachment'}</span>
                            <FileSourceBadge source={a.source} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Similar Requests */}
            {similarRequests.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Similar Requests (last 90 days)</p>
                <div className="space-y-1.5">
                  {similarRequests.map(({ request: sr, score }) => (
                    <div key={sr.pmo_projectrequestid} className="flex items-center gap-3 text-sm rounded-md border p-2.5">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <button
                        className="flex-1 text-left hover:underline text-foreground"
                        onClick={() => navigate(`/intake/${sr.pmo_projectrequestid}`)}
                      >
                        {sr.pmo_autonumber ? `${sr.pmo_autonumber} — ` : ''}{sr.pmo_name}
                      </button>
                      <span className="text-xs text-muted-foreground">{Math.round(score * 100)}% match</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-6 px-2"
                        onClick={() => { setSelectedParent(sr); setLinkParentOpen(true); }}
                      >
                        <Link2 className="h-3 w-3 mr-1" />Link
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          </div>
        </div>
      ) : null}

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}

      {/* Request Clarification */}
      <Dialog open={clarifyOpen} onOpenChange={(o) => { if (!o) { setClarifyOpen(false); setClarifyQuestion(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Clarification</DialogTitle>
            <DialogDescription>Enter your specific question for the requester.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="What specific information do you need?"
            value={clarifyQuestion}
            onChange={(e) => setClarifyQuestion(e.target.value)}
            rows={4}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setClarifyOpen(false); setClarifyQuestion(''); }}>Cancel</Button>
            <Button onClick={handleClarify} disabled={!clarifyQuestion.trim() || clarifyMutation.isPending}>
              {clarifyMutation.isPending ? 'Sending…' : 'Send Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clarification Response */}
      <Dialog open={clarifyResponseOpen} onOpenChange={(o) => { if (!o) { setClarifyResponseOpen(false); setClarifyResponse(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Clarification Response</DialogTitle>
            {req?.pmo_clarificationquestion && (
              <DialogDescription>
                <strong>Question:</strong> {req.pmo_clarificationquestion}
              </DialogDescription>
            )}
          </DialogHeader>
          <Textarea
            placeholder="Your response…"
            value={clarifyResponse}
            onChange={(e) => setClarifyResponse(e.target.value)}
            rows={4}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setClarifyResponseOpen(false); setClarifyResponse(''); }}>Cancel</Button>
            <Button onClick={handleResolveClarify} disabled={!clarifyResponse.trim() || resolveClrMutation.isPending}>
              {resolveClrMutation.isPending ? 'Submitting…' : 'Submit Response'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redirect */}
      <Dialog open={redirectOpen} onOpenChange={(o) => { if (!o) { setRedirectOpen(false); setRedirectComments(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redirect Request</DialogTitle>
            <DialogDescription>Note where this is being redirected and why.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Redirect destination and reason…"
            value={redirectComments}
            onChange={(e) => setRedirectComments(e.target.value)}
            rows={4}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setRedirectOpen(false); setRedirectComments(''); }}>Cancel</Button>
            <Button onClick={handleRedirect} disabled={!redirectComments.trim() || redirectMutation.isPending}>
              {redirectMutation.isPending ? 'Redirecting…' : 'Redirect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Route → Operational */}
      <Dialog open={routeOpOpen} onOpenChange={(o) => { if (!o) { setRouteOpOpen(false); setRouteOpTeam(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Route to Operational</DialogTitle>
            <DialogDescription>Select the operational team to receive this request.</DialogDescription>
          </DialogHeader>
          <Select value={routeOpTeam} onValueChange={setRouteOpTeam}>
            <SelectTrigger><SelectValue placeholder="Select team…" /></SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.teamid} value={t.teamid}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setRouteOpOpen(false); setRouteOpTeam(''); }}>Cancel</Button>
            <Button onClick={handleRouteOp} disabled={routeOpMutation.isPending}>
              {routeOpMutation.isPending ? 'Routing…' : 'Route → Operational'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to Related Request */}
      <Dialog open={linkParentOpen} onOpenChange={(o) => { if (!o) { setLinkParentOpen(false); setSelectedParent(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Related Request</DialogTitle>
            <DialogDescription>
              This links the requests without changing status.
              {selectedParent && (
                <span className="block mt-1 font-medium">
                  Parent: {selectedParent.pmo_autonumber ? `${selectedParent.pmo_autonumber} — ` : ''}{selectedParent.pmo_name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setLinkParentOpen(false); setSelectedParent(null); }}>Cancel</Button>
            <Button onClick={handleLinkParent} disabled={!selectedParent || linkParentMutation.isPending}>
              {linkParentMutation.isPending ? 'Linking…' : 'Link Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel (withdraw) — requester-only. Sets status = Cancelled + a
          cancellation reason (does NOT delete). Separate from the team's
          Reject flow in StageApprovalPanel. */}
      <Dialog open={cancelOpen} onOpenChange={(o) => { if (!o) { setCancelOpen(false); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel request</DialogTitle>
            <DialogDescription>
              Withdraw your request. It stays in the queue as <strong>Cancelled</strong> for
              the record, and the team you asked is notified.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Cancellation reason…"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={4}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="secondary" disabled={cancelMutation.isPending} onClick={() => { setCancelOpen(false); setCancelReason(''); }}>Back</Button>
            <Button onClick={handleCancelRequest} disabled={!cancelReason.trim() || cancelMutation.isPending} aria-busy={cancelMutation.isPending}>
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assigned-team Reject (workflow-less cross-team request). Reason required;
          notifies the requester "Request for X Rejected by <name> for <reason>". */}
      <Dialog open={teamRejectOpen} onOpenChange={(o) => { if (!o) { setTeamRejectOpen(false); setTeamRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>
              Decline this request. The requester is notified with your reason, and the
              request is marked <strong>Rejected</strong>.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection…"
            value={teamRejectReason}
            onChange={(e) => setTeamRejectReason(e.target.value)}
            rows={4}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="secondary" disabled={rejectMutation.isPending} onClick={() => { setTeamRejectOpen(false); setTeamRejectReason(''); }}>Back</Button>
            <Button onClick={handleTeamReject} disabled={!teamRejectReason.trim() || rejectMutation.isPending} aria-busy={rejectMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700">
              {rejectMutation.isPending ? 'Rejecting…' : 'Reject request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Intake → Project Conversion Wizard */}
      {req && (
        <ProjectOnboardingWizard
          open={convertWizardOpen}
          onOpenChange={setConvertWizardOpen}
          prefill={conversionResult ? {
            name: conversionResult.prefill['msdyn_subject'] as string | undefined ?? req.pmo_name,
            description: conversionResult.prefill['msdyn_description'] as string | undefined ?? req.pmo_submissiontext ?? req.pmo_description,
            primaryTeamId: (() => {
              const bind = conversionResult.prefill['pmo_PrimaryTeam@odata.bind'] as string | undefined;
              return bind ? bind.replace(/.*\(|\)/g, '') : req['_pmo_targetteam_value'] ?? undefined;
            })(),
            cfrCategory: (() => {
              try {
                const extracted = req.pmo_extractedfieldsjson ? JSON.parse(req.pmo_extractedfieldsjson) : null;
                return extracted?.cfrCategory ?? undefined;
              } catch { return undefined; }
            })(),
          } : {
            name: req.pmo_name,
            description: req.pmo_submissiontext ?? req.pmo_description,
            primaryTeamId: req['_pmo_targetteam_value'] ?? undefined,
          }}
          lockedFields={conversionResult?.lockedFields}
          onCreated={handleProjectCreated}
        />
      )}
    </div>
  );
}

// ─── Route entry point ────────────────────────────────────────────────────────

export function IntakeDetailPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <ExistingRequestView id={id} /> : <GovernedIntakeWizard />;
}
