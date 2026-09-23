import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Upload, Loader2, ChevronRight, ChevronLeft, Shield, FileText, Layers, FolderKanban, ArrowUpRight, Bug, Lightbulb, MessageSquareText, Handshake } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { useIntakeWorkflows, useGateSetItems } from '../../hooks/useGateSetTemplates';
import { resolveCurrentUserId } from '../../lib/dataverseClient';
import { getProjectRequest, deleteProjectRequest } from '../../api/projectRequests.api';
import { readExtras } from '../../lib/intakeExtras';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateProjectRequest } from '../../hooks/useProjectRequests';
import { useChangeAudit } from '../../hooks/useChangeAudit';
import { uploadDocumentAndConfirm } from '../../lib/sharePointClient';
import { updateProjectRequest } from '../../api/projectRequests.api';
import { useIntakeRoutingConfig } from '../../providers/ConfigurationProvider';
import { useEffectiveFeatureToggles as useFeatureToggles, useEffectiveFeatureToggle as useFeatureToggle } from '../../hooks/useEffectiveFeatureToggles';
import { validateConversionReadiness } from '../../lib/intakeConversion';
import { autoApproveAndConvert, HalfConvertedError } from '../../lib/intakeAutoConvert';
import { useDataSource } from '../../lib/taskSource';
import { useCreateProject } from '../../hooks/useProjects';
import { useCreateProgram, usePrograms } from '../../hooks/usePrograms';
import { useProjectTemplates } from '../../hooks/useProjectTemplates';
import { useAppSettings } from '../../hooks/useAppSettings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { scoreAgainstDomains } from '../../lib/intakeRoutingConfig';
import {
  INTAKE_CONFIGURABLE_FIELDS, ARTIFACT_TYPE_LABELS, REQUEST_STATUS,
  TARGET_ENTITY_TYPE, CONVERSION_TARGET, LINE_OF_BUSINESS, REQUEST_TYPE, REQUEST_PRIORITY,
  COMPLEXITY, STRATEGIC_PRIORITY, CFR_CATEGORY, RESOURCE_METRIC_TYPE,
  AFFECTED_SYSTEM_SELECT_OPTIONS, arrayToMultiSelect, multiSelectToArray,
} from '../../lib/constants';
import { SearchableSelect, type SelectOption } from '../../components/common/SearchableSelect';
import { SaePicker } from '../../components/common/SaePicker';
import { hasSae, type SaeValue } from '../../lib/sae';
import { MultiSelectCheckList } from '../../components/common/MultiSelectCheckList';
import { usePmoTeamsForIntake, useResolvedPmoTeamsForIntake, useUserSearch } from '../../hooks/useIntakeLookups';
import { useCurrentUserTeams } from '../../hooks/useCurrentUserTeams';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { PAYER_INITIATIVES_PROGRAM_NAMES } from '../../features/teams/payer-initiatives/constants';
import { isPayerInitiativesTeamId } from '../../lib/pmoTeams';
import { takeIntakeSeed } from '../../lib/intakeSeed';
import { normId } from '../../lib/actionItems';
import { useHpiIssues } from '../../features/teams/payer-initiatives/hooks/useHpiIssues';
import {
  HpiInlineCreateForm,
  type HpiInlineCreateFormHandle,
} from '../../features/teams/payer-initiatives/components/HpiInlineCreateForm';
import { usePayerIssues } from '../../features/teams/payer-initiatives/hooks/usePayerIssues';
import {
  EXTRAS_FIELD_KEYS, isExtrasKey, extrasKeyToProp, writeExtras,
  type IntakeExtras,
} from '../../lib/intakeExtras';
import type { GateSetItem } from '../../models/gateSetTemplate.model';
import type { StageArtifact } from '../../lib/intakeValidation';
import { toast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import { fmtDateOnly, toDataverseDateOnly } from '../../lib/dateOnly';

/**
 * Rewrite a workflow's pmo_name so any trailing '(N-Stage)' / '(N Stage)'
 * suffix reflects the actual number of configured stages. If pmo_name has no
 * such suffix, append '(N-Stage)' so the selector always shows a stage count.
 * Falls back to the original name when the count is unknown (still loading).
 */
function formatWorkflowName(name: string | undefined, count: number | undefined): string {
  if (!name) return '';
  if (count === undefined) return name;
  const stripped = name.replace(/\s*\(\d+[-\s]?stage\)\s*$/i, '').trim();
  return `${stripped} (${count}-Stage)`;
}

/**
 * Single source of truth for how many stages the wizard will actually render
 * for a workflow. Program flows render just the real stages; project flows
 * append the synthetic Project Setup step (see buildProjectSetupStage). Used
 * by BOTH the intake card selector AND the wizard header so they can never
 * disagree — the card is rendered from useGateSetItems() the same way the
 * wizard is, so the two counts share a single React Query cache entry.
 */
function displayedStageCount(realStageCount: number, isProgram: boolean): number {
  return realStageCount + (isProgram ? 0 : 1);
}

/**
 * Single source of truth for the ordered list of step LABELS the wizard will
 * render for a workflow. Mirrors the wizard body's sortedStages construction:
 * program flows use the real stages as-is; project flows insert the synthetic
 * "Project Setup" step BEFORE the first approval-required stage (or at the
 * end when no stage requires approval). The intake selector card reads this
 * list so the step names shown on the card can NEVER drift from the step
 * names the wizard actually walks through.
 */
function displayedStageLabels(realStages: GateSetItem[], isProgram: boolean): string[] {
  const sorted = [...realStages].sort((a, b) => a.pmo_gateorder - b.pmo_gateorder);
  const stageLabel = (s: GateSetItem, i: number) => s.pmo_stagelabel || s.pmo_name || `Stage ${i + 1}`;
  const labels = sorted.map(stageLabel);
  if (isProgram || sorted.length === 0) return labels;
  const approvalIdx = sorted.findIndex((s) => s.pmo_requiresapproval);
  const insertAt = approvalIdx === -1 ? labels.length : approvalIdx;
  return [...labels.slice(0, insertAt), 'Project Setup', ...labels.slice(insertAt)];
}

function parseJsonArray<T>(json: string | undefined, fallback: T[]): T[] {
  if (!json) return fallback;
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}

const CHOICE_FIELDS: Record<string, Record<number, string>> = {
  pmo_lineofbusiness: { [LINE_OF_BUSINESS.Enteral]: 'Enteral', [LINE_OF_BUSINESS.Infusion]: 'Infusion', [LINE_OF_BUSINESS.Both]: 'Both' },
  pmo_requesttype: { [REQUEST_TYPE.NewProject]: 'New Project', [REQUEST_TYPE.ChangeRequest]: 'Change Request', [REQUEST_TYPE.Enhancement]: 'Enhancement', [REQUEST_TYPE.Support]: 'Support', [REQUEST_TYPE.NewProgram]: 'New Program' },
  pmo_priority: { [REQUEST_PRIORITY.Critical]: 'Critical', [REQUEST_PRIORITY.High]: 'High', [REQUEST_PRIORITY.Medium]: 'Medium', [REQUEST_PRIORITY.Low]: 'Low' },
  // Holding-pen choice fields (mirror msdyn_project option-set values)
  [EXTRAS_FIELD_KEYS.complexity]: { [COMPLEXITY.Low]: 'Low', [COMPLEXITY.Medium]: 'Medium', [COMPLEXITY.High]: 'High', [COMPLEXITY.Critical]: 'Critical' },
  [EXTRAS_FIELD_KEYS.strategicPriority]: { [STRATEGIC_PRIORITY.MustHave]: 'Must Have', [STRATEGIC_PRIORITY.ShouldHave]: 'Should Have', [STRATEGIC_PRIORITY.NiceToHave]: 'Nice To Have' },
  [EXTRAS_FIELD_KEYS.cfrCategory]: { [CFR_CATEGORY.ItInfrastructure]: 'IT Infrastructure', [CFR_CATEGORY.FinanceSystems]: 'Finance Systems', [CFR_CATEGORY.Compliance]: 'Compliance', [CFR_CATEGORY.DataAndAnalytics]: 'Data & Analytics', [CFR_CATEGORY.Operations]: 'Operations', [CFR_CATEGORY.Other]: 'Other' },
};

const DATE_FIELDS = new Set(['pmo_requestedstartdate', 'pmo_targetcompletiondate']);
const NUMBER_FIELDS = new Set(['pmo_estimatedbudget', 'pmo_forecastedlaborhours']);
const TEXTAREA_FIELDS = new Set(['pmo_description', 'pmo_businessjustification', 'pmo_submissiontext']);

// Lookup field keys rendered as SearchableSelect.
//   _pmo_targetteam_value is a real Dataverse lookup column on pmo_projectrequest.
//   extras.projectManagerId / extras.executiveSponsorId live in the holding pen.
const TEAM_LOOKUP_FIELDS = new Set(['_pmo_targetteam_value']);
// Affected Systems: the canonical multi-select Choice column. Legacy stage
// configs may still reference the old single-lookup key or the extras key; all
// three render as the multi-select Choice and persist to pmo_affectedsystems.
const AFFECTED_SYSTEMS_FIELD = 'pmo_affectedsystems';
const SYSTEM_LOOKUP_FIELDS = new Set(['_pmo_affectedsystem_value']);
const MULTI_SYSTEM_LOOKUP_FIELDS = new Set<string>([
  AFFECTED_SYSTEMS_FIELD, EXTRAS_FIELD_KEYS.affectedSystemIds, '_pmo_affectedsystem_value',
]);
const PROGRAM_LOOKUP_FIELDS = new Set<string>([EXTRAS_FIELD_KEYS.targetProgramId]);
const USER_LOOKUP_FIELDS = new Set<string>([EXTRAS_FIELD_KEYS.projectManagerId, EXTRAS_FIELD_KEYS.executiveSponsorId]);
// HPI Issue lookup. Visible ONLY when the requester picked Payer Initiatives
// as Primary Team — i.e. values._pmo_targetteam_value === PAYER_INITIATIVES_TEAM_ID.
// The selected GUID lives in the holding pen as extras.hpiIssueId; conversion
// reads it and stamps pmo_PayerInitiatives_HpiIssue@odata.bind on the resulting msdyn_project.
const HPI_LOOKUP_FIELDS = new Set<string>([EXTRAS_FIELD_KEYS.hpiIssueId]);
// Payer Issues multi-select. Same gating as HPI (Payer Initiatives team
// selected) but multi-valued. Today this is INTENT CAPTURE only — selections
// store in extras.payerIssueIds; no relational write to cr87a_payerissue
// happens at conversion (the existing cr87a_projects lookup on that table
// points at the legacy cr87a_projects entity, not msdyn_project, so a
// schema add is required before we can stamp the new project id).
const PAYER_ISSUE_LOOKUP_FIELDS = new Set<string>([EXTRAS_FIELD_KEYS.payerIssueIds]);
// Payer Initiatives user picker (Strategic Account Executive). People-picker
// pattern via useUserSearch + SearchableSelect; the SearchableSelect enforces
// the 2-character minimum before firing the Dataverse query.
const PAYER_INITIATIVES_USER_FIELDS = new Set<string>([EXTRAS_FIELD_KEYS.strategicAccountExecutive]);

// Team-scoped optional-field policy. When the requester picks Payer
// Initiatives as the Primary Team on the first stage, these otherwise-
// required fields become optional (still visible, no required star, and
// isStageComplete skips them). Every other team keeps them required.
// Motivated by the Payer Initiatives intake workflow where target
// completion date and estimated budget are often unknown at intake time.
// Business justification is also optional for Payer Initiatives: those
// projects are driven by a linked HPI issue rather than a separately
// written justification.
const PAYER_INITIATIVES_OPTIONAL_FIELDS = new Set<string>([
  'pmo_targetcompletiondate',
  'pmo_estimatedbudget',
  'pmo_businessjustification',
]);

// Team-scoped HIDDEN-field policy. When the requester picks Payer
// Initiatives as Primary Team, these fields are BOTH hidden from the
// wizard render AND skipped by isStageComplete -- Payer Initiatives
// projects are categorized by HPI / Payer Inquiries, not the CFR
// taxonomy, so asking for a CFR Category on their intake is noise that
// also blocks Continue if the requester leaves it blank. Same rule
// already lives on the approval-side StageApprovalPanel (commit
// b51bc49 2026-07-15); this brings the wizard side into parity.
const PAYER_INITIATIVES_HIDDEN_FIELDS = new Set<string>([
  EXTRAS_FIELD_KEYS.cfrCategory,
]);

/**
 * True iff the given team GUID represents the Payer Initiatives team in the
 * current environment. Matches EITHER:
 *   (a) the legacy custom-Owner team GUID hardcoded in
 *       `PAYER_INITIATIVES_TEAM_ID` (still exists on PROD, being phased out),
 *   OR
 *   (b) any AAD-linked Payer Initiatives team whose GUID varies per env
 *       (DEV vs PROD) but whose raw Dataverse `name` appears in
 *       `PAYER_INITIATIVES_TEAM_NAMES`.
 *
 * The raw team list must be the un-resolved one from `usePmoTeamsForIntake`
 * (labels = raw Dataverse names), not the sidebar-admin-resolved variant,
 * because the operator may have renamed the team for display via Admin ->
 * Sidebar Teams. Detection stays anchored to the immutable name pack.
 */
// isPayerInitiativesTeamId is imported from lib/pmoTeams (shared with the
// projects grid Issue Number gate). Detection semantics unchanged.

/**
 * Is the given field currently optional because of a team-scoped rule?
 * Reads the in-memory `_pmo_targetteam_value` (the Primary Team the
 * requester picked on the first stage) and returns true if:
 *   - Primary Team is Payer Initiatives (GUID match OR AAD-team name match
 *     via `isPayerInitiativesTeamId` -- the AAD migration made the GUID
 *     environment-specific so name-based matching is required)
 *   - AND the field is in PAYER_INITIATIVES_OPTIONAL_FIELDS
 */
function isTeamOptionalField(
  field: string,
  values: Record<string, unknown>,
  rawTeams: SelectOption[],
): boolean {
  if (!PAYER_INITIATIVES_OPTIONAL_FIELDS.has(field)) return false;
  const teamId = (values._pmo_targetteam_value as string) ?? '';
  return isPayerInitiativesTeamId(teamId, rawTeams);
}

/**
 * Is the given field currently hidden by a team-scoped rule? Same
 * detection semantics as isTeamOptionalField but the field also
 * disappears from the render, not just from the required-star + Continue
 * validator.
 */
function isTeamHiddenField(
  field: string,
  values: Record<string, unknown>,
  rawTeams: SelectOption[],
): boolean {
  if (!PAYER_INITIATIVES_HIDDEN_FIELDS.has(field)) return false;
  const teamId = (values._pmo_targetteam_value as string) ?? '';
  return isPayerInitiativesTeamId(teamId, rawTeams);
}

// Synthetic "Project Setup" stage appended to every workflow as the final
// step. Collects the holding-pen extras (PM, Sponsor, Complexity, Strategic
// Priority, CFR Category) up front so the approval panel doesn't have to
// chase the requester for them later. Marked with a sentinel id so we can
// detect it during persist (it has no real Dataverse row backing it).
const PROJECT_SETUP_STAGE_ID = '__project_setup__';
// NOTE: targetProgramId is appended at runtime in buildProjectSetupStage()
// only for project flows (omitted on Program intakes since a program can't
// itself belong to a parent program).
const PROJECT_SETUP_FIELDS_BASE = [
  EXTRAS_FIELD_KEYS.projectManagerId,
  EXTRAS_FIELD_KEYS.executiveSponsorId,
  // Complexity + Strategic Priority removed from intake (2026-09): no longer
  // asked on Project Setup, and never required to create a project.
  EXTRAS_FIELD_KEYS.cfrCategory,
  // HPI Issue is always in the field list but the StageForm render branch
  // (HPI_LOOKUP_FIELDS) collapses to null unless the requester picked
  // Payer Initiatives as Primary Team on the Request Basics tab.
  EXTRAS_FIELD_KEYS.hpiIssueId,
  // Payer Issues — same gating as HPI, multi-select. Always optional.
  EXTRAS_FIELD_KEYS.payerIssueIds,
  // Strategic Account Executive (Payer Initiatives) — people picker.
  // Same gating as the others. Always optional.
  EXTRAS_FIELD_KEYS.strategicAccountExecutive,
];
function buildProjectSetupStage(maxExistingOrder: number, isProgram: boolean): GateSetItem {
  // Field selection per flow:
  //   Project flow: PM/Sponsor/Complexity/Strategic Priority/CFR Category +
  //                 optional Target Program. NOT an approval gate — this step
  //                 only feeds extras; existing workflow approval stages remain.
  //   Program flow: empty field list. Programs only consume PM from extras
  //                 (and PM is no longer required for program conversion),
  //                 and Sponsor/Complexity/Priority/CFR aren't on
  //                 msdyn_projectprogram at all. The step is now the
  //                 approval gate for program intakes — the requester
  //                 reviews & submits, the approver approves & converts.
  // Program flow: collect the Program Manager (maps to proj_Manager on the
  // program at conversion — intakeConversion.ts buildProgramPayload). Sponsor/
  // Complexity/Priority/CFR/Program lookup don't apply to msdyn_projectprogram.
  const fields = isProgram
    ? [EXTRAS_FIELD_KEYS.projectManagerId]
    : [...PROJECT_SETUP_FIELDS_BASE, EXTRAS_FIELD_KEYS.targetProgramId];
  return {
    pmo_gatesetitemid: PROJECT_SETUP_STAGE_ID,
    pmo_name: isProgram ? 'Review & Approve' : 'Project Setup',
    pmo_stagelabel: isProgram ? 'Review & Approve' : 'Project Setup',
    pmo_gatetype: 0,
    pmo_gateorder: maxExistingOrder + 1,
    pmo_requiredfieldsjson: JSON.stringify(fields),
    pmo_requiredartifacttypesjson: JSON.stringify([]),
    pmo_requiresapproval: isProgram,
    statecode: 0,
  };
}

/**
 * Payer Issues multi-select — rendered on Project Setup only when the
 * requester picked Payer Initiatives as Primary Team. Selections are
 * stored as extras.payerIssueIds (string[]). No relational write at
 * conversion today; see PAYER_ISSUE_LOOKUP_FIELDS comment for context.
 */
function PayerIssuesField({ label, value, onChange }: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { data: issues = [], isLoading } = usePayerIssues();
  // Build SelectOption[] from the issue list. Label format shows the
  // issue Name first and the Payer second so both render visibly. The
  // MultiSelectCheckList searches `label`, so typing matches either
  // half — Name OR Payer.
  const options: SelectOption[] = issues.map((i) => {
    const name = i.cr87a_name ?? '(unnamed)';
    const payer = i['_cr87a_payer_value@OData.Community.Display.V1.FormattedValue'];
    return {
      value: i.cr87a_payerissueid,
      label: payer ? `${name} — ${payer}` : name,
    };
  });
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading payer inquiries…
        </div>
      ) : (
        <MultiSelectCheckList
          value={value}
          onChange={onChange}
          options={options}
          placeholder="Search payer inquiries..."
        />
      )}
    </div>
  );
}

/**
 * HPI Issue picker — rendered on the Project Setup stage only when the
 * requester picked Payer Initiatives as Primary Team. The selection is
 * stored in the holding-pen extras as extras.hpiIssueId; intakeConversion
 * stamps it on the resulting msdyn_project as pmo_PayerInitiatives_HpiIssue@odata.bind.
 *
 * Mounting is gated by the caller in StageForm (this component is not
 * rendered for non-Payer-Initiatives requesters), so useHpiIssues fires
 * only for users who actually need the list.
 */
/**
 * HpiIssueField -- two-section HPI picker for the Project Setup stage.
 *   Section A: Link an existing HPI (dropdown of active issues).
 *   Section B: Create a new HPI inline. Uses the same field set as the
 *              HPI tab's HpiCreateDialog (via HpiInlineCreateForm). On
 *              successful create we auto-select the new id so it flows
 *              into extras.hpiIssueId and onto the resulting project.
 * While the create is in flight `onSavingChange(true)` bubbles up so the
 * wizard's Continue button stays disabled until Dataverse confirms the
 * new row -- the requester cannot advance past a half-created HPI.
 */
function HpiIssueField({ label, value, onChange, onSavingChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { data: issues = [], isLoading } = useHpiIssues();
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [creating, setCreating] = useState(false);
  const [createReady, setCreateReady] = useState(false);
  const formRef = useRef<HpiInlineCreateFormHandle | null>(null);

  // Block the wizard's Continue while an HPI is being created, AND while the
  // requester has started the 'Create new HPI' form (name filled) but not yet
  // clicked 'Create & link HPI' — otherwise the typed HPI is silently lost and
  // never links to the project (the Chandra case).
  const blockAdvance = creating || (mode === 'create' && createReady);
  useEffect(() => {
    onSavingChange?.(blockAdvance);
  }, [blockAdvance, onSavingChange]);

  async function handleCreate() {
    if (!formRef.current) return;
    const newId = await formRef.current.submit();
    if (newId) {
      onChange(newId);
      formRef.current.reset();
      // Clear the block flags HERE, before switching back to 'link'. Switching
      // mode unmounts HpiInlineCreateForm, and `creating` is otherwise driven
      // only by that child's onSubmittingChange effect (create.isPending). When
      // the mutation resolves isPending flips false, but the unmount removes the
      // child before that effect can push `false` up, so `creating` (and thus
      // blockAdvance -> hpiSaving) stayed stuck true and Continue spun forever
      // even though the HPI was created + linked. Owning the reset in the parent
      // makes it deterministic regardless of the child's unmount timing.
      setCreating(false);
      setCreateReady(false);
      setMode('link');
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode('link')}
          disabled={creating}
          className={cn(
            'px-3 py-1 rounded transition-colors',
            mode === 'link' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
            creating && 'opacity-50 cursor-not-allowed',
          )}
        >
          Link existing HPI
        </button>
        <button
          type="button"
          onClick={() => setMode('create')}
          disabled={creating}
          className={cn(
            'px-3 py-1 rounded transition-colors',
            mode === 'create' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
            creating && 'opacity-50 cursor-not-allowed',
          )}
        >
          Create new HPI
        </button>
      </div>
      {mode === 'link' ? (
        isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading HPI list…
          </div>
        ) : (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— No HPI —</option>
            {issues.map((i) => {
              const num = i.rcm_issuenumber ?? '';
              const name = i.rcm_name ?? '';
              const sameOrEmpty = !name || name === num;
              const text = sameOrEmpty ? (num || '(unnamed)') : `${num || '—'} — ${name}`;
              return (
                <option key={i.rcm_payerdeckissueid} value={i.rcm_payerdeckissueid}>
                  {text}
                </option>
              );
            })}
          </select>
        )
      ) : (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Fill in the fields below and click Create &amp; link HPI. The new HPI is created in Dataverse and linked to this request. You cannot continue until the create finishes.
          </p>
          <HpiInlineCreateForm
            ref={formRef}
            onSubmittingChange={setCreating}
            onReadyChange={setCreateReady}
          />
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { formRef.current?.reset(); setMode('link'); }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Creating…</>
              ) : (
                'Create & link HPI'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StageFormProps {
  stage: GateSetItem;
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  artifacts: StageArtifact[];
  onArtifactUpload: (artifactType: number, file: File) => Promise<void>;
  uploading: boolean;
  isProgram: boolean;
  pmoTeams: SelectOption[];
  rawPmoTeams: SelectOption[];
  programs: SelectOption[];
  searchUsers: (q: string) => Promise<SelectOption[]>;
  resolveUserLabel: (id: string) => Promise<string>;
  /** Bubbled from HpiIssueField so the wizard can block Continue while an
   *  inline HPI create is in flight. */
  onHpiSavingChange?: (saving: boolean) => void;
}

function StageForm({ stage, values, onChange, artifacts, onArtifactUpload, uploading, isProgram, pmoTeams, rawPmoTeams, programs, searchUsers, resolveUserLabel, onHpiSavingChange }: StageFormProps) {
  const requiredFields = parseJsonArray<string>(stage.pmo_requiredfieldsjson, []);
  const requiredArtifacts = parseJsonArray<number>(stage.pmo_requiredartifacttypesjson, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingType, setUploadingType] = useState<number | null>(null);

  if (requiredFields.length === 0 && requiredArtifacts.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-sm text-muted-foreground">No additional information needed for this stage.</p>
        <p className="text-xs text-muted-foreground mt-1">Review your submission and continue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {requiredFields.map((field) => {
        const baseLabel = INTAKE_CONFIGURABLE_FIELDS[field] ?? field;
        // On the program flow the PM field is the Program Manager (maps to
        // proj_Manager on the program), so relabel it for clarity.
        const label = isProgram && field === EXTRAS_FIELD_KEYS.projectManagerId
          ? 'Program Manager'
          : baseLabel;
        // Team-scoped optional: certain fields become optional when the
        // requester picks Payer Initiatives as Primary Team. See
        // PAYER_INITIATIVES_OPTIONAL_FIELDS / isTeamOptionalField above.
        // Otherwise every field in requiredFields is treated as required.
        // Forecasted Labor Hours is always optional across every team --
        // a top-down estimate that never gates Continue (see the matching
        // skip in isStageComplete below).
        const isRequired = field !== 'pmo_forecastedlaborhours'
          && !isTeamOptionalField(field, values, rawPmoTeams);

        // Team-scoped hidden fields: drop the entire render branch when the
        // policy says so (currently CFR Category on Payer Initiatives).
        if (isTeamHiddenField(field, values, rawPmoTeams)) return null;

        // Request Type on project (non-program) flows: force to 'New Project'
        // and hide the control so requesters can't change it. Programs keep
        // their own locked-to-'New Program' handling in the CHOICE_FIELDS
        // branch below. (Temporary — field is only removed from the view.)
        if (field === 'pmo_requesttype' && !isProgram) {
          if (values[field] !== REQUEST_TYPE.NewProject) {
            setTimeout(() => onChange(field, REQUEST_TYPE.NewProject), 0);
          }
          return null;
        }

        // Team lookup (Primary Team) — static option list.
        if (TEAM_LOOKUP_FIELDS.has(field)) {
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <SearchableSelect
                value={(values[field] as string) ?? ''}
                onChange={(v) => onChange(field, v || undefined)}
                options={pmoTeams}
                placeholder={`Select ${label.toLowerCase()}`}
              />
            </div>
          );
        }

        // Program lookup (extras.targetProgramId) — always optional even if
        // the stage marks it required in pmo_requiredfieldsjson, since the
        // create-project payload accepts a null program. Allows the requester
        // to pre-bind the resulting project to an existing program.
        if (PROGRAM_LOOKUP_FIELDS.has(field)) {
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </label>
              <SearchableSelect
                value={(values[field] as string) ?? ''}
                onChange={(v) => onChange(field, v || undefined)}
                options={programs}
                placeholder="— No program (optional) —"
              />
            </div>
          );
        }

        // Affected Systems — standardized multi-select Choice (pmo_affectedsystems).
        // Any legacy system field key routes here; options come from the static
        // AFFECTED_SYSTEM_SELECT_OPTIONS list (no cr87a_system dependency).
        if (MULTI_SYSTEM_LOOKUP_FIELDS.has(field)) {
          const arr = Array.isArray(values[field]) ? (values[field] as string[]) : [];
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Affected Systems{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <MultiSelectCheckList
                value={arr}
                onChange={(next) => onChange(field, next.length > 0 ? next : undefined)}
                options={AFFECTED_SYSTEM_SELECT_OPTIONS}
                placeholder="Search systems..."
              />
            </div>
          );
        }

        // User lookup (Project Manager, Executive Sponsor) — server-side search.
        if (USER_LOOKUP_FIELDS.has(field)) {
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <SearchableSelect
                value={(values[field] as string) ?? ''}
                onChange={(v) => onChange(field, v || undefined)}
                onSearch={searchUsers}
                resolveLabel={resolveUserLabel}
                placeholder={`Search for ${label.toLowerCase()}`}
              />
            </div>
          );
        }

        // HPI Issue lookup. Conditional render — only appears when the
        // requester picked Payer Initiatives as Primary Team. Short-circuits
        // BEFORE mounting HpiIssueField so we don't fire a useHpiIssues
        // query for requesters who didn't pick Payer Initiatives. Even when
        // visible the field is optional (isStageComplete skips it).
        if (HPI_LOOKUP_FIELDS.has(field)) {
          const teamId = (values['_pmo_targetteam_value'] as string | undefined) ?? '';
          if (!isPayerInitiativesTeamId(teamId, rawPmoTeams)) {
            return null;
          }
          return (
            <HpiIssueField
              key={field}
              label={label}
              value={(values[field] as string) ?? ''}
              onChange={(v) => onChange(field, v || undefined)}
              onSavingChange={onHpiSavingChange}
            />
          );
        }

        // Payer Issues — multi-select, same Payer-Initiatives gate.
        if (PAYER_ISSUE_LOOKUP_FIELDS.has(field)) {
          const teamId = (values['_pmo_targetteam_value'] as string | undefined) ?? '';
          if (!isPayerInitiativesTeamId(teamId, rawPmoTeams)) {
            return null;
          }
          const arr = Array.isArray(values[field]) ? (values[field] as string[]) : [];
          return (
            <PayerIssuesField
              key={field}
              label={label}
              value={arr}
              onChange={(next) => onChange(field, next.length > 0 ? next : undefined)}
            />
          );
        }

        // Strategic Account Executive (Payer Initiatives) — people picker.
        // SearchableSelect with onSearch+resolveLabel triggers the existing
        // 2-character minimum gate before firing the Dataverse systemuser
        // query. Same Payer-Initiatives team gate as HPI / Payer Issues.
        if (PAYER_INITIATIVES_USER_FIELDS.has(field)) {
          const teamId = (values['_pmo_targetteam_value'] as string | undefined) ?? '';
          if (!isPayerInitiativesTeamId(teamId, rawPmoTeams)) {
            return null;
          }
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}
              </label>
              <SaePicker
                value={values[field] as SaeValue | undefined}
                onChange={(sae) => onChange(field, hasSae(sae) ? sae : undefined)}
              />
            </div>
          );
        }

        if (CHOICE_FIELDS[field]) {
          const isLockedProgram = isProgram && field === 'pmo_requesttype';
          if (isLockedProgram && values[field] !== REQUEST_TYPE.NewProgram) {
            setTimeout(() => onChange(field, REQUEST_TYPE.NewProgram), 0);
          }
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <Select value={values[field] != null ? String(values[field]) : ''} onValueChange={(v) => onChange(field, Number(v))} disabled={isLockedProgram}>
                <SelectTrigger className={`w-full ${isLockedProgram ? 'bg-muted/60 text-muted-foreground cursor-not-allowed opacity-70' : ''}`}><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CHOICE_FIELDS[field])
                    // Hide 'New Program' from Project workflows — a project-flavored
                    // request should never be able to choose a program request type.
                    .filter(([val]) => !(field === 'pmo_requesttype' && !isProgram && Number(val) === REQUEST_TYPE.NewProgram))
                    .map(([val, lbl]) => (
                      <SelectItem key={val} value={val}>{lbl}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (DATE_FIELDS.has(field)) {
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <Input type="date" value={(values[field] as string) ?? ''} onChange={(e) => onChange(field, e.target.value)} />
            </div>
          );
        }

        // ── Resource Metric Type toggle (rendered in place of Estimated Budget) ──
        // Projects are EITHER labor-tracked OR financially-tracked. The budget
        // field's stage slot now hosts a Labor/Financial toggle (default Labor):
        //   Labor     -> show Forecasted Labor Hours (required for every team).
        //   Financial -> show Estimated Budget (required, unless team-optional).
        // pmo_forecastedlaborhours need not be in the stage's requiredFields —
        // it is rendered here and its required-ness is enforced by isStageComplete.
        if (field === 'pmo_estimatedbudget') {
          const metric = typeof values['pmo_resourcemetrictype'] === 'number'
            ? (values['pmo_resourcemetrictype'] as number)
            : RESOURCE_METRIC_TYPE.Labor;
          const isFinancial = metric === RESOURCE_METRIC_TYPE.Financial;
          // Budget keeps its team-optional rule; labor hours is always required here.
          const budgetRequired = !isTeamOptionalField('pmo_estimatedbudget', values, rawPmoTeams);
          return (
            <div key={field} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Tracking Method<span className="text-destructive ml-0.5">*</span>
                </label>
                <div className="flex gap-2">
                  {[
                    { val: RESOURCE_METRIC_TYPE.Labor, label: 'Labor Hours' },
                    { val: RESOURCE_METRIC_TYPE.Financial, label: 'Financial Metrics' },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => onChange('pmo_resourcemetrictype', opt.val)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${metric === opt.val ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-muted/40'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isFinancial
                    ? 'Financial project — tracked by budget, forecast, and benefits.'
                    : 'Labor project — tracked by forecasted labor hours and the New Resource Model.'}
                </p>
              </div>
              {isFinancial ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Estimated Budget ($){budgetRequired && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  <Input type="number" value={values['pmo_estimatedbudget'] != null ? String(values['pmo_estimatedbudget']) : ''} onChange={(e) => onChange('pmo_estimatedbudget', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Forecasted Labor Hours<span className="text-destructive ml-0.5">*</span>
                  </label>
                  <Input type="number" value={values['pmo_forecastedlaborhours'] != null ? String(values['pmo_forecastedlaborhours']) : ''} onChange={(e) => onChange('pmo_forecastedlaborhours', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              )}
            </div>
          );
        }

        if (NUMBER_FIELDS.has(field)) {
          // Forecasted Labor Hours is rendered by the Tracking Method toggle above
          // (under the Estimated Budget slot). Skip the standalone render so it does
          // not appear twice when a stage lists both fields as required.
          if (field === 'pmo_forecastedlaborhours') return null;
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <Input type="number" value={values[field] != null ? String(values[field]) : ''} onChange={(e) => onChange(field, e.target.value ? Number(e.target.value) : undefined)} />
            </div>
          );
        }

        if (TEXTAREA_FIELDS.has(field)) {
          return (
            <div key={field} className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <Textarea rows={3} value={(values[field] as string) ?? ''} onChange={(e) => onChange(field, e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} />
            </div>
          );
        }

        return (
          <div key={field} className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {label}{isRequired && <span className="text-destructive ml-0.5">*</span>}
            </label>
            <Input value={(values[field] as string) ?? ''} onChange={(e) => onChange(field, e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} />
          </div>
        );
      })}

      {requiredArtifacts.length > 0 && (
        <div className="pt-2 border-t space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Artifacts <span className="font-normal normal-case tracking-normal">(optional)</span></p>
          {requiredArtifacts.map((artType) => {
            const uploaded = artifacts.find((a) => a.artifactType === artType);
            return (
              <div key={artType} className="flex items-center gap-3 p-2 rounded-md border bg-muted/30">
                {uploaded ? (
                  <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm flex-1">{ARTIFACT_TYPE_LABELS[artType] ?? `Type ${artType}`}</span>
                {uploaded ? (
                  <span className="text-xs text-muted-foreground">{uploaded.fileName}</span>
                ) : (
                  <>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingType(artType);
                      await onArtifactUpload(artType, file);
                      setUploadingType(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }} />
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploadingType === artType ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                      Upload
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one workflow button in the intake chooser. Reads the workflow's
 * stage items from useGateSetItems — the same hook the wizard body uses —
 * so the '(N-Stage)' label on the card ALWAYS matches the number of tabs
 * the wizard header will show when the operator clicks in. Both sites read
 * from the same React Query cache entry, so there is no drift possible.
 */
function IntakeWorkflowCard({
  workflow, isProgram, onSelect,
}: {
  workflow: { pmo_gatesettemplateid: string; pmo_name?: string; pmo_description?: string };
  isProgram: boolean;
  onSelect: (id: string) => void;
}) {
  const { data: stages = [] } = useGateSetItems(workflow.pmo_gatesettemplateid);
  const displayCount = displayedStageCount(stages.length, isProgram);
  const stepLabels = displayedStageLabels(stages, isProgram);
  return (
    <button
      type="button"
      onClick={() => onSelect(workflow.pmo_gatesettemplateid)}
      className="w-full rounded-lg border bg-card p-4 text-left hover:border-primary/50 transition-colors"
    >
      <p className="text-sm font-medium text-foreground">{formatWorkflowName(workflow.pmo_name, stages.length > 0 ? displayCount : undefined)}</p>
      {stepLabels.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">{stepLabels.join(' - ')}</p>
      )}
      {workflow.pmo_description && <p className="text-xs text-muted-foreground mt-1">{workflow.pmo_description}</p>}
    </button>
  );
}

// Chooser workflow visibility — shared by the tile chooser AND the ?seed=1 entry
// so a seeded project intake picks the SAME workflow the 'Project' tile shows
// (e.g. 'Standard Project Intake (5-Stage)'), never the hidden 'Standard Project
// Request' (which is pmo_isdefault but blocklisted from the chooser).
const WORKFLOW_TOGGLE_BY_NAME: Record<string, string> = {
  'Standard Program Intake (5-Stage)': 'intakeCard.programIntake5Stage',
  'Standard Program Request':           'intakeCard.programRequest',
  'Standard Project Intake (5-Stage)': 'intakeCard.projectIntake5Stage',
  'Standard Project Request':           'intakeCard.projectRequest',
};
const HIDDEN_WORKFLOWS = new Set<string>([
  'Standard Program Request',
  'Standard Project Request',
]);
function isWorkflowVisibleWith(wfName: string | undefined, allFt: Record<string, boolean | undefined>): boolean {
  if (!wfName) return true;
  if (HIDDEN_WORKFLOWS.has(wfName)) return false;
  const key = WORKFLOW_TOGGLE_BY_NAME[wfName];
  return key ? allFt[key] !== false : true;
}

export function GovernedIntakeWizard() {
  const navigate = useNavigate();
  const { data: workflows = [], isPending: loadingWorkflows } = useIntakeWorkflows();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(0);
  const requestIdRef = useRef<string | null>(null);
  // Holding-pen JSON for pmo_extractedfieldsjson - accumulated across stages
  // and merged via writeExtras() before each save. Starts as the AI extractor's
  // payload (or {}) and is updated whenever the user edits an extras.* field.
  const extractedJsonRef = useRef<string | undefined>(undefined);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [artifacts, setArtifacts] = useState<StageArtifact[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hpiSaving, setHpiSaving] = useState(false);
  // True while the two-section HPI picker is mid-create. Blocks the
  // wizard's Continue/Submit button so the requester cannot advance
  // past a half-created HPI. Populated via StageForm -> HpiIssueField.

  const createRequest = useCreateProjectRequest();
  const routingConfig = useIntakeRoutingConfig();
  // The wizard PATCHes the project-request row via the raw
  // updateProjectRequest api call (handleAdvance / handleSaveDraft /
  // the resume-jump persist). That bypasses the useUpdateProjectRequest
  // mutation hook where invalidation would normally live. Grab the
  // QueryClient here so we can bust the ['projectRequests'] cache
  // manually whenever the wizard writes -- otherwise IntakeDetailPage
  // renders a stale banner until a full app refresh.
  const qc = useQueryClient();
  const auditChange = useChangeAudit();
  const dataSource = useDataSource();

  // Admin-controlled "bypass approval" toggle. When ON, submission of an
  // approval-required stage auto-approves and converts the request to a
  // project/program in one shot, provided validateConversionReadiness passes.
  const bypassApproval = useFeatureToggle('intake.bypassApproval');
  // Full toggle map — read here (top-level) so the hook always runs in the
  // same order. The wizard early-returns multiple times below before the
  // workflow-card render uses these values; calling the hook after those
  // returns triggers React error #310 on the second render.
  const allFt = useFeatureToggles();
  const createProject  = useCreateProject();
  const createProgram  = useCreateProgram();
  const { data: templates }   = useProjectTemplates();
  const { data: settings }    = useAppSettings();
  const [missingFieldsDialog, setMissingFieldsDialog] = useState<{ open: boolean; missing: string[] }>({ open: false, missing: [] });
  // Draft/cancel dialogs (Cancel = discard, never persists; Save as Draft = explicit persist).
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [nameRequiredDialogOpen, setNameRequiredDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Resume-draft support.
  // Enter the wizard at /intake/new?resume=<requestId> to pick up where the
  // submitter left off. We hydrate the workflow id, stage number, form values,
  // artifacts, and the extracted-fields JSON, then skip the workflow-picker.
  const [searchParams] = useSearchParams();
  const resumeId = searchParams.get('resume');
  const seedParam = searchParams.get('seed');
  const [resumeLoading, setResumeLoading] = useState<boolean>(Boolean(resumeId));
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    (async () => {
      try {
        const req = await getProjectRequest(resumeId);
        if (cancelled) return;
        // Wire workflow id so the workflow-selection screen is skipped.
        const wfId = req['_pmo_intakeworkflowid_value'];
        if (wfId) setSelectedWorkflowId(wfId);
        // Mark the existing record so subsequent advances PATCH instead of POST.
        requestIdRef.current = resumeId;
        // Preserve the AI-extracted JSON so writeExtras() merges cleanly.
        if (req.pmo_extractedfieldsjson) extractedJsonRef.current = req.pmo_extractedfieldsjson;
        // Hydrate the form values from columns + saved stage data + extras.
        const hydrated: Record<string, unknown> = {
          pmo_name: req.pmo_name,
          pmo_submissiontext: req.pmo_submissiontext,
          pmo_description: req.pmo_description,
          pmo_businessjustification: req.pmo_businessjustification,
          pmo_requesttype: req.pmo_requesttype,
          pmo_priority: req.pmo_priority,
          pmo_lineofbusiness: req.pmo_lineofbusiness,
          pmo_requestedstartdate: req.pmo_requestedstartdate,
          pmo_targetcompletiondate: req.pmo_targetcompletiondate,
          pmo_estimatedbudget: req.pmo_estimatedbudget,
          pmo_forecastedlaborhours: req.pmo_forecastedlaborhours,
          pmo_resourcemetrictype: req.pmo_resourcemetrictype,
        };
        if (req['_pmo_targetteam_value']) hydrated._pmo_targetteam_value = req['_pmo_targetteam_value'];
        // Replay saved stage field values back into the form.
        if (req.pmo_stagedatajson) {
          try {
            const sd = JSON.parse(req.pmo_stagedatajson) as Record<string, { fields?: Record<string, unknown> }>;
            for (const v of Object.values(sd)) {
              if (v && typeof v === 'object' && v.fields) Object.assign(hydrated, v.fields);
            }
            hydrated._stagedatajson = req.pmo_stagedatajson;
          } catch { /* corrupt JSON - ignore */ }
        }
        // Holding-pen extras flow back as extras.* keys so the existing pickers populate.
        const extras = readExtras(req);
        if (extras.projectManagerId)   hydrated['extras.projectManagerId']   = extras.projectManagerId;
        if (extras.executiveSponsorId) hydrated['extras.executiveSponsorId'] = extras.executiveSponsorId;
        if (extras.complexity != null) hydrated['extras.complexity']         = extras.complexity;
        if (extras.strategicPriority != null) hydrated['extras.strategicPriority'] = extras.strategicPriority;
        if (extras.cfrCategory != null) hydrated['extras.cfrCategory']       = extras.cfrCategory;
        if (extras.targetProgramId)     hydrated['extras.targetProgramId']   = extras.targetProgramId;
        // Payer Initiatives extras — only meaningful when the requester
        // picked Payer Initiatives as Primary Team. Hydrate unconditionally;
        // the wizard render branches collapse to null otherwise so the
        // values are simply not surfaced.
        if (extras.hpiIssueId)          hydrated['extras.hpiIssueId']        = extras.hpiIssueId;
        if (extras.payerIssueIds && extras.payerIssueIds.length > 0) {
          hydrated['extras.payerIssueIds'] = extras.payerIssueIds;
        }
        if (extras.strategicAccountExecutive) {
          hydrated[EXTRAS_FIELD_KEYS.strategicAccountExecutive] = extras.strategicAccountExecutive;
        }
        // Affected Systems -> canonical multi-select. Prefer the new column;
        // fall back to the legacy extras array (pre-migration drafts).
        const affected = multiSelectToArray(req.pmo_affectedsystems);
        if (affected.length > 0) {
          hydrated[AFFECTED_SYSTEMS_FIELD] = affected;
        } else if (extras.affectedSystemIds && extras.affectedSystemIds.length > 0) {
          hydrated[AFFECTED_SYSTEMS_FIELD] = extras.affectedSystemIds;
        }
        for (const k of Object.keys(hydrated)) if (hydrated[k] === undefined) delete hydrated[k];
        setValues(hydrated);
        if (req.pmo_stageartifactsjson) {
          try {
            const arts = JSON.parse(req.pmo_stageartifactsjson) as StageArtifact[];
            if (Array.isArray(arts)) setArtifacts(arts);
          } catch { /* corrupt JSON - ignore */ }
        }
        // Seed currentStage from the persisted value. The 'first-incomplete'
        // effect below may override this once stages + values are hydrated.
        if (typeof req.pmo_currentstagenumber === 'number') setCurrentStage(req.pmo_currentstagenumber);
      } catch (e) {
        if (!cancelled) setResumeError(e instanceof Error ? e.message : 'Failed to load draft.');
      } finally {
        if (!cancelled) setResumeLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  // Lookup data for Primary Team / Project Manager / Executive Sponsor pickers.
  //
  // Two views on the same team list:
  //   - `pmoTeamsRaw` — raw Dataverse `name` labels. Used for Payer
  //     Initiatives detection (isPayerInitiativesTeamId) because the
  //     detection matches against the immutable name pack, not the
  //     admin-configurable display override.
  //   - `pmoTeams` — sidebar-admin-resolved labels. Used for actual picker
  //     rendering + the wizard Completed summary, so operators see the
  //     name they configured in Admin -> Sidebar Teams.
  const { data: pmoTeamsRaw = [] } = usePmoTeamsForIntake();
  const pmoTeamsResolved = useResolvedPmoTeamsForIntake();
  // Primary-team picker scope: ADMINS see every PMO team; everyone else sees
  // ONLY the teams they belong to. A user who wants a project done by a team
  // they're not on must go through the Intake Queue's cross-team Request tile
  // instead of self-assigning it here. This also subsumes the old
  // Payer-Initiatives-only rule (non-members simply don't see that team, so
  // the HPI question on the Project Setup stage never surfaces for them).
  const myTeams = useCurrentUserTeams();
  const adminRole = useEffectiveAdminRole();
  // Normalized (brace-stripped, lower-cased) membership set for a robust,
  // case-insensitive GUID compare against the picker's team ids — mirrors the
  // queue's own team-scoping in selectActionItems (lib/actionItems.ts).
  const myTeamIds = useMemo(
    () => new Set(Array.from(myTeams ?? []).map((id) => normId(id)).filter(Boolean) as string[]),
    [myTeams],
  );
  const pmoTeams = useMemo(() => {
    if (adminRole !== 'none') return pmoTeamsResolved;
    // Membership not yet resolved (undefined) → show nothing rather than
    // flashing the full list; it fills in once myTeams loads.
    if (myTeams == null) return [];
    return pmoTeamsResolved.filter((t) => myTeamIds.has(normId(t.value) ?? ''));
  }, [pmoTeamsResolved, adminRole, myTeams, myTeamIds]);
  const { searchUsers, resolveUserLabel } = useUserSearch();
  // GUID -> display name cache for user lookup fields (PM, Exec Sponsor,
  // Strategic Account Executive). Populated lazily by the effect below so
  // the wizard's 'Completed' summary can render human-readable names
  // instead of raw GUIDs. The wizard's SearchableSelect for these fields
  // has its own internal cache (last search result); this second cache
  // covers the summary render path, which does not have search context.
  const [userLabelCache, setUserLabelCache] = useState<Record<string, string>>({});
  // Programs catalog — used by the optional 'Target Program' field on the
  // synthetic Project Setup stage (and any admin-configured stage that
  // opts-in to extras.targetProgramId).
  const { data: programsRaw = [] } = usePrograms();
  const programs: SelectOption[] = programsRaw.map((p) => ({
    value: p.msdyn_projectprogramid,
    label: p.msdyn_name,
  }));
  // Affected-system option list. Static catalog under cr87a_systems
  // -- safe to fetch once and cache forever (admin-managed reference data).
  // Affected Systems options come from the standardized static Choice list
  // (AFFECTED_SYSTEM_SELECT_OPTIONS) — no dependency on the legacy cr87a_system
  // catalog (absent from non-PROD envs).
  const systems: SelectOption[] = AFFECTED_SYSTEM_SELECT_OPTIONS;
  // Payer inquiry GUID -> name, so the Completed summary shows the inquiry NAME
  // (never the raw GUID). Same source the PayerIssuesField picker uses.
  const { data: payerIssuesRaw = [] } = usePayerIssues();
  const payerIssueOptions: SelectOption[] = payerIssuesRaw.map((i) => ({
    value: i.cr87a_payerissueid,
    label: i.cr87a_name ?? '(unnamed)',
  }));

  const activeWorkflow = workflows.length === 1 ? workflows[0] : workflows.find((w) => w.pmo_gatesettemplateid === selectedWorkflowId);
  const workflowId = activeWorkflow?.pmo_gatesettemplateid;
  const { data: stages = [] } = useGateSetItems(workflowId);
  // Inject the synthetic Project Setup step BEFORE the first stage that
  // requires approval (so PM/Sponsor/Complexity/Strategic Priority/CFR
  // Category are captured before the approver sees the request). If no
  // stage requires approval, append it to the end.
  //
  // Program flow exception: program intakes don't need any of the Project
  // Setup extras (PM not required for conversion; Sponsor/Complexity/etc.
  // aren't columns on msdyn_projectprogram). The workflow's own approval
  // stage is the gate. Skip injection entirely on program flows so the
  // wizard ends on the last real stage.
  const isProgramFlow = activeWorkflow?.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program;
  const sortedStages = (() => {
    const real = [...stages].sort((a, b) => a.pmo_gateorder - b.pmo_gateorder);
    if (real.length === 0) return real;
    if (isProgramFlow) {
      // Program flows have no synthetic setup step, so the Program Manager
      // (extras.projectManagerId -> proj_Manager at conversion) had nowhere to
      // be collected. Inject it as a REQUIRED field on the Governance Structure
      // stage (fallback: last stage) so the requester must pick a PM before
      // submitting. Mirrors validateConversionReadiness (programRequiredFields).
      const govIdx = real.findIndex((s) => /govern/i.test(s.pmo_stagelabel || s.pmo_name || ""));
      const targetIdx = govIdx >= 0 ? govIdx : real.length - 1;
      return real.map((s, i) => {
        if (i !== targetIdx) return s;
        const existing = parseJsonArray<string>(s.pmo_requiredfieldsjson, []);
        if (existing.includes(EXTRAS_FIELD_KEYS.projectManagerId)) return s;
        return { ...s, pmo_requiredfieldsjson: JSON.stringify([...existing, EXTRAS_FIELD_KEYS.projectManagerId]) };
      });
    }
    const approvalIdx = real.findIndex((s) => s.pmo_requiresapproval);
    const insertAt = approvalIdx === -1 ? real.length : approvalIdx;
    const prevOrder = insertAt > 0 ? real[insertAt - 1].pmo_gateorder : 0;
    const setup = buildProjectSetupStage(prevOrder, isProgramFlow);
    return [...real.slice(0, insertAt), setup, ...real.slice(insertAt)];
  })();
  const stage = sortedStages[currentStage];

  // On resume: once stages + hydrated values are loaded, jump to the first
  // wizard stage (including the synthetic Project Setup) that still has
  // missing required fields. Users may navigate back and forth, so the
  // persisted pmo_currentstagenumber doesn't always reflect where they
  // need to fix things. Runs only once per resume so we don't hijack the
  // user's manual navigation later in the session.
  const resumeJumpDoneRef = useRef(false);
  useEffect(() => {
    if (!resumeId) return;
    if (resumeJumpDoneRef.current) return;
    if (resumeLoading) return;
    if (sortedStages.length === 0) return;
    if (Object.keys(values).length === 0) return;
    const firstIncomplete = sortedStages.findIndex((st) => {
      const required = parseJsonArray<string>(st.pmo_requiredfieldsjson, []);
      return required.some((f) => {
        const v = values[f];
        return v === undefined || v === null || v === '';
      });
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (firstIncomplete >= 0) setCurrentStage(firstIncomplete);
    resumeJumpDoneRef.current = true;

    // Persist the jumped-to stage so the queue banner on IntakeDetailPage
    // agrees with where the wizard actually opened. Without this, the row's
    // pmo_currentstagenumber stays at whatever handleSaveDraft or
    // handleAdvance last wrote (often 0 for a mid-flight draft) while the
    // wizard silently walks the user forward. Best-effort; a failure here
    // does not block the wizard from rendering. Uses the same synthetic->real
    // index translation that handleSaveDraft / handleAdvance use.
    if (firstIncomplete > 0 && requestIdRef.current) {
      const jumpStage = sortedStages[firstIncomplete];
      const syntheticIdx = sortedStages.findIndex((st) => st.pmo_gatesetitemid === PROJECT_SETUP_STAGE_ID);
      let realIdx: number;
      if (jumpStage && jumpStage.pmo_gatesetitemid === PROJECT_SETUP_STAGE_ID) {
        realIdx = syntheticIdx >= 0 ? syntheticIdx : firstIncomplete;
      } else {
        realIdx = syntheticIdx >= 0 && firstIncomplete > syntheticIdx
          ? firstIncomplete - 1
          : firstIncomplete;
      }
      updateProjectRequest(requestIdRef.current, { pmo_currentstagenumber: realIdx })
        .then(() => { qc.invalidateQueries({ queryKey: ['projectRequests'] }); })
        .catch(() => { /* best-effort; do not block resume */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, resumeLoading, sortedStages, values]);

  // Seed-consume: on a ?seed=1 entry, pre-fill a FRESH intake from the
  // in-memory seed exactly once. Preselect the default Project workflow so we
  // open at step 1 (not the chooser), seed the plain values + any payer
  // inquiries, then apply the target team THROUGH handleFieldChange so the
  // wizard's own team-driven prefills (e.g. Payer Initiatives default program)
  // fire as if the user picked the team. No record is created here.
  const seedDoneRef = useRef(false);
  useEffect(() => {
    if (seedParam !== '1' || seedDoneRef.current) return;
    if (workflows.length === 0) return; // wait for workflows to resolve
    seedDoneRef.current = true;
    const seed = takeIntakeSeed();
    if (!seed) return;
    // Apply after commit (queueMicrotask) so these are not synchronous
    // set-state-in-effect calls. Open at step 1 on the default PROJECT workflow,
    // seed values + attached inquiries, then apply the team THROUGH
    // handleFieldChange so the wizard's team-driven prefills fire.
    queueMicrotask(() => {
      // Pick the SAME project workflow the chooser's Projects column shows
      // (visible + non-Program), NOT pmo_isdefault (that's the hidden 4-step
      // 'Standard Project Request').
      const projectWfs = workflows
        .filter((w) => w.pmo_targetentitytype !== TARGET_ENTITY_TYPE.Program)
        .filter((w) => isWorkflowVisibleWith(w.pmo_name, allFt));
      const wf = projectWfs[0];
      if (wf) setSelectedWorkflowId(wf.pmo_gatesettemplateid);
      setCurrentStage(0);
      const seeded: Record<string, unknown> = { ...(seed.values ?? {}) };
      if (seed.payerIssueIds && seed.payerIssueIds.length > 0) {
        seeded[EXTRAS_FIELD_KEYS.payerIssueIds] = seed.payerIssueIds;
      }
      if (Object.keys(seeded).length > 0) setValues((prev) => ({ ...prev, ...seeded }));
      if (seed.targetTeamId) handleFieldChange('_pmo_targetteam_value', seed.targetTeamId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedParam, workflows]);

  // Populate userLabelCache for every user-lookup GUID currently in values
  // that we have not resolved yet. resolveUserLabel is server-round-trip;
  // batching by Promise.all keeps this cheap. Safe to re-run: the cache
  // dedupes by GUID and we skip GUIDs already present.
  useEffect(() => {
    const pending: string[] = [];
    for (const field of USER_LOOKUP_FIELDS) {
      const v = values[field];
      if (typeof v !== 'string' || !v) continue;
      if (userLabelCache[v]) continue;
      pending.push(v);
    }
    // SAE (PAYER_INITIATIVES_USER_FIELDS) is a SaeValue object resolved by
    // SaePicker / the summary render below — not a GUID string — so it is not
    // prefetched here.
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(
        pending.map(async (id) => {
          try { return [id, await resolveUserLabel(id)] as const; }
          catch { return [id, id] as const; }
        }),
      );
      if (cancelled) return;
      setUserLabelCache((prev) => {
        const next = { ...prev };
        for (const [id, label] of resolved) next[id] = label;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const needsSelection = workflows.length > 1 && !selectedWorkflowId;

  function handleFieldChange(field: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      // When the requester picks Payer Initiatives as Primary Team on a
      // PROJECT intake, pre-fill the Target Program with the PI default
      // program (resolved by name so it works in every env). Only pre-fills
      // when the requester hasn't already chosen a program -- the field stays
      // editable so they can override.
      if (
        field === '_pmo_targetteam_value' &&
        !isProgramFlow &&
        isPayerInitiativesTeamId(value as string | undefined, pmoTeamsRaw) &&
        !next[EXTRAS_FIELD_KEYS.targetProgramId]
      ) {
        const namesLower = new Set(
          PAYER_INITIATIVES_PROGRAM_NAMES.map((n) => n.trim().toLowerCase()),
        );
        const piProgram = programsRaw.find(
          (p) => namesLower.has((p.msdyn_name ?? '').trim().toLowerCase()),
        );
        if (piProgram) {
          next[EXTRAS_FIELD_KEYS.targetProgramId] = piProgram.msdyn_projectprogramid;
        }
      }
      return next;
    });
  }

  /**
   * Split the form's `values` map into:
   *   - columnPayload  -> direct Dataverse columns + lookup binds
   *   - extrasPatch    -> partial IntakeExtras for writeExtras()
   *
   * Special-cases:
   *   - `_pmo_targetteam_value` becomes `pmo_TargetTeam@odata.bind`
   *   - `extras.*` keys are routed to the holding-pen patch instead of columns
   *   - keys starting with `_` (other than `_pmo_targetteam_value`) are skipped
   *     because they are synthetic UI-only state
   */
  function splitValuesForPersist(): { columnPayload: Record<string, unknown>; extrasPatch: Partial<IntakeExtras> } {
    const columnPayload: Record<string, unknown> = {};
    const extrasPatch: Partial<IntakeExtras> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === '') continue;
      // Affected Systems -> the standardized multi-select Choice column. Checked
      // BEFORE isExtrasKey because the legacy stage key `extras.affectedSystemIds`
      // is itself an extras key — without this ordering a draft save routed the
      // selection into the holding-pen JSON and never wrote pmo_affectedsystems
      // (bug: systems lost on Save as Draft).
      if (k === AFFECTED_SYSTEMS_FIELD || k === '_pmo_affectedsystem_value'
          || k === EXTRAS_FIELD_KEYS.affectedSystemIds) {
        const arr = Array.isArray(v) ? (v as string[]) : (typeof v === 'string' && v ? [v] : []);
        columnPayload.pmo_affectedsystems = arrayToMultiSelect(arr);
        continue;
      }
      if (isExtrasKey(k)) {
        const prop = extrasKeyToProp(k);
        (extrasPatch as Record<string, unknown>)[prop] = v;
        continue;
      }
      if (k === '_pmo_targetteam_value') {
        columnPayload['pmo_TargetTeam@odata.bind'] = `/teams(${v})`;
        continue;
      }
      if (k.startsWith('_')) continue;
      // Date-only columns come from <input type="date"> as YYYY-MM-DD.
        // Route through toDataverseDateOnly so Dataverse round-trips back to
        // the same local calendar day the user picked.
        if (DATE_FIELDS.has(k) && typeof v === 'string') {
          columnPayload[k] = toDataverseDateOnly(v);
        } else {
          columnPayload[k] = v;
        }
    }
    return { columnPayload, extrasPatch };
  }

  /** Merge the in-memory extras patch into extractedJsonRef and return the
   *  serialized JSON to send on the next save. */
  function buildExtractedFieldsJson(extrasPatch: Partial<IntakeExtras>): string | undefined {
    const hasPatch = Object.keys(extrasPatch).length > 0;
    if (!hasPatch && !extractedJsonRef.current) return undefined;
    const next = writeExtras({ pmo_extractedfieldsjson: extractedJsonRef.current }, extrasPatch);
    extractedJsonRef.current = next;
    return next;
  }

  /**
   * Creates a draft project request in Dataverse and returns the new record ID.
   * Called automatically when an artifact upload is attempted before the record
   * exists, or as part of handleAdvance on the first stage.
   */
  async function ensureDraftRecord(): Promise<string> {
    // Return existing ID if the record was already created
    if (requestIdRef.current) return requestIdRef.current;

    if (!activeWorkflow || !workflowId) {
      throw new Error('No active workflow selected. Please select a workflow before uploading.');
    }

    const convTarget = activeWorkflow.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program
      ? CONVERSION_TARGET.Program : CONVERSION_TARGET.Project;
    const { columnPayload, extrasPatch } = splitValuesForPersist();
    const extractedJson = buildExtractedFieldsJson(extrasPatch);
    const payload: Record<string, unknown> = {
      pmo_name: (values.pmo_name as string) || 'Untitled Request',
      pmo_status: REQUEST_STATUS.Draft,
      pmo_currentstagenumber: 0,
      pmo_conversiontarget: convTarget,
      pmo_stagedatajson: JSON.stringify({}),
      pmo_stageartifactsjson: JSON.stringify([]),
      'pmo_IntakeWorkflowId@odata.bind': `/pmo_gatesettemplates(${workflowId})`,
      ...columnPayload,
    };
    if (extractedJson !== undefined) payload.pmo_extractedfieldsjson = extractedJson;
    const submissionText = [
      values.pmo_name, values.pmo_submissiontext,
      values.pmo_description, values.pmo_businessjustification,
    ].filter(Boolean).join(' ');
    const routingResult = scoreAgainstDomains(submissionText, routingConfig);
    if (routingResult) {
      payload.pmo_routingconfidence = routingResult.confidence;
      payload.pmo_routingrecommendation = routingResult.domainName;
    }
    // Stamp the current user as the requester so the approved record
    // shows "Requested By" instead of just falling back to createdby.
    const currentUserId = await resolveCurrentUserId();
    if (currentUserId) payload['pmo_RequestedBy@odata.bind'] = `/systemusers(${currentUserId})`;
    const created = await createRequest.mutateAsync(payload as Parameters<typeof createRequest.mutateAsync>[0]);
    const newId = created.pmo_projectrequestid;
    requestIdRef.current = newId;
    auditChange({
      entityType: 'intake',
      entityId: newId,
      entityName: (payload.pmo_name as string) || 'Untitled Request',
      action: 'create',
    });
    return newId;
  }

  /**
   * Explicit "Save as Draft" action. Persists whatever fields are filled so
   * far as a pmo_projectrequest with pmo_status = Draft, then navigates back
   * to /intake. Requires a non-empty pmo_name — otherwise we surface a popup
   * (nameRequiredDialog) telling the user to fill in a name first, rather
   * than silently persisting "Untitled Request".
   */
  async function handleSaveDraft() {
    const trimmedName = ((values.pmo_name as string) || '').trim();
    if (!trimmedName) {
      setNameRequiredDialogOpen(true);
      return;
    }
    if (!activeWorkflow || !workflowId) {
      toast.error('Please select a workflow before saving a draft.');
      return;
    }
    setSavingDraft(true);
    try {
      // ensureDraftRecord creates the row if it doesn't exist yet, or returns
      // the existing id. Either way, we then PATCH the current in-memory values
      // on top so the draft reflects the latest edits — mirroring what
      // handleAdvance already does on stage advance.
      const id = await ensureDraftRecord();
      const { columnPayload, extrasPatch } = splitValuesForPersist();
      const extractedJson = buildExtractedFieldsJson(extrasPatch);
      const updatePayload: Record<string, unknown> = {
        pmo_stageartifactsjson: JSON.stringify(artifacts),
        ...columnPayload,
      };
      if (extractedJson !== undefined) updatePayload.pmo_extractedfieldsjson = extractedJson;
      // Persist the stage the user is currently viewing so the queue
      // banner and the auto-jump-on-resume both start from the right
      // place. Uses the same synthetic->real index translation that
      // handleAdvance uses at line ~1138 (pmo_currentstagenumber is a
      // 0-based ARRAY INDEX into the REAL stage list as IntakeDetailPage
      // sees it; the wizard adds one synthetic Project Setup step before
      // the first approval stage, so any wizard index AFTER the synthetic
      // is one higher than the corresponding real index). If the user
      // saves while ON the synthetic Project Setup step, point at the
      // approval stage that follows it (Project Setup has no real
      // equivalent).
      const syntheticIdx = sortedStages.findIndex((st) => st.pmo_gatesetitemid === PROJECT_SETUP_STAGE_ID);
      if (stage && stage.pmo_gatesetitemid !== PROJECT_SETUP_STAGE_ID) {
        const realIdx = syntheticIdx >= 0 && currentStage > syntheticIdx
          ? currentStage - 1
          : currentStage;
        updatePayload.pmo_currentstagenumber = realIdx;
      } else if (syntheticIdx >= 0) {
        updatePayload.pmo_currentstagenumber = syntheticIdx;
      }
      await updateProjectRequest(id, updatePayload);
      qc.invalidateQueries({ queryKey: ['projectRequests'] });
      toast.success(`Draft "${trimmedName}" saved`);
      navigate('/intake');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  }

  /**
   * Cancel action. If nothing has been persisted yet (no artifact upload, no
   * stage advance), just navigate away — nothing to clean up. Otherwise open
   * the confirm dialog because the underlying record already exists in
   * Dataverse and the user needs to see that Cancel will delete it.
   */
  function handleCancelRequest() {
    if (!requestIdRef.current) {
      navigate('/intake');
      return;
    }
    setCancelDialogOpen(true);
  }

  /** Confirmed-cancel handler: delete the persisted draft (best-effort) and leave. */
  async function confirmCancelAndDelete() {
    const id = requestIdRef.current;
    if (!id) {
      setCancelDialogOpen(false);
      navigate('/intake');
      return;
    }
    setCancelling(true);
    const name = ((values.pmo_name as string) || 'Untitled Request').trim();
    try {
      await deleteProjectRequest(id);
      auditChange({
        entityType: 'intake',
        entityId: id,
        entityName: name,
        action: 'delete',
      });
      requestIdRef.current = null;
      toast.info('Draft discarded');
    } catch (err) {
      // Best-effort delete — if it fails (e.g. permissions), warn and still
      // navigate away. The draft will remain in /intake and the user can
      // delete it manually from the list, but we do NOT want them stuck on
      // the wizard because of a failed delete.
      toast.warning(
        `Cancelled, but the draft could not be deleted: ${err instanceof Error ? err.message : String(err)}. You can remove it from the intake list.`,
      );
    } finally {
      setCancelling(false);
      setCancelDialogOpen(false);
      navigate('/intake');
    }
  }

  async function handleArtifactUpload(artifactType: number, file: File) {
    setUploading(true);
    try {
      // Auto-create the draft record if it doesn't exist yet
      let id = requestIdRef.current;
      if (!id) {
        toast.info('Saving draft request before uploading…');
        id = await ensureDraftRecord();
      }
      // Route through the flag-aware client so intake artifacts honor
      // pmo.file_source (annotation vs SharePoint), same as every other surface.
      // Grouping on IntakeDetailPage keys on fileName+stageOrder, so a missing
      // SharePoint item id (async flow returns '') doesn't break display.
      // Upload + confirm. SharePoint is async; gating on `confirmed` keeps
      // `uploading` true (which disables Submit via canAdvance) until the file
      // actually lands, so conversion's carryIntakeDocsToRecord never runs before
      // the file exists. Annotation writes confirm immediately.
      const { doc, confirmed } = await uploadDocumentAndConfirm(file, { recordType: 'Intake Request', recordId: id });
      if (!confirmed) {
        toast.error(`${file.name} is still processing — please wait a moment before submitting.`);
        return;
      }
      setArtifacts((prev) => [...prev, {
        stageOrder: currentStage,
        artifactType,
        annotationId: doc.annotationId || `sp-${Date.now()}`,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      }]);
      toast.success(`${file.name} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function isStageComplete(): boolean {
    if (!stage) return false;
    const required = parseJsonArray<string>(stage.pmo_requiredfieldsjson, []);
    for (const field of required) {
      // HPI Issue is always optional — visible only when Payer Initiatives
      // is the selected primary team, and even then linking is opt-in.
      if (field === EXTRAS_FIELD_KEYS.hpiIssueId) continue;
      // Payer Issues are always optional, same reason.
      if (field === EXTRAS_FIELD_KEYS.payerIssueIds) continue;
      // Strategic Account Executive is always optional.
      if (field === EXTRAS_FIELD_KEYS.strategicAccountExecutive) continue;
      // Target Program is always optional — the UI shows "— No program
      // (optional) —" placeholder, validator must agree.
      if (field === EXTRAS_FIELD_KEYS.targetProgramId) continue;
      // Labor vs Financial tracking gates which of budget / forecasted-hours
      // is required. Default (no explicit value) is Labor.
      {
        const metric = typeof values['pmo_resourcemetrictype'] === 'number'
          ? (values['pmo_resourcemetrictype'] as number)
          : RESOURCE_METRIC_TYPE.Labor;
        const isFinancial = metric === RESOURCE_METRIC_TYPE.Financial;
        // Labor projects: forecasted hours required, budget irrelevant.
        // Financial projects: budget follows its normal (team) rule, hours irrelevant.
        if (field === 'pmo_forecastedlaborhours') {
          if (!isFinancial) { if (values[field] === undefined || values[field] === null || values[field] === '') return false; }
          continue;
        }
        if (field === 'pmo_estimatedbudget' && !isFinancial) continue;
      }
      // Team-scoped optional (currently Payer Initiatives + target completion
      // date + estimated budget). Renderer branch above drops the required
      // star for these; validator must agree.
      if (isTeamOptionalField(field, values, pmoTeamsRaw)) continue;
      // Team-scoped hidden (currently CFR Category on Payer Initiatives).
      // Renderer returns null for these; validator must agree.
      if (isTeamHiddenField(field, values, pmoTeamsRaw)) continue;
      const val = values[field];
      if (val === undefined || val === null || val === '') return false;
    }
    // Tracking Method lives on the stage that carries Estimated Budget. On a
    // Labor project that stage requires Forecasted Labor Hours even though the
    // seed config only lists pmo_estimatedbudget in requiredFields.
    if (required.includes('pmo_estimatedbudget')) {
      const metric = typeof values['pmo_resourcemetrictype'] === 'number'
        ? (values['pmo_resourcemetrictype'] as number)
        : RESOURCE_METRIC_TYPE.Labor;
      if (metric !== RESOURCE_METRIC_TYPE.Financial) {
        const h = values['pmo_forecastedlaborhours'];
        if (h === undefined || h === null || (h as unknown) === '') return false;
      }
    }
    return true;
  }

  async function handleAdvance() {
    if (!stage || !activeWorkflow) return;
    setSubmitting(true);

    try {
      const stageDataEntry = {
        completedAt: new Date().toISOString(),
        completedBy: 'current-user',
        fields: Object.fromEntries(
          parseJsonArray<string>(stage.pmo_requiredfieldsjson, []).map((f) => [f, values[f]]),
        ),
      };

      if (!requestIdRef.current) {
        // Record hasn't been created yet — create it now with full stage data
        const id = await ensureDraftRecord();
        // Update with stage data that wasn't included in the initial draft
        await updateProjectRequest(id, {
          pmo_stagedatajson: JSON.stringify({ stage_0: stageDataEntry }),
          pmo_stageartifactsjson: JSON.stringify(artifacts),
        });
      } else {
        const existingStageData = values._stagedatajson
          ? JSON.parse(values._stagedatajson as string) : {};
        existingStageData[`stage_${currentStage}`] = stageDataEntry;

        const { columnPayload, extrasPatch } = splitValuesForPersist();
        const extractedJson = buildExtractedFieldsJson(extrasPatch);
        const updatePayload: Record<string, unknown> = {
          pmo_stagedatajson: JSON.stringify(existingStageData),
          pmo_stageartifactsjson: JSON.stringify(artifacts),
          ...columnPayload,
        };
        if (extractedJson !== undefined) updatePayload.pmo_extractedfieldsjson = extractedJson;
        // pmo_currentstagenumber is a 0-based ARRAY INDEX into the REAL
        // stage list as IntakeDetailPage sees it (which has no synthetic
        // Project Setup stage). It is the stage the record is CURRENTLY ON --
        // i.e. what the queue banner and StageApprovalPanel both treat it as
        // (StageApprovalPanel line 239 writes stageIndex + 1 post-approval;
        // Analytics + IntakeDetailPage read it as a 0-based current-stage
        // index). handleAdvance therefore has to persist the NEXT stage's
        // real index -- the one setCurrentStage(s => s + 1) below will land
        // on -- not the just-completed stage's index. Otherwise the queue
        // banner lags by one every time the user hits Continue.
        //
        // The wizard's own sortedStages array inserts the synthetic Project
        // Setup step before the first approval gate. For a non-terminal
        // advance we need the real-stage index for wizard-index (currentStage + 1)
        // -- the stage the user is being moved to. If that next wizard stage
        // IS the synthetic Project Setup, we still can't persist a synthetic
        // index (there's no real-stage equivalent); in that case fall back
        // to the approval stage that follows the synthetic on the same real
        // index the detail page maps into.
        if (currentStage < sortedStages.length - 1) {
          const nextWizardIdx = currentStage + 1;
          const syntheticIdx = sortedStages.findIndex((s) => s.pmo_gatesetitemid === PROJECT_SETUP_STAGE_ID);
          const nextStage = sortedStages[nextWizardIdx];
          let nextRealIdx: number;
          if (nextStage && nextStage.pmo_gatesetitemid === PROJECT_SETUP_STAGE_ID) {
            // The next stage is the synthetic Project Setup itself; there's
            // no real stage index to store, so point at the synthetic's
            // insertion point (which is the next real stage's index).
            nextRealIdx = syntheticIdx;
          } else {
            nextRealIdx = syntheticIdx >= 0 && nextWizardIdx > syntheticIdx
              ? nextWizardIdx - 1
              : nextWizardIdx;
          }
          updatePayload.pmo_currentstagenumber = nextRealIdx;
        }
        await updateProjectRequest(requestIdRef.current, updatePayload as Record<string, unknown>);
        qc.invalidateQueries({ queryKey: ['projectRequests'] });
      }

      if (stage.pmo_requiresapproval) {
        // Convert only at the FINAL step. If an approval gate is reached before
        // the last stage (e.g. the synthetic Project Setup / PM step still
        // follows), just advance — do NOT convert yet. This guarantees the
        // project/program (and its PM/Sponsor assignment notifications) is only
        // created when the user completes the wizard at the Submit button, never
        // mid-flow. Fixes the 'assignee notified while still a draft' bug.
        const isLastStage = currentStage >= sortedStages.length - 1;
        if (!isLastStage) {
          setCurrentStage((s) => s + 1);
          return;
        }
        // Admin-bypass branch: auto-approve & convert if readiness passes.
        // We re-fetch the just-PATCHed record so validateConversionReadiness
        // sees the persisted state (the in-memory `values` map omits server-
        // computed columns and the merged extras JSON).
        if (bypassApproval) {
          const fresh = await getProjectRequest(requestIdRef.current!);
          const missing = validateConversionReadiness(fresh);
          if (missing.length > 0) {
            setMissingFieldsDialog({ open: true, missing });
            // Stay on the current stage; do NOT flip status to Submitted. The
            // user can fix the missing fields and re-click Submit.
            return;
          }
          const userId = (await resolveCurrentUserId()) ?? '';
          try {
            await autoApproveAndConvert({
              request: fresh,
              approvalChain: [],
              stageOrder: currentStage,
              currentUserId: userId,
              approvalRationale: 'Auto-approved via admin bypass toggle',
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
          toast.success('Submitted, approved, and converted automatically.');
          navigate(`/intake/${requestIdRef.current}`);
          return;
        }

        // Default: flip to Submitted and let the approver pick it up.
        await updateProjectRequest(requestIdRef.current!, { pmo_status: REQUEST_STATUS.Submitted });
        auditChange({
          entityType: 'intake',
          entityId: requestIdRef.current!,
          entityName: (values.pmo_name as string) || 'Untitled Request',
          action: 'submit',
          changes: [{
            kind: 'field',
            field: 'pmo_status',
            label: 'Status',
            old: 'Draft',
            new: 'Submitted',
          }],
        });
        toast.success('Submitted for review — you will be notified when approved.');
        navigate('/intake');
        return;
      }

      if (currentStage < sortedStages.length - 1) {
        setCurrentStage((s) => s + 1);
      } else {
        await updateProjectRequest(requestIdRef.current!, { pmo_status: REQUEST_STATUS.Approved });
        auditChange({
          entityType: 'intake',
          entityId: requestIdRef.current!,
          entityName: (values.pmo_name as string) || 'Untitled Request',
          action: 'approve',
          changes: [{
            kind: 'field',
            field: 'pmo_status',
            label: 'Status',
            old: 'Draft',
            new: 'Approved',
          }],
        });
        toast.success('All stages complete — request approved.');
        navigate(`/intake/${requestIdRef.current}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to advance');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingWorkflows || resumeLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {resumeLoading ? 'Loading saved draft...' : 'Loading intake workflows...'}
      </div>
    );
  }

  if (resumeError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Continue Draft" subtitle="Could not load this draft" />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {resumeError}
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Submit Request" subtitle="Start a governed intake request" />
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No intake workflows are configured. Contact your PMO administrator.</p>
        </div>
      </div>
    );
  }

  const showFeedbackBug         = allFt['intakeCard.feedbackBug']         !== false;
  const showFeedbackEnhancement = allFt['intakeCard.feedbackEnhancement'] !== false;
  const isWorkflowVisible = (wfName: string | undefined): boolean => isWorkflowVisibleWith(wfName, allFt);

  if (needsSelection) {
    const programWorkflows = workflows
      .filter((wf) => wf.pmo_targetentitytype === TARGET_ENTITY_TYPE.Program)
      .filter((wf) => isWorkflowVisible(wf.pmo_name));
    const projectWorkflows = workflows
      .filter((wf) => wf.pmo_targetentitytype !== TARGET_ENTITY_TYPE.Program)
      .filter((wf) => isWorkflowVisible(wf.pmo_name));

    return (
      <div className="space-y-6 max-w-4xl">
        <PageHeader title="Submit Request" subtitle="Select the type of request to submit" />

        {/* Hierarchy explainer */}
        <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-semibold text-foreground">Programs</span> are strategic initiatives that contain one or more related projects.
              <span className="font-semibold text-foreground"> Projects</span> are individual workstreams that deliver specific outcomes.
            </p>
            <p>Projects roll up to programs — start a <span className="font-medium">Program</span> when the work spans multiple coordinated efforts, or a <span className="font-medium">Project</span> for a single deliverable.</p>
          </div>
        </div>

        {/* Four-column layout: Programs | Projects | Requests | Feedback.
            Requests is a placeholder section -- see the coming-soon tile below. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* Programs column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Programs</h3>
              <span className="text-xs text-muted-foreground">— multi-project initiatives</span>
            </div>
            {programWorkflows.length > 0 ? programWorkflows.map((wf) => (
              <IntakeWorkflowCard
                key={wf.pmo_gatesettemplateid}
                workflow={wf}
                isProgram={true}
                onSelect={setSelectedWorkflowId}
              />
            )) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No program workflows configured.</p>
            )}
          </div>

          {/* Projects column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border">
              <FolderKanban className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Projects</h3>
              <span className="text-xs text-muted-foreground">— individual workstreams</span>
            </div>
            {projectWorkflows.length > 0 ? projectWorkflows.map((wf) => (
              <IntakeWorkflowCard
                key={wf.pmo_gatesettemplateid}
                workflow={wf}
                isProgram={false}
                onSelect={setSelectedWorkflowId}
              />
            )) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No project workflows configured.</p>
            )}
          </div>

          {/* Requests column — cross-team requests. Routes to the lightweight
              CrossTeamRequestForm (/intake/request); the created pmo_projectrequest
              is targeted at the chosen team and appears in that team's Intake Queue
              (team scoping in selectActionItems), plus the requester's own queue. */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1 border-b border-border">
              <Handshake className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Requests</h3>
              <span className="text-xs text-muted-foreground">— ask another team</span>
            </div>

            <button
              type="button"
              onClick={() => navigate('/intake/request')}
              className="w-full rounded-lg border bg-card p-4 text-left hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-medium text-foreground">Request from another team</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ask another team to take on a project.
              </p>
              <p className="mt-2 text-[11px] italic text-muted-foreground/80">
                Example: “Add a column to the Returned Checks dashboard.”
              </p>
            </button>
          </div>

          {/* Feedback column — hidden entirely if both feedback toggles are off */}
          {(showFeedbackBug || showFeedbackEnhancement) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-1 border-b border-border">
                <MessageSquareText className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Feedback</h3>
                <span className="text-xs text-muted-foreground">— bugs & suggestions</span>
              </div>
              {showFeedbackBug && (
                <button
                  type="button"
                  onClick={() => navigate('/intake/feedback/bug')}
                  className="w-full rounded-lg border bg-card p-4 text-left hover:border-rose-400/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Bug className="h-4 w-4 text-rose-500 shrink-0" />
                    <p className="text-sm font-medium text-foreground">Report a Bug</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Something isn't working as expected</p>
                </button>
              )}
              {showFeedbackEnhancement && (
                <button
                  type="button"
                  onClick={() => navigate('/intake/feedback/enhancement')}
                  className="w-full rounded-lg border bg-card p-4 text-left hover:border-amber-400/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
                    <p className="text-sm font-medium text-foreground">Suggest an Enhancement</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Share an idea to improve the application</p>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!stage) {
    return <div className="py-8 text-center text-muted-foreground text-sm">No stages configured for this workflow.</div>;
  }

  const stageLabel = stage.pmo_stagelabel || stage.pmo_name || `Stage ${currentStage + 1}`;
  // Continue is gated ONLY on stage completion + submit/upload state.
  // We deliberately do NOT wait on an in-flight HPI inline-create --
  // if the picker's saving flag gets stuck true (e.g. the form
  // unmounts mid-await), the button would lock forever until the
  // user save-drafts-and-reopens. HPI is skipped by isStageComplete
  // anyway; the create mutation runs to completion in Dataverse
  // independently, and the resulting HPI id is stamped on values
  // by the picker's own onChange when it eventually resolves.
  // 2026-07-17: Chandra's stuck-Continue report.
  const canAdvance = isStageComplete() && !submitting && !uploading && !hpiSaving;

  return (
    <div className="space-y-6">
      <PageHeader title="Submit Request" subtitle={activeWorkflow ? formatWorkflowName(activeWorkflow.pmo_name, sortedStages.length || undefined) : 'Governed Intake'} />

      {/* Stage progress — completed stages are clickable */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {sortedStages.map((s, i) => {
          const isCompleted = i < currentStage;
          const isCurrent = i === currentStage;
          const canNavigate = isCompleted;
          return (
            <div key={s.pmo_gatesetitemid} className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!canNavigate}
                onClick={() => { if (canNavigate) setCurrentStage(i); }}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors',
                  isCompleted ? 'bg-emerald-500 border-emerald-500 text-white cursor-pointer hover:bg-emerald-600' :
                  isCurrent ? 'bg-primary border-primary text-primary-foreground' :
                  'bg-muted border-border text-muted-foreground cursor-default',
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span className={cn('text-xs', isCurrent ? 'font-medium text-foreground' : isCompleted ? 'text-foreground cursor-pointer hover:underline' : 'text-muted-foreground')}
                onClick={() => { if (canNavigate) setCurrentStage(i); }}
                role={canNavigate ? 'button' : undefined}
              >
                {s.pmo_stagelabel || s.pmo_name || `Stage ${i + 1}`}
              </span>
              {i < sortedStages.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Completed stages summary
       *  Resolves lookup-field GUIDs to human-readable labels using the
       *  in-scope label maps. Without this, users on later stages saw
       *  raw GUIDs like "Primary Team: 166c959e-9a53-..." in the summary. */}
      {currentStage > 0 && (() => {
        const truncate = (s: string) => (s.length > 40 ? `${s.substring(0, 40)}…` : s);
        // Build O(1) GUID→label lookups from the already-loaded option arrays.
        const lookup = (opts: SelectOption[], id: string) => opts.find((x) => x.value === id)?.label ?? id;
        const currencyFmt = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: 'USD', maximumFractionDigits: 0,
        });

        const resolveValue = (fieldKey: string, raw: unknown): string => {
          // Date fields → MM/DD/YYYY (drop the time component the API returns)
          if (DATE_FIELDS.has(fieldKey) && raw) {
            const d = new Date(String(raw));
            if (!Number.isNaN(d.getTime())) return fmtDateOnly(String(raw));
          }
          // Number fields → currency for budget, plain number with commas otherwise
          if (NUMBER_FIELDS.has(fieldKey)) {
            const n = typeof raw === 'number' ? raw : Number(String(raw));
            if (!Number.isNaN(n)) {
              if (fieldKey === 'pmo_estimatedbudget') return currencyFmt.format(n);
              if (fieldKey === 'pmo_forecastedlaborhours') return `${n.toLocaleString('en-US')} h`;
              return n.toLocaleString('en-US');
            }
          }
          // Choice fields (picklists)
          if (CHOICE_FIELDS[fieldKey] && typeof raw === 'number') {
            return CHOICE_FIELDS[fieldKey][raw] ?? String(raw);
          }
          // Multi-select systems (extras.affectedSystemIds is string[] or CSV)
          if (MULTI_SYSTEM_LOOKUP_FIELDS.has(fieldKey)) {
            const ids: string[] = Array.isArray(raw)
              ? raw as string[]
              : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
            const names = ids.map((id) => lookup(systems, id));
            return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
          }
          // Single-system lookup (_pmo_affectedsystem_value)
          if (SYSTEM_LOOKUP_FIELDS.has(fieldKey)) {
            return lookup(systems, String(raw));
          }
          // Primary Team
          if (TEAM_LOOKUP_FIELDS.has(fieldKey)) {
            return lookup(pmoTeamsResolved, String(raw));
          }
          // Program
          if (PROGRAM_LOOKUP_FIELDS.has(fieldKey)) {
            return lookup(programs, String(raw));
          }
          // User lookups (project manager, exec sponsor, SAE). Resolved via
          // userLabelCache (populated by the effect near line ~815). If the
          // lookup has not resolved yet, show a short placeholder rather
          // than the raw GUID -- the effect re-runs on the next render and
          // the real name appears.
          if (PAYER_INITIATIVES_USER_FIELDS.has(fieldKey)) {
            const sae = raw as SaeValue;
            return sae.displayName || sae.email || sae.aadId || '';
          }
          if (USER_LOOKUP_FIELDS.has(fieldKey)) {
            const id = String(raw);
            return userLabelCache[id] ?? 'Loading…';
          }
          // Payer inquiries (extras.payerIssueIds) → inquiry NAME(s), never GUIDs.
          if (PAYER_ISSUE_LOOKUP_FIELDS.has(fieldKey)) {
            const ids: string[] = Array.isArray(raw)
              ? raw as string[]
              : typeof raw === 'string' && raw ? [raw] : [];
            const names = ids.map((id) => lookup(payerIssueOptions, id));
            return truncate(names.join(', '));
          }
          // Array fallback (multi-selects without specific resolver)
          if (Array.isArray(raw)) {
            return truncate(raw.map((x) => String(x)).join(', '));
          }
          // Default: stringify + truncate
          return truncate(String(raw));
        };

        return (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Completed</p>
            {sortedStages.slice(0, currentStage).map((s) => {
              const rawStgFields = parseJsonArray<string>(s.pmo_requiredfieldsjson, []);
              // The budget stage carries the Labor/Financial toggle. Swap the
              // displayed field to match how this request is tracked so the
              // summary shows Forecasted Labor Hours (Labor) or Estimated Budget
              // (Financial) instead of a blank/omitted line. Null metric = Labor.
              const stgFields = rawStgFields.flatMap((f) => {
                if (f !== 'pmo_estimatedbudget') return [f];
                const isFin = values['pmo_resourcemetrictype'] === RESOURCE_METRIC_TYPE.Financial;
                return isFin ? ['pmo_estimatedbudget'] : ['pmo_forecastedlaborhours'];
              });
              return (
                <div key={s.pmo_gatesetitemid} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="font-medium text-foreground">{s.pmo_stagelabel || s.pmo_name}</span>
                  {stgFields.length > 0 && (
                    <span className="text-muted-foreground">
                      — {stgFields.map((f) => {
                        const v = values[f];
                        if (v === undefined || v === null || v === '') return null;
                        if (Array.isArray(v) && v.length === 0) return null;
                        const label = INTAKE_CONFIGURABLE_FIELDS[f] ?? f;
                        return `${label}: ${resolveValue(f, v)}`;
                      }).filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Current stage form */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-foreground">{stageLabel}</span>
          <span className="text-xs text-muted-foreground">Step {currentStage + 1} of {sortedStages.length}</span>
          {stage.pmo_requiresapproval && (
            <span className="flex items-center gap-1 text-xs text-amber-600"><Shield className="h-3 w-3" />Requires approval</span>
          )}
        </div>

        <StageForm
          stage={stage}
          values={values}
          onChange={handleFieldChange}
          artifacts={artifacts.filter((a) => a.stageOrder === currentStage)}
          onArtifactUpload={handleArtifactUpload}
          uploading={uploading}
          isProgram={isProgramFlow}
          pmoTeams={pmoTeams}
          rawPmoTeams={pmoTeamsRaw}
          programs={programs}
          searchUsers={searchUsers}
          resolveUserLabel={resolveUserLabel}
          onHpiSavingChange={setHpiSaving}
        />

        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="flex items-center gap-3">
            {currentStage > 0 && (
              <Button variant="outline" onClick={() => setCurrentStage((s) => s - 1)} disabled={submitting}>
                <ChevronLeft className="h-4 w-4 mr-1" />Back
              </Button>
            )}
            <Button variant="ghost" onClick={handleCancelRequest}>Cancel</Button>
            <Button variant="outline" onClick={handleSaveDraft} disabled={savingDraft}>
              {savingDraft && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save as Draft
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {hpiSaving && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finish creating the HPI — click “Create & link HPI”
              </span>
            )}
            <Button onClick={handleAdvance} disabled={!canAdvance}>
              {(submitting || hpiSaving) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {currentStage < sortedStages.length - 1 ? 'Continue' : stage.pmo_requiresapproval ? 'Submit for Review' : 'Complete'}
              {!submitting && !hpiSaving && currentStage < sortedStages.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Bypass-mode "missing required fields" modal. Surfaces when the
          admin has flipped intake.bypassApproval ON but the request is
          not yet ready for auto-conversion. Lists the human-readable
          field labels from validateConversionReadiness so the user knows
          exactly what to fix. Closing the dialog leaves the wizard on
          the current stage with all entered data preserved. */}
      <Dialog open={missingFieldsDialog.open} onOpenChange={(o) => { if (!o) setMissingFieldsDialog({ open: false, missing: [] }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cannot auto-approve — missing required fields</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              The bypass-approval toggle is on, but the following fields must be
              completed before this request can be auto-approved and converted:
            </p>
            <ul className="list-disc pl-5 space-y-0.5 text-foreground">
              {missingFieldsDialog.missing.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground pt-1">
              Navigate back to fill these in, then click Submit again.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setMissingFieldsDialog({ open: false, missing: [] })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel-confirm dialog. Only surfaces when a draft record has already
          been persisted (silent create from an earlier artifact upload or
          stage advance). Clicking Discard permanently deletes the draft. */}
      <Dialog open={cancelDialogOpen} onOpenChange={(o) => { if (!o && !cancelling) setCancelDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              You've already started a draft request. Cancelling will permanently
              delete it. This can't be undone.
            </p>
            <p className="text-xs">
              To keep the draft and finish it later, use <span className="font-medium text-foreground">Save as Draft</span> instead.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={confirmCancelAndDelete} disabled={cancelling}>
              {cancelling && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Discard draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Name-required dialog. Surfaces when the user clicks Save as Draft
          before typing a name — we refuse to persist an unnamed draft so
          the intake list stays useful. */}
      <Dialog open={nameRequiredDialogOpen} onOpenChange={(o) => { if (!o) setNameRequiredDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Name required to save a draft</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Please give this request a name before saving it as a draft.
          </p>
          <DialogFooter>
            <Button onClick={() => setNameRequiredDialogOpen(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
