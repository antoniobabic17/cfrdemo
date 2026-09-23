import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { StagingFailureWatcher } from '../../components/common/StagingFailureWatcher';
import {
  Layers, AlertTriangle,
  Users, Plus, Trash2, Calendar, User, CircleAlert, Clock, Target,
  FileText, Pencil, Link2, Lock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/PageHeader';
import { ReadOnlyField } from '../../components/common/ReadOnlyField';
import { HealthBadge } from '../../components/common/HealthBadge';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { ActivityFeed } from '../../components/common/ActivityFeed';
import { NotesSection } from '../../components/projects/NotesSection';
import { TrackingLabelsCard } from '../../components/projects/TrackingLabelsCard';
import { MultiSelectCheckList } from '../../components/common/MultiSelectCheckList';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { SaePicker } from '../../components/common/SaePicker';
import { readSae, resolveSaeDisplay, hasSae, saeWritePayload, type SaeValue } from '../../lib/sae';
import { useProject, useUpdateProject } from '../../hooks/useProjects';
import { useCanEditProject, useCanEditProjectRoster, READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { markPendingExtras, markExtrasDone } from '../../lib/pendingExtrasStore';
import { useChangeAudit, type ChangeAuditFieldDiff } from '../../hooks/useChangeAudit';
import { diffEntityUpdate, PROJECT_FIELD_LABELS, TASK_FIELD_LABELS, RISK_FIELD_LABELS, ISSUE_FIELD_LABELS, CHANGE_FIELD_LABELS, STATUS_REPORT_FIELD_LABELS } from '../../lib/changeAuditFields';
import { useUrlState, PROJECT_TABS, MONITOR_SUB_TABS, TASK_VIEWS, type TaskView, type MonitorSubTab } from '../../hooks/useUrlState';
import { useUatProjectTabEnabled } from '../../features/uat/lib/useUatProjectTabEnabled';
import { ProjectUatTab } from '../../features/uat/pages/ProjectUatTab';
import { isDeepLinkAvailable, buildDeepLink } from '../../lib/deepLink';
import type { Project, ProjectUpdate } from '../../models/project.model';
import { useProjectTeams, useAddProjectTeam, useRemoveProjectTeam } from '../../hooks/useProjectTeams';
import { useProjectCollaborators, useAddProjectCollaborators, useRemoveProjectCollaborator } from '../../hooks/useProjectCollaborators';
import { useCollaborationMode } from '../../lib/collaborationMode';
import { useProjectScopedUsers } from '../../hooks/useProjectScopedUsers';
import { useTaskSource, usesCustomTables } from '../../lib/taskSource';
import * as dv from '../../lib/dataverseClient';
import { emitRoleAssigned, emitMonitorItemAssigned } from '../../lib/notify';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { applyPrimaryTeamChange } from '../../lib/primaryTeamChange';
import { PrimaryTeamChangeConfirmDialog } from '../../components/projects/PrimaryTeamChangeConfirmDialog';
import { invokeFlushTaskStaging } from '../../api/taskStaging.api';
import { fetchPmoTeams, resolveSidebarTeamName } from '../../lib/pmoTeams';
import { useProjectTeamMembers } from '../../hooks/useProjectTeamMembers';
import { listProjectTeamMembers } from '../../api/projectTeamMembers.api';
import { useAddProjectTeamMember, useRemoveProjectTeamMember } from '../../hooks/useProjectTeamMemberMutations';
import { useResourceAssignments } from '../../hooks/useResourceAssignments';
import { useAssignResource, useUnassignResource } from '../../hooks/useResourceAssignmentMutations';
import { useBookableResources } from '../../hooks/useBookableResources';
import { useProjectBuckets } from '../../hooks/useProjectBuckets';
import { useProjectTasks } from '../../hooks/useProjectTasks';
import {
  useStatusReports, useCreateStatusReport, useUpdateStatusReport, useDeleteStatusReport,
} from '../../hooks/useStatusReports';
import {
  useProjectRisks, useCreateProjectRisk, useUpdateProjectRisk, useDeleteProjectRisk,
} from '../../hooks/useProjectRisks';
import {
  useProjectIssues, useCreateProjectIssue, useUpdateProjectIssue, useDeleteProjectIssue,
} from '../../hooks/useProjectIssues';
import {
  useProjectChanges, useCreateProjectChange, useUpdateProjectChange, useDeleteProjectChange,
} from '../../hooks/useProjectChanges';
import {
  OVERALL_HEALTH, TEAM_ROLE, ENTITY_SETS,
  RISK_CATEGORY, ACCEL_STATE, ISSUE_CATEGORY, ACCEL_PRIORITY,
  CHANGE_TYPE, CHANGE_IMPACT, CHANGE_RISK, CHANGE_APPROVAL,
  CFR_CATEGORY, COMPLEXITY, STRATEGIC_PRIORITY, SETTING_USER_SCOPE_GROUP,
  PROJECT_STATUS_OPTIONS, RESOURCE_METRIC_TYPE,
  AFFECTED_SYSTEM_SELECT_OPTIONS, arrayToMultiSelect, multiSelectToArray,
} from '../../lib/constants';
import { useDataSource } from '../../lib/taskSource';
import { usePmoTeamField, useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { useEffectiveFeatureToggles as useFeatureToggles } from '../../hooks/useEffectiveFeatureToggles';
import { DeleteConfirmDialog, type DeleteChildSummary } from '../../components/common/DeleteConfirmDialog';
import { cascadeDeleteProject, summarizeProjectDelete } from '../../lib/cascadeDelete';
import { markDeleting, unmarkDeleting } from '../../lib/deletingStore';
import { useAppSetting, useAppSettings, useStandardCapacityHours } from '../../hooks/useAppSettings';
import type { ProjectRisk } from '../../models/projectRisk.model';
import type { ProjectIssue } from '../../models/projectIssue.model';
import type { ProjectChange } from '../../models/projectChange.model';
import type { StatusReport } from '../../models/statusReport.model';
import { TaskWorkspace } from '../../components/scheduling/TaskWorkspace';
import {
  useCreateProjectTask,
  useUpdateProjectTask,
  useDeleteProjectTask,
} from '../../hooks/useProjectTaskMutations';
import { useProjectTaskDependencies } from '../../hooks/useProjectTaskDependencies';
// Dependency mutations — re-enabled on the custom source (Phase 0.2b). On the
// custom source these write direct to pmo_taskdependency (HTTP 204, no PSS
// license gate). The callbacks are passed to TaskWorkspace only when the data
// source is custom (see the TaskWorkspace props below).
import {
  useCreateProjectTaskDependency,
  useDeleteProjectTaskDependency,
} from '../../hooks/useProjectTaskDependencyMutations';
import { useQueryClient } from '@tanstack/react-query';
import { updateProjectSchedule } from '../../lib/schedulingClient';
import type { ScheduleTaskCreate } from '../../lib/schedulingClient';
import { listProjectTasks } from '../../api/projectTasks.api';
import { PSS_DELAY } from '../../hooks/useProjectTaskMutations';
import type { CreateTaskExtras } from '../../components/scheduling/CreateTaskDialog';
import { MonitorWorkspace } from '../../components/projects/MonitorWorkspace';
import { GovernWorkspace } from '../../components/projects/GovernWorkspace';
import { PlanWorkspace } from '../../components/projects/PlanWorkspace';
import { CollaborateWorkspace } from '../../components/projects/CollaborateWorkspace';
import { useProjectDecisions } from '../../hooks/useProjectDecisions';
import { useProjectNotes, useTaskNotesRollup } from '../../hooks/useProjectNotes';

import { toast } from '../../hooks/useToast';
import { logAppError } from '../../lib/errorLog';
import { PAYER_INITIATIVES_TEAM_ID, PAYER_INITIATIVES_TEAM_NAMES } from '../../features/teams/payer-initiatives/constants';
import { ProjectHpiTab } from '../../features/teams/payer-initiatives/components/ProjectHpiTab';
import { ProjectPayerIssuesTab } from '../../features/teams/payer-initiatives/components/ProjectPayerIssuesTab';
import { BI_CODING_TEAM_ID } from '../../features/teams/bi-coding/constants';
import { ProjectCodingTab } from '../../features/teams/bi-coding/components/ProjectCodingTab';
import { dateInputValue, fmtDateOnly, toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';

// ─── Formatters ───────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

function fmtCurrency(v?: number) { return v != null ? currencyFmt.format(v) : '—'; }
// fmtDate delegates to the central helper so display + edit + write
// use one convention for date-only Dataverse columns.
function fmtDate(v?: string) { return fmtDateOnly(v); }
function fmtNumber(v?: number, decimals = 0) { return v != null ? v.toFixed(decimals) : '—'; }

// extractDvMessage moved to workspace components

// ─── Style helpers ────────────────────────────────────────────────────────────


// Card components (RiskCard, IssueCard, ChangeCard) moved to MonitorWorkspace

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-xs font-semibold uppercase tracking-widest text-muted-foreground', className)}>
      {children}
    </h3>
  );
}

function ProgressBar({ value, className }: { value?: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-primary' : 'bg-amber-500';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold text-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

function StatCell({ label, value, accent, onClick }: { label: string; value: string | number; accent?: 'rose' | 'amber' | 'blue'; onClick?: () => void }) {
  const textColor =
    accent === 'rose' ? 'text-rose-500' :
    accent === 'amber' ? 'text-amber-500' :
    accent === 'blue' ? 'text-blue-500' :
    'text-foreground';
  return (
    <div
      className={cn('px-5 py-3 text-center', onClick && 'cursor-pointer hover:bg-muted/40 transition-colors')}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <p className={cn('text-lg font-bold tabular-nums leading-none', textColor)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function MetaPill({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}

function AlertRow({ icon: Icon, message, level = 'warning', action }: {
  icon: React.ElementType; message: string; level?: 'warning' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}) {
  const styles = {
    warning: 'bg-amber-500/8 border-amber-500/25 text-amber-700 dark:text-amber-300',
    error: 'bg-rose-500/8 border-rose-500/25 text-rose-700 dark:text-rose-300',
    info: 'bg-blue-500/8 border-blue-500/25 text-blue-700 dark:text-blue-300',
  };
  const iconColors = { warning: 'text-amber-500', error: 'text-rose-500', info: 'text-blue-500' };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5', styles[level])}>
      <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', iconColors[level])} />
      <div className="flex-1 flex items-center justify-between gap-3">
        <p className="text-xs leading-relaxed">{message}</p>
        {action && (
          <button onClick={action.onClick} className="shrink-0 text-xs font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity whitespace-nowrap">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function BudgetBar({ budget, actual }: { budget?: number; actual?: number }) {
  if (!budget) return null;
  const pct = Math.min(100, ((actual ?? 0) / budget) * 100);
  const color = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
        <span>Budget utilization</span>
        <span className="font-semibold text-foreground">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function FormInput({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

function FormSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={placeholder ?? 'Select...'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— None —</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const RISK_CAT_OPTIONS   = Object.entries(RISK_CATEGORY).map(([k, v]) => ({ value: String(v), label: k }));
const ACCEL_STATE_OPTIONS = [
  { value: String(ACCEL_STATE.Proposed), label: '(1) Proposed' },
  { value: String(ACCEL_STATE.Active),   label: '(2) Active' },
  { value: String(ACCEL_STATE.Closed),   label: '(3) Closed' },
  { value: String(ACCEL_STATE.OnHold),   label: '(4) On Hold' },
];
const ACCEL_PRI_OPTIONS = [
  { value: String(ACCEL_PRIORITY.Critical), label: '(1) Critical' },
  { value: String(ACCEL_PRIORITY.High),     label: '(2) High' },
  { value: String(ACCEL_PRIORITY.Moderate), label: '(3) Moderate' },
  { value: String(ACCEL_PRIORITY.Low),      label: '(4) Low' },
];
const ISSUE_CAT_OPTIONS = Object.entries(ISSUE_CATEGORY).map(([k, v]) => ({ value: String(v), label: k }));
const CHANGE_TYPE_OPTIONS = [
  { value: String(CHANGE_TYPE.Scope),    label: 'Scope' },
  { value: String(CHANGE_TYPE.Schedule), label: 'Schedule' },
  { value: String(CHANGE_TYPE.Cost),     label: 'Cost' },
  { value: String(CHANGE_TYPE.None),     label: 'None' },
];
const CHANGE_IMPACT_OPTIONS = [
  { value: String(CHANGE_IMPACT.High),   label: '(1) High' },
  { value: String(CHANGE_IMPACT.Medium), label: '(2) Medium' },
  { value: String(CHANGE_IMPACT.Low),    label: '(3) Low' },
];
const CHANGE_RISK_OPTIONS = [
  { value: String(CHANGE_RISK.High),     label: '(1) High' },
  { value: String(CHANGE_RISK.Moderate), label: '(2) Moderate' },
  { value: String(CHANGE_RISK.Low),      label: '(3) Low' },
  { value: String(CHANGE_RISK.None),     label: '(4) None' },
];
const CHANGE_APPROVAL_OPTIONS = [
  { value: String(CHANGE_APPROVAL.NotYetRequested), label: '(1) Not Yet Requested' },
  { value: String(CHANGE_APPROVAL.Requested),       label: '(2) Requested' },
  { value: String(CHANGE_APPROVAL.Approved),        label: '(3) Approved' },
  { value: String(CHANGE_APPROVAL.Rejected),        label: '(4) Rejected' },
];

function numOrNull(s: string): number | null {
  if (!s || s === '__none__') return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
function dateOnlyOrNull(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  return toDataverseDateOnly(trimmed) ?? null;
}

/**
 * Drop a null `proj_AssignedTo@odata.bind` from a payload before sending it
 * to a Dataverse CREATE. Sending null on create is rejected; on update it
 * means "clear the lookup", which is what we want. The form always emits a
 * value (bind or null) so the update path can clear; here we strip the null
 * so create accepts the payload.
 */
function stripNullAssignee<T extends { 'proj_AssignedTo@odata.bind'?: string | null }>(payload: T): Omit<T, 'proj_AssignedTo@odata.bind'> & { 'proj_AssignedTo@odata.bind'?: string } {
  const { 'proj_AssignedTo@odata.bind': bind, ...rest } = payload;
  if (bind == null) return rest as Omit<T, 'proj_AssignedTo@odata.bind'> & { 'proj_AssignedTo@odata.bind'?: string };
  return { ...rest, 'proj_AssignedTo@odata.bind': bind } as Omit<T, 'proj_AssignedTo@odata.bind'> & { 'proj_AssignedTo@odata.bind'?: string };
}

/** Pull the bare systemuserid out of a `/systemusers(<guid>)` @odata.bind
 *  string. Returns '' for null/undefined/unparseable -- the notify emitter
 *  treats '' as "no assignee" and no-ops. */
function assigneeGuidFromBind(bind?: string | null): string {
  if (!bind) return '';
  const m = bind.match(/\(([^)]+)\)/);
  return (m ? m[1] : '').replace(/[{}]/g, '').trim();
}

// ─── Risk Form Dialog ─────────────────────────────────────────────────────────

function RiskFormDialog({ open, editing, existingRisks, isPending, onClose, onSave, assigneeOptions, resolveAssigneeLabel }: {
  open: boolean; editing: ProjectRisk | null; existingRisks: ProjectRisk[];
  isPending: boolean; onClose: () => void;
  onSave: (payload: { msdyn_subject: string; msdyn_description?: string; msdyn_mitigationplan?: string; msdyn_contingencyplan?: string; proj_impact?: number | null; proj_probability?: number | null; proj_category?: number | null; proj_state?: number | null; proj_due?: string | null; 'proj_AssignedTo@odata.bind'?: string | null }) => void;
  assigneeOptions: { value: string; label: string }[];
  resolveAssigneeLabel: (id: string) => Promise<string>;
}) {
  // msdyn_subject is the user-visible name; msdyn_name is the unique system key (auto-generated on create)
  const [subject, setSubject] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [impact, setImpact] = useState('');
  const [probability, setProbability] = useState('');
  const [due, setDue] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [contingency, setContingency] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubject(editing.msdyn_subject ?? editing.msdyn_name ?? '');
      setDesc(editing.msdyn_description ?? '');
      setCategory(editing.proj_category != null ? String(editing.proj_category) : '');
      setState(editing.proj_state != null ? String(editing.proj_state) : '');
      setImpact(editing.proj_impact != null ? String(editing.proj_impact) : '');
      setProbability(editing.proj_probability != null ? String(editing.proj_probability) : '');
      setDue(dateInputValue(editing.proj_due));
      setMitigation(editing.msdyn_mitigationplan ?? '');
      setContingency(editing.msdyn_contingencyplan ?? '');
      setAssigneeId(editing['_proj_assignedto_value'] ?? '');
    } else {
      setSubject(''); setDesc(''); setCategory(''); setState('');
      setImpact(''); setProbability(''); setDue(''); setMitigation(''); setContingency('');
      setAssigneeId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.msdyn_projectriskid]);

  const duplicateInProject = !editing && existingRisks.some((r) =>
    (r.msdyn_subject ?? r.msdyn_name ?? '').trim().toLowerCase() === subject.trim().toLowerCase()
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Risk' : 'New Risk'}</DialogTitle>
          <DialogDescription>{editing ? 'Update this risk record.' : 'Add a new risk to this project.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormRow label="Risk Name *">
            <FormInput value={subject} onChange={setSubject} placeholder="Brief risk title" />
            {duplicateInProject && (
              <p className="text-xs text-destructive mt-1">A risk with this name already exists in this project.</p>
            )}
          </FormRow>
          <FormRow label="Description"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Describe the risk..." /></FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Category"><FormSelect value={category} onChange={setCategory} options={RISK_CAT_OPTIONS} /></FormRow>
            <FormRow label="State"><FormSelect value={state} onChange={setState} options={ACCEL_STATE_OPTIONS} /></FormRow>
            <FormRow label="Impact (1–5)"><FormInput type="number" value={impact} onChange={setImpact} placeholder="1–5" /></FormRow>
            <FormRow label="Probability (1–5)"><FormInput type="number" value={probability} onChange={setProbability} placeholder="1–5" /></FormRow>
            <FormRow label="Due Date"><FormInput type="date" value={due} onChange={setDue} /></FormRow>
          </div>
          <FormRow label="Assigned To">
            <SearchableSelect value={assigneeId} onChange={(v) => setAssigneeId(v ?? '')} options={assigneeOptions} resolveLabel={resolveAssigneeLabel} placeholder="— Unassigned —" />
          </FormRow>
          <FormRow label="Mitigation Plan"><Textarea value={mitigation} onChange={(e) => setMitigation(e.target.value)} rows={3} placeholder="How will we mitigate this risk?" /></FormRow>
          <FormRow label="Contingency Plan"><Textarea value={contingency} onChange={(e) => setContingency(e.target.value)} rows={3} placeholder="What's the fallback if the risk materializes?" /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={!subject.trim() || duplicateInProject || isPending} onClick={() => onSave({
            msdyn_subject: subject.trim(),
            msdyn_description: desc.trim() || undefined,
            proj_category: numOrNull(category),
            proj_state: numOrNull(state),
            proj_impact: numOrNull(impact),
            proj_probability: numOrNull(probability),
            proj_due: dateOnlyOrNull(due),
            msdyn_mitigationplan: mitigation.trim() || undefined,
            msdyn_contingencyplan: contingency.trim() || undefined,
            'proj_AssignedTo@odata.bind': assigneeId ? `/systemusers(${assigneeId})` : null,
          })}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Risk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Issue Form Dialog ────────────────────────────────────────────────────────

function IssueFormDialog({ open, editing, existingIssues, isPending, onClose, onSave, assigneeOptions, resolveAssigneeLabel }: {
  open: boolean; editing: ProjectIssue | null; existingIssues: ProjectIssue[];
  isPending: boolean; onClose: () => void;
  onSave: (payload: { msdyn_name: string; msdyn_description?: string; msdyn_resolution?: string; proj_issuecategory?: number | null; proj_priority?: number | null; proj_state?: number | null; proj_duedate?: string | null; 'proj_AssignedTo@odata.bind'?: string | null }) => void;
  assigneeOptions: { value: string; label: string }[];
  resolveAssigneeLabel: (id: string) => Promise<string>;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [resolution, setResolution] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [state, setState] = useState('');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(editing.msdyn_name ?? '');
      setDesc(editing.msdyn_description ?? '');
      setResolution(editing.msdyn_resolution ?? '');
      setCategory(editing.proj_issuecategory != null ? String(editing.proj_issuecategory) : '');
      setPriority(editing.proj_priority != null ? String(editing.proj_priority) : '');
      setState(editing.proj_state != null ? String(editing.proj_state) : '');
      setDue(dateInputValue(editing.proj_duedate));
      setAssigneeId(editing['_proj_assignedto_value'] ?? '');
    } else {
      setName(''); setDesc(''); setResolution(''); setCategory(''); setPriority(''); setState(''); setDue('');
      setAssigneeId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.msdyn_projectissueid]);

  const duplicateInProject = !editing && existingIssues.some((i) =>
    (i.msdyn_name ?? '').trim().toLowerCase() === name.trim().toLowerCase()
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Issue' : 'New Issue'}</DialogTitle>
          <DialogDescription>{editing ? 'Update this issue.' : 'Log a new issue for this project.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormRow label="Title *">
            <FormInput value={name} onChange={setName} placeholder="Issue title" />
            {duplicateInProject && (
              <p className="text-xs text-destructive mt-1">An issue with this name already exists in this project.</p>
            )}
          </FormRow>
          <FormRow label="Description"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Describe the issue..." /></FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Category"><FormSelect value={category} onChange={setCategory} options={ISSUE_CAT_OPTIONS} /></FormRow>
            <FormRow label="Priority"><FormSelect value={priority} onChange={setPriority} options={ACCEL_PRI_OPTIONS} /></FormRow>
            <FormRow label="State"><FormSelect value={state} onChange={setState} options={ACCEL_STATE_OPTIONS} /></FormRow>
            <FormRow label="Due Date"><FormInput type="date" value={due} onChange={setDue} /></FormRow>
          </div>
          <FormRow label="Assigned To">
            <SearchableSelect value={assigneeId} onChange={(v) => setAssigneeId(v ?? '')} options={assigneeOptions} resolveLabel={resolveAssigneeLabel} placeholder="— Unassigned —" />
          </FormRow>
          <FormRow label="Resolution"><Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} placeholder="How was this resolved?" /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={!name.trim() || duplicateInProject || isPending} onClick={() => onSave({
            msdyn_name: name.trim(),
            msdyn_description: desc.trim() || undefined,
            msdyn_resolution: resolution.trim() || undefined,
            proj_issuecategory: numOrNull(category),
            proj_priority: numOrNull(priority),
            proj_state: numOrNull(state),
            proj_duedate: dateOnlyOrNull(due),
            'proj_AssignedTo@odata.bind': assigneeId ? `/systemusers(${assigneeId})` : null,
          })}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Change Form Dialog ───────────────────────────────────────────────────────

function ChangeFormDialog({ open, editing, existingChanges, isPending, onClose, onSave, assigneeOptions, resolveAssigneeLabel }: {
  open: boolean; editing: ProjectChange | null; existingChanges: ProjectChange[];
  isPending: boolean; onClose: () => void;
  onSave: (payload: { msdyn_name: string; msdyn_description?: string; msdyn_additionalcomments?: string; proj_changetype?: number | null; proj_changeimpact?: number | null; proj_changerisk?: number | null; proj_priority?: number | null; proj_approval?: number | null; proj_state?: number | null; proj_costimpact?: number | null; proj_requesteddate?: string | null; proj_plannedstartdate?: string | null; proj_plannedduedate?: string | null; proj_changebenefits?: string; proj_changeplan?: string; 'proj_AssignedTo@odata.bind'?: string | null }) => void;
  assigneeOptions: { value: string; label: string }[];
  resolveAssigneeLabel: (id: string) => Promise<string>;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [comments, setComments] = useState('');
  const [type, setType] = useState('');
  const [impact, setImpact] = useState('');
  const [risk, setRisk] = useState('');
  const [priority, setPriority] = useState('');
  const [approval, setApproval] = useState('');
  const [state, setState] = useState('');
  const [costImpact, setCostImpact] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [benefits, setBenefits] = useState('');
  const [plan, setPlan] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(editing.msdyn_name ?? '');
      setDesc(editing.msdyn_description ?? '');
      setComments(editing.msdyn_additionalcomments ?? '');
      setType(editing.proj_changetype != null ? String(editing.proj_changetype) : '');
      setImpact(editing.proj_changeimpact != null ? String(editing.proj_changeimpact) : '');
      setRisk(editing.proj_changerisk != null ? String(editing.proj_changerisk) : '');
      setPriority(editing.proj_priority != null ? String(editing.proj_priority) : '');
      setApproval(editing.proj_approval != null ? String(editing.proj_approval) : '');
      setState(editing.proj_state != null ? String(editing.proj_state) : '');
      setCostImpact(editing.proj_costimpact != null ? String(editing.proj_costimpact) : '');
      setRequestedDate(dateInputValue(editing.proj_requesteddate));
      setStartDate(dateInputValue(editing.proj_plannedstartdate));
      setDueDate(dateInputValue(editing.proj_plannedduedate));
      setBenefits(editing.proj_changebenefits ?? '');
      setPlan(editing.proj_changeplan ?? '');
      setAssigneeId(editing['_proj_assignedto_value'] ?? '');
    } else {
      setName(''); setDesc(''); setComments(''); setType(''); setImpact(''); setRisk('');
      setPriority(''); setApproval(''); setState(''); setCostImpact(''); setRequestedDate('');
      setStartDate(''); setDueDate(''); setBenefits(''); setPlan('');
      setAssigneeId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.msdyn_projectchangeid]);

  const duplicateInProject = !editing && existingChanges.some((c) =>
    (c.msdyn_name ?? '').trim().toLowerCase() === name.trim().toLowerCase()
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Change Request' : 'New Change Request'}</DialogTitle>
          <DialogDescription>{editing ? 'Update this change request.' : 'Submit a new change request for this project.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormRow label="Title *">
            <FormInput value={name} onChange={setName} placeholder="Change request title" />
            {duplicateInProject && (
              <p className="text-xs text-destructive mt-1">A change request with this name already exists in this project.</p>
            )}
          </FormRow>
          <FormRow label="Description"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="Describe the change..." /></FormRow>
          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Type"><FormSelect value={type} onChange={setType} options={CHANGE_TYPE_OPTIONS} /></FormRow>
            <FormRow label="Priority"><FormSelect value={priority} onChange={setPriority} options={ACCEL_PRI_OPTIONS} /></FormRow>
            <FormRow label="Impact"><FormSelect value={impact} onChange={setImpact} options={CHANGE_IMPACT_OPTIONS} /></FormRow>
            <FormRow label="Risk"><FormSelect value={risk} onChange={setRisk} options={CHANGE_RISK_OPTIONS} /></FormRow>
            <FormRow label="Approval"><FormSelect value={approval} onChange={setApproval} options={CHANGE_APPROVAL_OPTIONS} /></FormRow>
            <FormRow label="State"><FormSelect value={state} onChange={setState} options={ACCEL_STATE_OPTIONS} /></FormRow>
            <FormRow label="Cost Impact ($)"><FormInput type="number" value={costImpact} onChange={setCostImpact} placeholder="0" /></FormRow>
            <FormRow label="Requested Date"><FormInput type="date" value={requestedDate} onChange={setRequestedDate} /></FormRow>
            <FormRow label="Planned Start"><FormInput type="date" value={startDate} onChange={setStartDate} /></FormRow>
            <FormRow label="Planned Due"><FormInput type="date" value={dueDate} onChange={setDueDate} /></FormRow>
          </div>
          <FormRow label="Assigned To">
            <SearchableSelect value={assigneeId} onChange={(v) => setAssigneeId(v ?? '')} options={assigneeOptions} resolveLabel={resolveAssigneeLabel} placeholder="— Unassigned —" />
          </FormRow>
          <FormRow label="Benefits"><Textarea value={benefits} onChange={(e) => setBenefits(e.target.value)} rows={3} placeholder="Expected benefits of this change..." /></FormRow>
          <FormRow label="Change Plan"><Textarea value={plan} onChange={(e) => setPlan(e.target.value)} rows={3} placeholder="How will the change be implemented?" /></FormRow>
          <FormRow label="Additional Comments"><Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="Any additional notes..." /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={!name.trim() || duplicateInProject || isPending} onClick={() => onSave({
            msdyn_name: name.trim(),
            msdyn_description: desc.trim() || undefined,
            msdyn_additionalcomments: comments.trim() || undefined,
            proj_changetype: numOrNull(type),
            proj_changeimpact: numOrNull(impact),
            proj_changerisk: numOrNull(risk),
            proj_priority: numOrNull(priority),
            proj_approval: numOrNull(approval),
            proj_state: numOrNull(state),
            proj_costimpact: costImpact ? parseFloat(costImpact) : null,
            proj_requesteddate: dateOnlyOrNull(requestedDate),
            proj_plannedstartdate: dateOnlyOrNull(startDate),
            proj_plannedduedate: dateOnlyOrNull(dueDate),
            proj_changebenefits: benefits.trim() || undefined,
            proj_changeplan: plan.trim() || undefined,
            'proj_AssignedTo@odata.bind': assigneeId ? `/systemusers(${assigneeId})` : null,
          })}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Create Change Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status Report Form Dialog ────────────────────────────────────────────────

function StatusReportFormDialog({ open, editing, projectId: _projectId, isPending, onClose, onSave }: {
  open: boolean; editing: StatusReport | null; projectId: string;
  isPending: boolean; onClose: () => void;
  onSave: (payload: { msdyn_name: string; msdyn_accomplishedactivities?: string; msdyn_plannedactivities?: string; msdyn_additionalcomments?: string; proj_reportingdate?: string | null }) => void;
}) {
  const [name, setName] = useState('');
  const [accomplished, setAccomplished] = useState('');
  const [planned, setPlanned] = useState('');
  const [comments, setComments] = useState('');
  const [reportingDate, setReportingDate] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(editing.msdyn_name ?? '');
      setAccomplished(editing.msdyn_accomplishedactivities ?? '');
      setPlanned(editing.msdyn_plannedactivities ?? '');
      setComments(editing.msdyn_additionalcomments ?? '');
      setReportingDate(dateInputValue(editing.proj_reportingdate));
    } else {
      const today = todayLocalYmd();
      setName(''); setAccomplished(''); setPlanned(''); setComments('');
      setReportingDate(today);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.msdyn_projectstatusreportid]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Status Report' : 'New Status Report'}</DialogTitle>
          <DialogDescription>{editing ? 'Update this status report.' : 'Submit a status update for this project.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormRow label="Report Title *"><FormInput value={name} onChange={setName} placeholder="e.g. Week 16 Status Update" /></FormRow>
            </div>
            <div className="col-span-2">
              <FormRow label="Reporting Date"><FormInput type="date" value={reportingDate} onChange={setReportingDate} /></FormRow>
            </div>
          </div>
          <FormRow label="Accomplished Activities"><Textarea value={accomplished} onChange={(e) => setAccomplished(e.target.value)} rows={4} placeholder="What was accomplished this period?" /></FormRow>
          <FormRow label="Planned Activities"><Textarea value={planned} onChange={(e) => setPlanned(e.target.value)} rows={4} placeholder="What is planned for the next period?" /></FormRow>
          <FormRow label="Additional Comments"><Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Any additional comments or blockers..." /></FormRow>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={!name.trim() || isPending} onClick={() => onSave({
            msdyn_name: name.trim(),
            msdyn_accomplishedactivities: accomplished.trim() || undefined,
            msdyn_plannedactivities: planned.trim() || undefined,
            msdyn_additionalcomments: comments.trim() || undefined,
            proj_reportingdate: dateOnlyOrNull(reportingDate),
          })}>
            {isPending ? 'Saving...' : editing ? 'Save Changes' : 'Submit Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Project edit dialog (tabbed) ────────────────────────────────────────────

const CFR_CAT_OPTIONS = [
  { value: String(CFR_CATEGORY.ItInfrastructure), label: 'IT Infrastructure' },
  { value: String(CFR_CATEGORY.FinanceSystems),   label: 'Finance Systems' },
  { value: String(CFR_CATEGORY.Compliance),       label: 'Compliance' },
  { value: String(CFR_CATEGORY.DataAndAnalytics), label: 'Data & Analytics' },
  { value: String(CFR_CATEGORY.Operations),       label: 'Operations' },
  { value: String(CFR_CATEGORY.Other),            label: 'Other' },
];
const COMPLEXITY_OPTIONS = [
  { value: String(COMPLEXITY.Low),      label: 'Low' },
  { value: String(COMPLEXITY.Medium),   label: 'Medium' },
  { value: String(COMPLEXITY.High),     label: 'High' },
  { value: String(COMPLEXITY.Critical), label: 'Critical' },
];
const STRATEGIC_PRI_OPTIONS = [
  { value: String(STRATEGIC_PRIORITY.MustHave),    label: 'Must Have' },
  { value: String(STRATEGIC_PRIORITY.ShouldHave),  label: 'Should Have' },
  { value: String(STRATEGIC_PRIORITY.NiceToHave),  label: 'Nice to Have' },
];
const HEALTH_OPTIONS = [
  { value: String(OVERALL_HEALTH.OnTrack),  label: 'On Track' },
  { value: String(OVERALL_HEALTH.AtRisk),   label: 'At Risk' },
  { value: String(OVERALL_HEALTH.OffTrack), label: 'Off Track' },
];

/** Label + description shown at the top of each edit tab */
function TabSectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-4 border-b border-border/60">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

function ProjectEditDialog({
  open, onClose, project, onSave, isPending, error, initialTab, hasTasks, isAdmin,
}: {
  open: boolean; onClose: () => void; project: Project;
  onSave: (payload: ProjectUpdate, scheduleUpdate?: { scheduledStart?: string }) => Promise<void>;
  isPending: boolean;
  error?: Error | null;
  /** Which tab to open on. Callers pass 'governance' when the dialog is
   *  opened from the Key People card and 'financials' from the Financials
   *  card, so the operator lands on the section they clicked instead of
   *  having to click through the Details tab first. Defaults to 'details'. */
  initialTab?: string;
  /** True when this project has one or more tasks. Used to gate the
   *  "Task Finish Date" display: PSS reports msdyn_finish =
   *  msdyn_scheduledstart on task-less projects, which is misleading, so we
   *  render "-" for that case (same rule the Details-tab Schedule card
   *  uses). Passed through from the parent which owns the useProjectTasks
   *  cache so the dialog doesn't have to load it separately. */
  hasTasks: boolean;
  /** True when the current user is pmo_admin or system_admin. Gates the
   *  New Resource Model toggle. */
  isAdmin?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>(initialTab ?? 'details');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const userScopeGroupId = useAppSetting(SETTING_USER_SCOPE_GROUP);
  // pmo_projectstatus / pmo_executivesummary live only on the custom project
  // table; gate their edit controls so the PSS source never shows/PATCHes them.
  const isCustomSource = usesCustomTables(useDataSource());
  const pmoTeamField = usePmoTeamField();
  // (Manager field was removed from the edit dialog UI on 2026-07-01. The
  // proj_Manager column still exists on the msdyn_project entity because
  // programs reuse it as "Program Manager", and legacy projects that had a
  // Manager set continue to honor that user's edit access via
  // useProjectPermissions. But the field no longer surfaces on this dialog
  // or in Key People — Project Manager and Executive Sponsor are the two
  // canonical accountability roles for projects.)

  // ── Details ───────────────────────────────────────────────────────────────
  const [name, setName]           = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [initStartDate, setInitStartDate] = useState('');
  // Scheduled Completion (proj_scheduledcompletion) -- the requester's
  // original target completion date captured at intake. Editable from the
  // Details tab; PATCHed directly (not through PSS) since it's a plain
  // DateOnly column owned by us, not the P4W schedule engine.
  const [scheduledCompletion, setScheduledCompletion] = useState('');
  const [initScheduledCompletion, setInitScheduledCompletion] = useState('');
  // Manual, editable finish date (proj_actualfinishdate). Distinct from the
  // PSS/task-derived msdyn_finish (shown read-only as 'Task Finish Date').
  const [actualFinish, setActualFinish] = useState('');
  const [initActualFinish, setInitActualFinish] = useState('');

  // ── Governance ────────────────────────────────────────────────────────────
  // Track initial GUID so we only include a bind in the PATCH when the value changes.
  const [pmId, setPmId]           = useState('');
  const [sponsorId, setSponsorId] = useState('');
  const [programId, setProgramId] = useState('');
  const [primaryTeamId, setPrimaryTeamId] = useState('');
  // Strategic Account Executive (Payer Initiatives team feature). Stored as a
  // direct AAD identity (object id + name + email) via SaePicker, NOT a
  // systemuser lookup. See docs/planning/sae-systemuser-to-aad-transition-plan.md.
  const [sae, setSae]             = useState<SaeValue>({});
  const [initPmId, setInitPmId]   = useState('');
  const [initSponsorId, setInitSponsorId] = useState('');
  const [initProgramId, setInitProgramId] = useState('');
  const [initPrimaryTeamId, setInitPrimaryTeamId] = useState('');
  const [initSae, setInitSae]     = useState<SaeValue>({});

  // ── Health ────────────────────────────────────────────────────────────────
  const [overallHealth, setOverallHealth]     = useState('');
  const [scheduleHealth, setScheduleHealth]   = useState('');
  const [effortHealth, setEffortHealth]       = useState('');
  const [financialHealth, setFinancialHealth] = useState('');
  const [issueHealth, setIssueHealth]         = useState('');

  // ── Financials ────────────────────────────────────────────────────────────
  const [budget, setBudget]               = useState('');
  const [forecast, setForecast]           = useState('');
  const [benefits, setBenefits]           = useState('');
  const [fundingAvailable, setFundingAvailable] = useState(false);
  // New Resource Model fields (custom source only).
  const [forecastedLaborHours, setForecastedLaborHours] = useState('');
  const [useNRM, setUseNRM] = useState(false);
  // Resource Metric Type: Labor (track hours) vs Financial (track budget). Null
  // on the record is treated as Labor (business default). Editable on the tab.
  const [resourceMetricType, setResourceMetricType] = useState<number>(RESOURCE_METRIC_TYPE.Labor);

  // ── CFR Classification ────────────────────────────────────────────────────
  const [cfrCategory, setCfrCategory]         = useState('');
  const [affectedSystems, setAffectedSystems] = useState<string[]>([]);
  const [complexity, setComplexity]           = useState('');
  const [strategicPriority, setStrategicPriority] = useState('');

  // ── Project Status + Executive Summary (custom source only) ────────────────
  // pmo_projectstatus (5-value choice) + pmo_executivesummary (memo). Only
  // exist on the pmo_project custom table, so the edit controls are gated on
  // the active data source (see the `custom` flag below).
  const [projectStatus, setProjectStatus]     = useState('');
  const [executiveSummary, setExecutiveSummary] = useState('');

  // ── Narrative ─────────────────────────────────────────────────────────────
  const [businessCase, setBusinessCase]       = useState('');
  const [valueStatement, setValueStatement]   = useState('');
  const [comments, setComments]               = useState('');

  // ── Remote data (loaded once the dialog is open) ──────────────────────────
  const { data: programs = [] } = useQuery({
    queryKey: ['programs', 'forProjectEdit'],
    queryFn: () => dv.list<{ msdyn_projectprogramid: string; msdyn_name: string }>(
      ENTITY_SETS.program,
      { $select: ['msdyn_projectprogramid', 'msdyn_name'], $orderby: 'msdyn_name asc' },
    ),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Resolve AAD group object ID → Dataverse team GUID (stable across environments)
  const { data: scopeTeamId } = useQuery({
    queryKey: ['aadGroupTeam', userScopeGroupId],
    queryFn: async () => {
      const teams = await dv.list<{ teamid: string }>(ENTITY_SETS.team, {
        $select: ['teamid'],
        $filter: `azureactivedirectoryobjectid eq '${userScopeGroupId}'`,
        $top: 1,
      });
      return teams[0]?.teamid ?? null;
    },
    enabled: !!userScopeGroupId,
    staleTime: 30 * 60 * 1000,
  });

  // App settings drive the team-name override resolver used for teamOptions.
  const { data: teamNameSettings = [] } = useAppSettings();
  const { data: pmoTeams = [] } = useQuery({
    queryKey: ['systemTeams', 'forProjectEdit', pmoTeamField],
    queryFn: async () => {
      const all = await fetchPmoTeams<Record<string, unknown>>(pmoTeamField, ['teamid', 'name']);
      return all.map((t) => ({ teamid: t['teamid'] as string, name: t['name'] as string }));
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  type UserRow = { systemuserid: string; fullname: string; lastname: string; firstname: string };
  const fmtUserName = (u: UserRow) =>
    u.lastname && u.firstname ? `${u.lastname}, ${u.firstname}` : u.fullname;
  const toOptions = (users: UserRow[]) => users.map((u) => ({ value: u.systemuserid, label: fmtUserName(u) }));

  // Minimal exclusions only. The old filter
  //   accessmode ne 4 and accessmode ne 5 and applicationid eq null
  // excluded Support/Non-interactive users but also masked perfectly
  // normal users in some tenants (2026-07 operator report: SAE picker
  // could not find Heidi Hayden). Same rationale as hooks/useIntakeLookups.ts
  // -- trust default systemuser security so the picker surfaces everyone
  // the caller can see. If we ever need to filter out a specific class
  // again, do it in Dataverse security (role or team), not here.
  const USER_BASE_FILTER = "isdisabled eq false";

  const searchUsers = useCallback(async (query: string): Promise<{ value: string; label: string }[]> => {
    const safe = query.replace(/'/g, "''");
    const nameFilter = `(contains(lastname,'${safe}') or contains(firstname,'${safe}') or contains(fullname,'${safe}'))`;
    const scopeFilter = scopeTeamId
      ? `teammembership_association/any(t: t/teamid eq '${scopeTeamId}') and `
      : '';
    const users = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid', 'fullname', 'lastname', 'firstname'],
      $filter: `${scopeFilter}${USER_BASE_FILTER} and ${nameFilter}`,
      $orderby: 'lastname asc,firstname asc',
      $top: 50,
    });
    return toOptions(users);
  }, [scopeTeamId]);

  // (Org-wide SAE search now lives in SaePicker, backed by Microsoft Graph —
  // it covers identities that were never provisioned as Dataverse systemusers,
  // which is the whole point of the AAD transition.)

  const resolveUserLabel = useCallback(async (id: string): Promise<string> => {
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, ['systemuserid', 'fullname', 'lastname', 'firstname']);
    return fmtUserName(u);
  }, []);

  const programOptions = programs.map((p) => ({ value: p.msdyn_projectprogramid, label: p.msdyn_name }));
  // Apply the admin team-name override (same resolver the sidebar / filters /
  // list use) so a renamed team shows its display name in the Primary Team
  // dropdown too — not the raw Dataverse name. (2026-07-31 operator report.)
  const teamOptions = pmoTeams.map((t) => ({
    value: t.teamid,
    label: resolveSidebarTeamName(t.teamid, t.name, teamNameSettings),
  }));

  // ── Populate on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(initialTab ?? 'details');
    // Details
    setName(project.msdyn_subject ?? '');
    setDescription(project.msdyn_description ?? '');
    const initStart = dateInputValue(project.msdyn_scheduledstart);
    // Task Finish Date read model mirrors the Details-tab Schedule card:
    // trust msdyn_finish only when the project actually has tasks. Task-less
    // projects get "-" since PSS's msdyn_finish = msdyn_scheduledstart
    // bleed-through is misleading (see 2026-07-07 evening deploy).
    const initFinish = hasTasks ? dateInputValue(project.msdyn_finish) : '';
    const initSchedCompl = dateInputValue(project.proj_scheduledcompletion);
    setStartDate(initStart); setInitStartDate(initStart);
    setFinishDate(initFinish);
    setScheduledCompletion(initSchedCompl); setInitScheduledCompletion(initSchedCompl);
    const initActFin = dateInputValue(project.proj_actualfinishdate);
    setActualFinish(initActFin); setInitActualFinish(initActFin);
    // Governance lookups
    const initPm      = project['_msdyn_projectmanager_value'] ?? '';
    const initSponsor = project['_proj_executivesponsor_value'] ?? '';
    const initProg    = project['_msdyn_program_value'] ?? '';
    const initTeam    = project['_pmo_primaryteam_value'] ?? '';
    setPmId(initPm);      setInitPmId(initPm);
    setSponsorId(initSponsor); setInitSponsorId(initSponsor);
    setProgramId(initProg); setInitProgramId(initProg);
    setPrimaryTeamId(initTeam); setInitPrimaryTeamId(initTeam);
    const initSaeVal = readSae(project);
    setSae(initSaeVal); setInitSae(initSaeVal);
    // Health
    setOverallHealth(project.proj_overallhealth   != null ? String(project.proj_overallhealth)   : '');
    setScheduleHealth(project.proj_schedulehealth != null ? String(project.proj_schedulehealth) : '');
    setEffortHealth(project.proj_efforthealth     != null ? String(project.proj_efforthealth)   : '');
    setFinancialHealth(project.proj_financialhealth != null ? String(project.proj_financialhealth) : '');
    setIssueHealth(project.proj_issuehealth       != null ? String(project.proj_issuehealth)    : '');
    // Financials
    setBudget(project.proj_budget?.toString() ?? '');
    setForecast(project.proj_forecast?.toString() ?? '');
    setBenefits(project.proj_benefits?.toString() ?? '');
    setFundingAvailable(project.proj_fundingavailable ?? false);
    // New Resource Model (custom source)
    setForecastedLaborHours(project.pmo_forecastedlaborhours?.toString() ?? '');
    setUseNRM(project.pmo_usenewresourcemodel ?? false);
    setResourceMetricType(project.pmo_resourcemetrictype ?? RESOURCE_METRIC_TYPE.Labor);
    // CFR
    setCfrCategory(project.pmo_cfrcategory       != null ? String(project.pmo_cfrcategory)       : '');
    setAffectedSystems(multiSelectToArray(project.pmo_affectedsystems));
    setComplexity(project.pmo_complexity          != null ? String(project.pmo_complexity)         : '');
    setStrategicPriority(project.pmo_strategicpriority != null ? String(project.pmo_strategicpriority) : '');
    // Project Status + Executive Summary (custom source)
    setProjectStatus(project.pmo_projectstatus != null ? String(project.pmo_projectstatus) : '');
    setExecutiveSummary(project.pmo_executivesummary ?? '');
    // Narrative
    setBusinessCase(project.msdyn_businesscase ?? '');
    setValueStatement(project.msdyn_valuestatement ?? '');
    setComments(project.msdyn_comments ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project.msdyn_projectid, initialTab]);

  // ── Build payload on save ─────────────────────────────────────────────────
  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    const numOrUndef = (s: string) => s.trim() ? Number(s) : undefined;

    // msdyn_scheduledstart and msdyn_finish are excluded — the Project Operations
    // plugin blocks direct PATCH on scheduling-managed fields. Dates are controlled
    // by the scheduling engine via PSS when tasks are modified.
    const payload: ProjectUpdate = {
      msdyn_subject:        name.trim(),
      msdyn_description:    description || undefined,
      msdyn_businesscase:   businessCase || undefined,
      msdyn_valuestatement: valueStatement || undefined,
      msdyn_comments:       comments || undefined,
      proj_budget:          numOrUndef(budget),
      proj_forecast:        numOrUndef(forecast),
      proj_benefits:        numOrUndef(benefits),
      proj_fundingavailable: fundingAvailable,
      pmo_cfrcategory:       numOrNull(cfrCategory),
      pmo_affectedsystems:   arrayToMultiSelect(affectedSystems),
      pmo_complexity:        numOrNull(complexity),
      pmo_strategicpriority: numOrNull(strategicPriority),
      proj_overallhealth:    numOrNull(overallHealth),
      proj_schedulehealth:   numOrNull(scheduleHealth),
      proj_efforthealth:     numOrNull(effortHealth),
      proj_financialhealth:  numOrNull(financialHealth),
      proj_issuehealth:      numOrNull(issueHealth),
      // Custom-source-only fields (pmo_project table). Guarded on isCustomSource
      // so a PATCH against the PSS msdyn_project entity never carries columns
      // that don't exist there.
      ...(isCustomSource ? {
        pmo_projectstatus:    numOrNull(projectStatus),
        pmo_executivesummary: executiveSummary.trim() ? executiveSummary : null,
        pmo_forecastedlaborhours: forecastedLaborHours.trim() ? Number(forecastedLaborHours) : null,
        pmo_resourcemetrictype: resourceMetricType,
        // Toggle only written when the current user is admin (isAdmin gates the UI).
        ...(isAdmin ? { pmo_usenewresourcemodel: useNRM } : {}),
      } : {}),
    };

    // Lookup binds — only include if value changed from initial state.
    // Empty string = clear (send null bind); non-empty = set new value.
    if (scheduledCompletion !== initScheduledCompletion) {
      // Empty string clears the column; non-empty writes the noon-UTC ISO
      // string via toDataverseDateOnly so both DateOnly and User-Local
      // behavior columns round-trip in the picker's LOCAL calendar day.
      payload.proj_scheduledcompletion = scheduledCompletion
        ? toDataverseDateOnly(scheduledCompletion)
        : null as unknown as string;
    }
    if (actualFinish !== initActualFinish) {
      // Manual finish date (proj_actualfinishdate). Same DateOnly round-trip
      // handling as scheduledCompletion; empty clears the column.
      payload.proj_actualfinishdate = actualFinish
        ? toDataverseDateOnly(actualFinish)
        : null as unknown as string;
    }

    if (pmId !== initPmId) {
      payload['msdyn_projectmanager@odata.bind'] = pmId ? `/systemusers(${pmId})` : null;
    }
    if (sponsorId !== initSponsorId) {
      payload['proj_ExecutiveSponsor@odata.bind'] = sponsorId ? `/systemusers(${sponsorId})` : null;
    }
    if (programId !== initProgramId) {
      payload['msdyn_Program@odata.bind'] = programId ? `/msdyn_projectprograms(${programId})` : null;
    }
    if (primaryTeamId !== initPrimaryTeamId) {
      payload['pmo_PrimaryTeam@odata.bind'] = primaryTeamId ? `/teams(${primaryTeamId})` : null;
    }
    const saeKey = (v: SaeValue) => `${v.aadId ?? ''}|${v.displayName ?? ''}|${v.email ?? ''}`;
    if (saeKey(sae) !== saeKey(initSae)) {
      Object.assign(payload, saeWritePayload(hasSae(sae) ? sae : undefined));
    }

    // Strip undefined values — the Power Apps SDK may reject or mishandle them
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    ) as ProjectUpdate;

    // Start date goes through PSS (finish is computed by the engine and cannot be set)
    const scheduleUpdate: { scheduledStart?: string } = {};
    if (startDate !== initStartDate) scheduleUpdate.scheduledStart = startDate || undefined;

    try {
      await onSave(clean, Object.keys(scheduleUpdate).length ? scheduleUpdate : undefined);
      // Notify newly-assigned PM / Executive Sponsor (skip self-assign).
      // Only fires on an actual change to a non-empty person.
      const actor = dv.getCurrentUserId();
      if (pmId && pmId !== initPmId) {
        void emitRoleAssigned({ assigneeUserId: pmId, actorUserId: actor, role: 'Project Manager', entityKind: 'project', entityId: project.msdyn_projectid, entityName: project.msdyn_subject });
      }
      if (sponsorId && sponsorId !== initSponsorId) {
        void emitRoleAssigned({ assigneeUserId: sponsorId, actorUserId: actor, role: 'Executive Sponsor', entityKind: 'project', entityId: project.msdyn_projectid, entityName: project.msdyn_subject });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl flex flex-col overflow-hidden" style={{ maxHeight: '88vh' }}>
        <DialogHeader className="shrink-0 pb-0">
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update project details, governance, resourcing, health indicators, and CFR classification.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden mt-2">
          <TabsList className="shrink-0 bg-muted/30 w-full justify-start rounded-none border-b border-border/60 h-auto p-0 gap-0">
            {(['details', 'governance', 'financials', 'classification'] as const).map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent capitalize px-4 py-2.5 text-sm"
              >
                {t === 'details' ? 'Details' : t === 'governance' ? 'Governance' : t === 'financials' ? 'Resourcing' : 'Classification'}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── DETAILS TAB ── */}
          <TabsContent value="details" className="flex-1 overflow-y-auto px-1 py-4 space-y-4 mt-0">
            <TabSectionHeader title="Project Details" description="Core identification, description, and schedule dates." />
            <FormRow label="Project Title *">
              <FormInput value={name} onChange={setName} placeholder="Project title" />
            </FormRow>
            <FormRow label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                placeholder="Brief project description..." />
            </FormRow>
            <div className="grid grid-cols-2 gap-4">
              <FormRow label="Scheduled Start *">
                <FormInput type="date" value={startDate} onChange={setStartDate} />
                {!startDate && <p className="text-[11px] text-destructive">Required — task scheduling needs a project start date.</p>}
              </FormRow>
              <FormRow label="Scheduled Completion">
                <FormInput type="date" value={scheduledCompletion} onChange={setScheduledCompletion} />
                <p className="text-xs text-muted-foreground mt-0.5">The team's original target completion date.</p>
              </FormRow>
              <FormRow label="Finish Date">
                <FormInput type="date" value={actualFinish} onChange={setActualFinish} />
                <p className="text-xs text-muted-foreground mt-0.5">The project's actual finish date.</p>
              </FormRow>
              <FormRow label="Task Finish Date">
                <p className="text-sm text-foreground pt-1.5">{finishDate || '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Calculated from task dates.</p>
              </FormRow>
            </div>
          </TabsContent>

          {/* ── GOVERNANCE TAB ── */}
          <TabsContent value="governance" className="flex-1 overflow-y-auto px-1 py-4 space-y-5 mt-0">
            <TabSectionHeader title="Governance & Health" description="Ownership assignments, program association, and project health indicators." />

            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Ownership</p>
              <div className="grid grid-cols-2 gap-4">
                <FormRow label="Project Manager">
                  <SearchableSelect value={pmId} onChange={setPmId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="— None —" />
                </FormRow>
                <FormRow label="Executive Sponsor">
                  <SearchableSelect value={sponsorId} onChange={setSponsorId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="— None —" />
                </FormRow>
                <FormRow label="Primary Team">
                  <SearchableSelect value={primaryTeamId} onChange={setPrimaryTeamId} options={teamOptions} placeholder="— None —" />
                </FormRow>
                <FormRow label="Program">
                  <SearchableSelect value={programId} onChange={setProgramId} options={programOptions} placeholder="— None —" />
                </FormRow>
                {/* Payer Initiatives team-feature: SAE picker. Visible only
                    when this project's primary team is Payer Initiatives.
                    Org-wide search via useUserSearch (no scope filter) so
                    "anybody in the company" appears in results. */}
                {(primaryTeamId.toLowerCase() === PAYER_INITIATIVES_TEAM_ID.toLowerCase()
                  || PAYER_INITIATIVES_TEAM_NAMES.some((n) => n.toLowerCase() ===
                      (teamOptions.find((t) => t.value.toLowerCase() === primaryTeamId.toLowerCase())?.label ?? '').toLowerCase())) && (
                  <FormRow label="Strategic Account Executive">
                    <SaePicker
                      value={sae}
                      onChange={(v) => setSae(v ?? {})}
                    />
                  </FormRow>
                )}
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
                Selecting "None" for a currently-assigned field will clear that assignment on save.
              </p>
            </div>

            <div className="space-y-4 border-t border-border/60 pt-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Health Indicators</p>
              <div className="grid grid-cols-2 gap-4">
                <FormRow label="Overall Health">
                  <FormSelect value={overallHealth} onChange={setOverallHealth} options={HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Schedule Health">
                  <FormSelect value={scheduleHealth} onChange={setScheduleHealth} options={HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Effort Health">
                  <FormSelect value={effortHealth} onChange={setEffortHealth} options={HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Financial Health">
                  <FormSelect value={financialHealth} onChange={setFinancialHealth} options={HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Issue Health">
                  <FormSelect value={issueHealth} onChange={setIssueHealth} options={HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
              </div>
            </div>
          </TabsContent>

          {/* ── FINANCIALS TAB ── */}
          <TabsContent value="financials" className="flex-1 overflow-y-auto px-1 py-4 space-y-4 mt-0">
            <TabSectionHeader title="Resourcing" description={isCustomSource && resourceMetricType === RESOURCE_METRIC_TYPE.Labor ? "Labor hours forecast and resourcing rollups for this project." : "Budget, forecast, benefit value, and funding status."} />
            {(!isCustomSource || resourceMetricType === RESOURCE_METRIC_TYPE.Financial) && (<>
            {isCustomSource && (
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Financial Metrics</p>
            )}
            <div className="grid grid-cols-3 gap-4">
              <FormRow label="Budget ($)">
                <FormInput type="number" value={budget} onChange={setBudget} placeholder="0" />
              </FormRow>
              <FormRow label="Forecast ($)">
                <FormInput type="number" value={forecast} onChange={setForecast} placeholder="0" />
              </FormRow>
              <FormRow label="Benefits ($)">
                <FormInput type="number" value={benefits} onChange={setBenefits} placeholder="0" />
              </FormRow>
            </div>
            <FormRow label="Funding Available">
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="checkbox"
                  id="proj-funding-avail"
                  checked={fundingAvailable}
                  onChange={(e) => setFundingAvailable(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <label htmlFor="proj-funding-avail" className="text-sm text-foreground">
                  Funding is available for this project
                </label>
              </div>
            </FormRow>
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
              Actual Cost, Remaining Budget, Budget Variance, and ROI are computed by the PMO Accelerator and cannot be edited directly.
            </p>

            </>)}

            {/* ── Resourcing card — Labor projects only (New Resource Model, custom source). ── */}
            {isCustomSource && resourceMetricType === RESOURCE_METRIC_TYPE.Labor && (
              <div className="space-y-3 pt-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Labor Hours</p>
                <div className="grid grid-cols-3 gap-4">
                  <FormRow label="Forecasted Labor Hours (Entire Project)">
                    <FormInput
                      type="number"
                      value={forecastedLaborHours}
                      onChange={setForecastedLaborHours}
                      placeholder="hours"
                    />
                  </FormRow>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Current Completed Hours</label>
                    <div className="text-sm text-muted-foreground py-1">
                      {project.pmo_currentcompletedhours != null ? `${project.pmo_currentcompletedhours}h` : '—'}
                      <span className="text-xs text-muted-foreground/60 ml-1">(calculated)</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Current Total Task Hours</label>
                    <div className="text-sm text-muted-foreground py-1">
                      {project.pmo_currenttotalhours != null ? `${project.pmo_currenttotalhours}h` : '—'}
                      <span className="text-xs text-muted-foreground/60 ml-1">(calculated)</span>
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <FormRow label="Labor Hours Model">
                    <div className="flex items-start gap-3 mt-1">
                      <button
                        type="button"
                        role="switch"
                        id="nrm-toggle"
                        aria-checked={useNRM}
                        onClick={() => setUseNRM(!useNRM)}
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent mt-0.5',
                          'transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2',
                          'focus-visible:ring-ring focus-visible:ring-offset-2',
                          useNRM ? 'bg-primary' : 'bg-input',
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg',
                            'transform transition duration-200 ease-in-out',
                            useNRM ? 'translate-x-5' : 'translate-x-0',
                          )}
                        />
                      </button>
                      <label htmlFor="nrm-toggle" className="text-sm text-foreground leading-snug cursor-pointer">
                        <span className={cn(!useNRM && 'font-semibold text-foreground', useNRM && 'text-muted-foreground')}>
                          Old Labor Hours Model
                        </span>
                        {' '}/{' '}
                        <span className={cn(useNRM && 'font-semibold text-foreground', !useNRM && 'text-muted-foreground')}>
                          New Labor Hours Model
                        </span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          Labor hours are calculated differently between the two models. On the
                          New model: Hours Done is calculated from per-assignee contributed hours,
                          rollup columns update automatically, and a guardrail enforces assignee
                          hours ≤ task effort. Reversible at any time.
                        </span>
                      </label>
                    </div>
                  </FormRow>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── CLASSIFICATION TAB ── */}
          <TabsContent value="classification" className="flex-1 overflow-y-auto px-1 py-4 space-y-5 mt-0">
            <TabSectionHeader title="CFR Classification & Narrative" description="Category, complexity, strategic priority, and supporting narrative." />

            {isCustomSource && (
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status & Summary</p>
                <div className="grid grid-cols-3 gap-4">
                  <FormRow label="Project Status">
                    <FormSelect value={projectStatus} onChange={setProjectStatus} options={[...PROJECT_STATUS_OPTIONS]} placeholder="Not set" />
                  </FormRow>
                </div>
                <FormRow label="Executive Summary">
                  <Textarea value={executiveSummary} onChange={(e) => setExecutiveSummary(e.target.value)} rows={4}
                    placeholder="High-level summary for executive reporting…" />
                </FormRow>
              </div>
            )}

            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">CFR Classification</p>
              <div className="grid grid-cols-3 gap-4">
                <FormRow label="Category">
                  <FormSelect value={cfrCategory} onChange={setCfrCategory} options={CFR_CAT_OPTIONS} />
                </FormRow>
                <FormRow label="Complexity">
                  <FormSelect value={complexity} onChange={setComplexity} options={COMPLEXITY_OPTIONS} />
                </FormRow>
                <FormRow label="Strategic Priority">
                  <FormSelect value={strategicPriority} onChange={setStrategicPriority} options={STRATEGIC_PRI_OPTIONS} />
                </FormRow>
              </div>
              <FormRow label="Affected Systems">
                <MultiSelectCheckList
                  value={affectedSystems}
                  onChange={setAffectedSystems}
                  options={AFFECTED_SYSTEM_SELECT_OPTIONS}
                  placeholder="Search systems..."
                />
              </FormRow>
            </div>

            <div className="space-y-4 border-t border-border/60 pt-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Narrative</p>
              <FormRow label="Business Case">
                <Textarea value={businessCase} onChange={(e) => setBusinessCase(e.target.value)} rows={5}
                  placeholder="What is the business justification for this project?" />
              </FormRow>
              <FormRow label="Value Statement">
                <Textarea value={valueStatement} onChange={(e) => setValueStatement(e.target.value)} rows={3}
                  placeholder="What value will this project deliver?" />
              </FormRow>
              <FormRow label="Comments">
                <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2}
                  placeholder="Additional notes or manager comments..." />
              </FormRow>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 border-t border-border/60 pt-4">
          {(error || saveError) && (
            <p className="text-sm text-destructive mr-auto max-w-md truncate" title={error?.message ?? saveError ?? ''}>
              Save failed: {error?.message ?? saveError}
            </p>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving || isPending}>Cancel</Button>
          <Button disabled={!name.trim() || !startDate || saving || isPending} onClick={handleSave}>
            {saving || isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline forms for Gate, Decision, Closeout ──────────────────────────────




// ─── Main page ────────────────────────────────────────────────────────────────

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // When the user clicked into this project from a program detail page, the
  // program passed { from: 'program', programId } in router state. Honor that
  // by sending Back to /programs/<id> instead of the projects list. Intake-queue
  // notifications pass { from: 'intake' } so Back returns to the queue.
  // Capture the navigation origin ONCE on mount. Opening/closing the task panel
  // mutates the URL search params (setSearchParams), landing on a history entry
  // without the original router state — so reading location.state later returns
  // null and Back would fall through to /projects. Freezing it keeps Back
  // correct (e.g. return to /intake) for the whole visit.
  const backState = useState(() => location.state as { from?: string; programId?: string } | null)[0];
  const backTarget = backState?.from === 'intake'
    ? '/intake'
    : backState?.from === 'program' && backState.programId
    ? `/programs/${backState.programId}`
    : '/projects';
  const pmoTeamField = usePmoTeamField();
  const adminRole = useEffectiveAdminRole();
  const permission = useCanEditProject(id);
  const canEdit = permission.canEdit;
  const rosterPermission = useCanEditProjectRoster(id);
  // Option-C: on the custom task source, assignments store the assignee by
  // systemuserid (pmo_taskassignment.pmo_user), so handleAssign can bypass the
  // P4W bookable-resource requirement entirely.
  const taskSource = useTaskSource();
  const customTaskSource = taskSource !== 'pss';
  const canManageRoster = rosterPermission.canEdit;

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSummary, setDeleteSummary] = useState<DeleteChildSummary[] | undefined>(undefined);
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false);

  const { data: project, isLoading, error } = useProject(id);
  const { data: orgTeams = [] }             = useProjectTeams(id);
  const { data: members = [] }              = useProjectTeamMembers(id);
  const { data: buckets = [] }              = useProjectBuckets(id);
  const { data: tasks = [] }                = useProjectTasks(id);
  const { data: statusReports = [] }        = useStatusReports(id);
  const { data: risks = [] }                = useProjectRisks(id);
  const { data: issues = [] }               = useProjectIssues(id);
  const { data: changes = [] }              = useProjectChanges(id);

  // Team management — dialogs moved to CollaborateWorkspace

  const addMutation    = useAddProjectTeam(id!);
  const removeMutation = useRemoveProjectTeam(id!);
  const collaborationMode = useCollaborationMode();
  const { data: collaborators = [] } = useProjectCollaborators(id);
  const addCollabMutation    = useAddProjectCollaborators(id!);
  const removeCollabMutation = useRemoveProjectCollaborator(id!);


  // Resource management — dialogs moved to PlanWorkspace
  const { data: bookableResources = [] } = useBookableResources();
  const addMemberMutation    = useAddProjectTeamMember(id!);
  const removeMemberMutation = useRemoveProjectTeamMember(id!);

  // Project-scoped users (primary + contributing team members). Drives the
  // task assignee picker, the risk/issue/change Assigned To picker, and any
  // other project-side person picker. PM and Executive Sponsor remain
  // org-wide and use useUserSearch instead.
  // Lazy-create msdyn_projectteam rows on first task assignment for users
  // who aren't yet on the project resource roster.
  const {
    users: scopedUsers,
    options: scopedAssigneeOptions,
    resolveUserLabel: scopedAssigneeResolveLabel,
  } = useProjectScopedUsers(id);

  // Resource assignment (task-level)
  const { data: assignments = [] } = useResourceAssignments(id);
  const assignMutation   = useAssignResource(id!);
  const unassignMutation = useUnassignResource(id!);


  // Risk CRUD state
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<ProjectRisk | null>(null);
  const [deleteRiskTarget, setDeleteRiskTarget] = useState<ProjectRisk | null>(null);
  const createRiskMutation = useCreateProjectRisk(id!);
  const updateRiskMutation = useUpdateProjectRisk(id!);
  const deleteRiskMutation = useDeleteProjectRisk(id!);

  // Issue CRUD state
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<ProjectIssue | null>(null);
  const [deleteIssueTarget, setDeleteIssueTarget] = useState<ProjectIssue | null>(null);
  const createIssueMutation = useCreateProjectIssue(id!);
  const updateIssueMutation = useUpdateProjectIssue(id!);
  const deleteIssueMutation = useDeleteProjectIssue(id!);

  // Change CRUD state
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [editingChange, setEditingChange] = useState<ProjectChange | null>(null);
  const [deleteChangeTarget, setDeleteChangeTarget] = useState<ProjectChange | null>(null);
  const createChangeMutation = useCreateProjectChange(id!);
  const updateChangeMutation = useUpdateProjectChange(id!);
  const deleteChangeMutation = useDeleteProjectChange(id!);

  // Status report CRUD state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<StatusReport | null>(null);
  const [deleteStatusTarget, setDeleteStatusTarget] = useState<StatusReport | null>(null);
  // Resolved Dataverse systemuserid for the current user. Used to stamp
  // proj_Submitter on new status reports. dv.getCurrentUserId() only works
  // in model-driven hosts (window.Xrm) and returns 'anonymous' in Power Apps
  // Code Apps -- which then produced /systemusers(anonymous) in the payload
  // and Dataverse 0x80060888 "Bad Request - Error in query syntax". Chandra
  // Sicairos-Brown hit this on 2026-07-17 (see AppError telemetry rows).
  const currentUserId = useCurrentUserId();
  const createStatusMutation = useCreateStatusReport(id!);
  const updateStatusMutation = useUpdateStatusReport(id!);
  const deleteStatusMutation = useDeleteStatusReport(id!);

  // Only a PMO/system admin OR the report's creator may edit/delete a status
  // report. Falls back to hiding the affordances when identity is unresolved
  // (safer than showing them and 403-ing on click).
  const isStatusAdmin = adminRole === 'pmo_admin' || adminRole === 'system_admin';

  // Standard monthly capacity hours for PlanWorkspace New Resource Model section.
  const standardCapacityHours = useStandardCapacityHours();

  const canModifyStatusReport = (sr: StatusReport): boolean => {
    if (isStatusAdmin) return true;
    if (!currentUserId) return false;
    return (sr['_createdby_value'] ?? '').toLowerCase() === currentUserId.toLowerCase();
  };

  // Resolve lookup display names — the Power Apps SDK does not return @OData.Community.Display.V1.FormattedValue
  const primaryTeamGuid = project?.['_pmo_primaryteam_value'] as string | undefined;
  const pmGuid          = project?.['_msdyn_projectmanager_value'] as string | undefined;
  const sponsorGuid     = project?.['_proj_executivesponsor_value'] as string | undefined;
  const programGuid     = project?.['_msdyn_program_value'] as string | undefined;

  const { data: primaryTeamName } = useQuery({
    queryKey: ['team', 'name', primaryTeamGuid],
    queryFn: () => dv.get<{ name: string }>(ENTITY_SETS.team, primaryTeamGuid!, ['name']),
    enabled: !!primaryTeamGuid,
    staleTime: 10 * 60 * 1000,
    select: (d) => d.name,
  });
  const { data: pmName } = useQuery({
    queryKey: ['systemUser', 'name', pmGuid],
    queryFn: () => dv.get<{ fullname: string }>('systemusers', pmGuid!, ['fullname']),
    enabled: !!pmGuid,
    staleTime: 10 * 60 * 1000,
    select: (d) => d.fullname,
  });
  const { data: sponsorName } = useQuery({
    queryKey: ['systemUser', 'name', sponsorGuid],
    queryFn: () => dv.get<{ fullname: string }>('systemusers', sponsorGuid!, ['fullname']),
    enabled: !!sponsorGuid,
    staleTime: 10 * 60 * 1000,
    select: (d) => d.fullname,
  });
  // Strategic Account Executive (Payer Initiatives team feature). Prefer the
  // direct-AAD snapshot; fall back to the legacy systemuser lookup for
  // pre-transition projects. See
  // docs/planning/sae-systemuser-to-aad-transition-plan.md.
  const saeSnapshot = project ? resolveSaeDisplay(project) : '';
  const saeGuid = project?.['_pmo_payerinitiatives_strategicaccountexecutive_value'] as string | undefined;
  const { data: saeLookupName } = useQuery({
    queryKey: ['systemUser', 'name', saeGuid],
    queryFn: () => dv.get<{ fullname: string }>('systemusers', saeGuid!, ['fullname']),
    enabled: !saeSnapshot && !!saeGuid,
    staleTime: 10 * 60 * 1000,
    select: (d) => d.fullname,
  });
  const saeName = saeSnapshot || saeLookupName;
  // Whether this project is owned by Payer Initiatives — gates HPI / Payer
  // Issues tabs and the SAE row in Key People. Case-insensitive compare
  // because Dataverse hands back mixed-case GUIDs across SDK boundaries.
  // Match by GUID OR team NAME. The PI team GUID differs across DEV/PROD
  // (custom-Owner team vs AAD team), so a GUID-only check hid the HPI /
  // Payer-Issues tabs where the project's PI team has a different id.
  // Name fallback mirrors the payer-initiatives API layer.
  const isPayerInitiativesPrimary =
    (primaryTeamGuid ?? '').toLowerCase() === PAYER_INITIATIVES_TEAM_ID.toLowerCase() ||
    (!!primaryTeamName && PAYER_INITIATIVES_TEAM_NAMES.some(
      (n) => n.toLowerCase() === primaryTeamName.toLowerCase()));

  const isBiCodingPrimary =
    (primaryTeamGuid ?? '').toLowerCase() === BI_CODING_TEAM_ID.toLowerCase();
  const { data: programName } = useQuery({
    queryKey: ['program', 'name', programGuid],
    queryFn: () => dv.get<{ msdyn_name: string }>(ENTITY_SETS.program, programGuid!, ['msdyn_name']),
    enabled: !!programGuid,
    staleTime: 10 * 60 * 1000,
    select: (d) => d.msdyn_name,
  });

  // Project edit state
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  // Which tab the ProjectEditDialog should open on. Set by the caller
  // before flipping editProjectOpen to true, so clicking Edit on Key People
  // lands on Governance, clicking Edit on Financials lands on Financials,
  // etc. Reset back to 'details' when the dialog closes.
  const [editProjectInitialTab, setEditProjectInitialTab] = useState<string>('details');

  // Primary-team change confirmation state (2026-07-22). When the operator
  // saves a Primary Team change, we defer onSave, open a confirmation modal
  // explaining the cascade, and only run the actual project mutation +
  // applyPrimaryTeamChange once the operator confirms. See plan.md.
  interface PendingPrimaryTeamSave {
    payload: ProjectUpdate;
    scheduleUpdate?: { scheduledStart?: string };
    oldTeamId: string | null;
    newTeamId: string | null;
    resolve: () => void;
    reject: (err: unknown) => void;
  }
  const [pendingPrimaryTeamSave, setPendingPrimaryTeamSave] = useState<PendingPrimaryTeamSave | null>(null);
  const [primaryTeamCascadeRunning, setPrimaryTeamCascadeRunning] = useState(false);
  const primaryTeamOldNameQuery = useQuery({
    queryKey: ['team', 'name', pendingPrimaryTeamSave?.oldTeamId ?? ''],
    queryFn: () => dv.get<{ name: string }>(ENTITY_SETS.team, pendingPrimaryTeamSave!.oldTeamId!, ['name']),
    enabled: !!pendingPrimaryTeamSave?.oldTeamId,
  });
  const primaryTeamNewNameQuery = useQuery({
    queryKey: ['team', 'name', pendingPrimaryTeamSave?.newTeamId ?? ''],
    queryFn: () => dv.get<{ name: string }>(ENTITY_SETS.team, pendingPrimaryTeamSave!.newTeamId!, ['name']),
    enabled: !!pendingPrimaryTeamSave?.newTeamId,
  });
  const openEditProject = useCallback((tab: string = 'details') => {
    setEditProjectInitialTab(tab);
    setEditProjectOpen(true);
  }, []);
  const updateProjectMutation = useUpdateProject(id!);
  const auditChange = useChangeAudit();
  // Custom-source projects are shell-less (no msdyn_project row), so the start
  // date must be PATCHed onto pmo_project directly instead of routed through PSS.
  const isCustomSource = usesCustomTables(useDataSource());

  // Task scheduling mutations (Phase 1)
  const createTaskMutation = useCreateProjectTask(id!);
  const updateTaskMutation = useUpdateProjectTask(id!);
  const deleteTaskMutation = useDeleteProjectTask(id!);
  const { data: dependencies = [] } = useProjectTaskDependencies(id);
  // Dependency mutations (Phase 0.2b). Only wired into the UI on the custom
  // source (see customTaskSource guard on the TaskWorkspace props). Cheap to
  // instantiate on both sources; the hooks themselves branch internally.
  const createDependencyMutation = useCreateProjectTaskDependency(id!);
  const deleteDependencyMutation = useDeleteProjectTaskDependency(id!);
  const queryClient = useQueryClient();

  // Stuck-row auto-sweep (2026-07-22). Tracey's completions on PROD sat
  // Pending, attempts=0 because the browser's initial invokeFlushTaskStaging
  // call was interrupted (network blip / sandbox timeout) and the retry loop
  // gave up. Loading a project OR bringing the tab back to visible fires a
  // whole-project drain -- StagingDrain.Run early-returns cheaply if nothing
  // is Pending, so this is safe to fire liberally. On both events we also
  // invalidate the tasks query so any rows drained by the sweep re-render
  // (clears "stuck spinning" tiles the moment the user re-focuses the tab).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const sweep = async () => {
      try {
        await invokeFlushTaskStaging({ projectId: id });
        if (cancelled) return;
        queryClient.invalidateQueries({ queryKey: ['projectTasks', id] });
        // Also nudge the staging overlay in case a stuck row's status flipped.
        queryClient.invalidateQueries({ queryKey: ['stagingOverlay', id] });
      } catch {
        // Best-effort. If flush fails (permission, sandbox timeout, plugin
        // outage), silently skip -- writes still succeed via their own
        // dedicated retry loops. Users see errors through their own actions,
        // not this background sweep.
      }
    };
    // Fire once on mount.
    void sweep();
    // Refire when the tab becomes visible again.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sweep();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id, queryClient]);

  async function handleOpenDeleteDialog() {
    if (!id) return;
    setDeleteSummary(undefined);
    setDeleteSummaryLoading(true);
    setDeleteDialogOpen(true);
    try {
      const s = await summarizeProjectDelete(id);
      setDeleteSummary(s);
    } finally {
      setDeleteSummaryLoading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!id) return;
    const projectName = project?.msdyn_subject ?? 'Project';
    // Fire-and-forget: close the dialog, mark the row as deleting in the
    // shared store so the project list can render a spinner + greyed
    // overlay, then bounce the user to /projects immediately. The cascade
    // runs in the background; on resolve we invalidate the lists and
    // clear the deleting flag. On failure we surface a toast and clear
    // the flag so the row goes back to a normal interactive state.
    setDeleteDialogOpen(false);
    markDeleting(id);
    navigate('/projects');
    cascadeDeleteProject(id)
      .then(async () => {
        // No parentProjectId/Name here on purpose. The project we'd bind
        // to was just deleted; including pmo_Project@odata.bind would
        // cause Dataverse to reject the audit-row write for a dangling
        // lookup, and useChangeAudit would silently swallow the error.
        // The deleted GUID is still preserved as entityId for traceability.
        auditChange({
          entityType: 'project',
          entityId: id,
          entityName: projectName,
          action: 'delete',
        });
        toast.success(`${projectName} deleted`);
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        // Cascade also removes the originating intake request; refresh
        // the intake queue + pending-approval lists.
        await queryClient.invalidateQueries({ queryKey: ['projectRequests'] });
        await queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        toast.error(`Failed to delete ${projectName}: ${msg}`);
        // Best-effort refresh so a partial cascade is visible in the list.
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      })
      .finally(() => {
        unmarkDeleting(id);
      });
  }

  async function handleCreateTask(params: ScheduleTaskCreate): Promise<{ taskId?: string }> {
    const created = await createTaskMutation.mutateAsync(params);
    // Wave 1 audit — task create. useCreateProjectTask now returns
    // { taskId } (staging path) so we can pass it back to CreateTaskDialog
    // for the extras spinner anchor; use it here for the audit id too.
    const newId = created?.taskId;
    auditChange({
      entityType: 'task',
      entityId: newId ?? 'pending-' + Date.now(),
      entityName: params.subject,
      action: 'create',
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
    return { taskId: newId };
  }

  /**
   * Apply New Task dialog extras (dates / priority / assignees) once the
   * real task id surfaces. PSS rejects dates+priority on create and assignees
   * are a separate junction, so we have to wait for the post-PSS_DELAY
   * refetch to know the new id, then chain update + assign calls.
   *
   * Strategy: poll the projectTasks query for a task matching subject +
   * bucketId that ISN’T optimistic, with the highest createdon.
   * Bail out after a generous timeout so a stuck create doesn't strand
   * an open promise.
   */
  async function handleAfterCreateTask(params: ScheduleTaskCreate, extras: CreateTaskExtras, preAssignedTaskId?: string) {
    if (!id) return;

    // Staging path: the mutation already gave us the client-generated future
    // msdyn_projecttaskid AND already called markPendingExtras(taskId), so
    // TaskRow.isSaving has been true continuously since the moment the user
    // clicked Create. We only need to run the extras attempts (each of which
    // has its own try/catch so a single failure never aborts downstream
    // attempts) and finally clear the flag when all attempts have resolved.
    if (preAssignedTaskId) {
      const targetId = preAssignedTaskId;
      try {
        if (extras.priority !== undefined) {
          try { await handleUpdateTaskFull({ taskId: targetId, priority: extras.priority }); }
          catch (err) {
            // Silent log-only. The underlying pmo_taskstaging row is now
            // Failed and StagingFailureWatcher already surfaces a friendly
            // toast ("Couldn't apply Priority to task X"). A second toast
            // here just doubles up noise for the operator.
            logAppError({
              message: "Couldn't apply priority on task create",
              rawError: err instanceof Error ? err.message : String(err),
              action: 'task create extras: priority',
              entityType: 'task',
              entityId: targetId,
              parentProjectId: id,
            });
          }
        }
        if (extras.scheduledStart || extras.scheduledEnd) {
          // Single attempt. Under the staging plugin the follow-up sets
          // msdyn_ismanuallyscheduled=true alongside the schedule fields, so
          // PSS accepts scheduledStart writes on the first try. Any failure
          // now is a genuine data-quality problem (e.g. invalid dependency
          // constraint) rather than a materialisation race, so retrying with
          // the same payload would just produce identical failures + duplicate
          // toasts. Silent-log on failure; StagingFailureWatcher owns the
          // friendly operator-facing toast for the single Failed row.
          try {
            await handleUpdateTaskFull({
              taskId: targetId,
              scheduledStart: extras.scheduledStart,
              scheduledEnd: extras.scheduledEnd,
            });
          } catch (err) {
            logAppError({
              message: "Couldn't apply dates on task create",
              rawError: err instanceof Error ? err.message : String(err),
              action: 'task create extras: dates',
              entityType: 'task',
              entityId: targetId,
              parentProjectId: id,
            });
          }
        }
        for (const assigneeId of extras.assigneeIds) {
          try { await handleAssign(targetId, assigneeId); }
          catch (err) {
            logAppError({
              message: "Couldn't apply assignee on task create",
              rawError: err instanceof Error ? err.message : String(err),
              action: 'task create extras: assignee',
              entityType: 'task',
              entityId: targetId,
              parentProjectId: id,
            });
          }
        }
      } finally {
        markExtrasDone(targetId);
        queryClient.invalidateQueries({ queryKey: ['projectTasks', id] });
      }
      return;
    }

    // Legacy non-staging path: poll for the created task, then mark pending
    // + apply extras. Same structure as before.
    const deadline = Date.now() + PSS_DELAY.TASK_CREATE + 30_000;
    const matchSubject = params.subject.trim().toLowerCase();
    let newTaskId: string | undefined;
    while (Date.now() < deadline) {
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: ['projectTasks', id],
          queryFn: () => listProjectTasks(id),
        });
        const candidates = fresh.filter((task) =>
          !task.msdyn_projecttaskid.startsWith('optimistic-') &&
          (task.msdyn_subject ?? '').trim().toLowerCase() === matchSubject &&
          (params.bucketId ? task['_msdyn_projectbucket_value'] === params.bucketId : true) &&
          (params.parentTaskId ? task['_msdyn_parenttask_value'] === params.parentTaskId : true),
        );
        if (candidates.length > 0) {
          // Pick the most recently created match in case there are duplicates.
          candidates.sort((a, b) => {
            const at = a.createdon ? new Date(a.createdon).getTime() : 0;
            const bt = b.createdon ? new Date(b.createdon).getTime() : 0;
            return bt - at;
          });
          newTaskId = candidates[0].msdyn_projecttaskid;
          break;
        }
      } catch {
        // transient - keep polling until the deadline
      }
      await new Promise((r) => setTimeout(r, 2_500));
    }

    if (!newTaskId) {
      toast.error("Couldn't find the new task to apply dates / priority / assignees. Open the task and set them manually.");
      return;
    }

    // Keep the card visibly saving until every follow-up (priority,
    // dates, assignees) has been attempted. Cleared in finally so a
    // throw from any single step still releases the spinner.
    markPendingExtras(newTaskId);
    try {

    // 1a. Priority — try independently of dates. PSS accepts msdyn_priority
    // updates immediately after create; isolating priority means a date-
    // related E_NOTEDITABLE doesn't lose the priority setting.
    // Runs on both staging and legacy paths: under staging the update
    // becomes its own staging row -> a fresh OperationSet in the next
    // drain, which is the pattern PSS allows for dates/priority writes.
    if (extras.priority !== undefined) {
      try {
        await handleUpdateTaskFull({ taskId: newTaskId, priority: extras.priority });
      } catch (err) {
        toast.error(`Couldn't apply priority: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // 1b. Dates — separate try so a date failure doesn't block downstream
    // assignee creation. PSS sometimes returns E_NOTEDITABLE on
    // msdyn_scheduledstart immediately after PssCreateV1 if the engine
    // hasn't finished scheduling the new task yet; soft-fail with a
    // friendly message instead of leaving the user staring at a raw
    // PSS error blob.
    if (extras.scheduledStart || extras.scheduledEnd) {
      try {
        await handleUpdateTaskFull({
          taskId: newTaskId,
          scheduledStart: extras.scheduledStart,
          scheduledEnd: extras.scheduledEnd,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('NOTEDITABLE') || msg.includes('readonly')) {
          toast.error("Task created, but the scheduling engine isn't ready for dates yet. Open the task and set them manually in a moment.");
        } else {
          toast.error(`Couldn't apply dates: ${msg}`);
        }
      }
    }

      // 2. Assignees - serialize to keep PSS opSet quota under control.
      for (const assigneeId of extras.assigneeIds) {
        try {
          await handleAssign(newTaskId, assigneeId);
        } catch (err) {
          toast.error(`Couldn't assign resource: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      markExtrasDone(newTaskId);
      // Force the tasks query to re-read so any newly-applied dates /
      // priority land in the visible card immediately.
      queryClient.invalidateQueries({ queryKey: ['projectTasks', id] });
    }
  }

  async function handleUpdateTask(
    taskId: string,
    subject?: string,
    progress?: number,
    scheduledStart?: string,
    scheduledEnd?: string,
    isMilestone?: boolean,
    effortCompleted?: number,
  ) {
    await updateTaskMutation.mutateAsync({ taskId, subject, progress, scheduledStart, scheduledEnd, isMilestone, effortCompleted });
  }

  // Translate a ScheduleTaskUpdate (domain keys) into a Dataverse-key after
  // record so diffEntityUpdate can compare it to the server task. Shared
  // between the auto-audit path (drag-drop, programmatic updates) and the
  // panel's batched audit emitter.
  function buildTaskFieldChanges(
    taskId: string,
    params: Parameters<typeof updateTaskMutation.mutateAsync>[0],
  ): ChangeAuditFieldDiff[] {
    const before = tasks.find((t) => t.msdyn_projecttaskid === taskId);
    if (!before) return [];
    const after: Record<string, unknown> = {};
    if (params.subject !== undefined)         after.msdyn_subject = params.subject;
    if (params.description !== undefined)     after.msdyn_description = params.description;
    if (params.scheduledStart !== undefined)  after.msdyn_scheduledstart = params.scheduledStart;
    if (params.scheduledEnd !== undefined)    after.msdyn_scheduledend = params.scheduledEnd;
    if (params.duration !== undefined)        after.msdyn_duration = params.duration;
    if (params.effort !== undefined)          after.msdyn_effort = params.effort;
    if (params.effortCompleted !== undefined) after.msdyn_effortcompleted = params.effortCompleted;
    if (params.priority !== undefined)        after.msdyn_priority = params.priority;
    if (params.isMilestone !== undefined)     after.msdyn_ismilestone = params.isMilestone;
    if (params.bucketId !== undefined)        after.msdyn_projectbucket = params.bucketId;
    return diffEntityUpdate(before as unknown as Record<string, unknown>, after, TASK_FIELD_LABELS);
  }

  // Auto-audit path — used by drag-drop bucket move and any other
  // programmatic mutator that doesn't call auditChange itself. The panel
  // uses handleUpdateTaskFullNoAudit + emits its own batched row instead.
  async function handleUpdateTaskFull(params: Parameters<typeof updateTaskMutation.mutateAsync>[0]) {
    const before = tasks.find((t) => t.msdyn_projecttaskid === params.taskId);
    const changes = buildTaskFieldChanges(params.taskId, params);
    await updateTaskMutation.mutateAsync(params);
    if (!before || changes.length === 0) return;
    auditChange({
      entityType: 'task',
      entityId: params.taskId,
      entityName: before.msdyn_subject,
      action: 'update',
      changes,
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  // Panel's mutator — same shape as handleUpdateTaskFull but skips the
  // auto-audit. The panel emits ONE batched audit row at the end of its
  // Submit covering field changes + label/assignee/checklist drafts.
  async function handleUpdateTaskFullNoAudit(params: Parameters<typeof updateTaskMutation.mutateAsync>[0]) {
    await updateTaskMutation.mutateAsync(params);
  }

  async function handleDeleteTask(taskId: string, _hasChildren: boolean) {
    const before = tasks.find((t) => t.msdyn_projecttaskid === taskId);
    try {
      await deleteTaskMutation.mutateAsync(taskId);
    } catch (err) {
      // Silent log-only. StagingFailureWatcher already surfaces the friendly
      // "Couldn't delete task X" toast for the operator; TaskRow's own catch
      // would otherwise fire a second red banner with the raw PSS blob
      // (e.g. "ScheduleAPI-OV-0001: The referenced project with id
      // 00000000... does not match the project id ... of the operation set").
      // Swallow here so it never bubbles up to TaskRow -> onError ->
      // TaskWorkspace.handleError -> banner. The raw blob still lands in
      // Admin > Error Log via logAppError.
      logAppError({
        message: "Couldn't delete task",
        rawError: err instanceof Error ? err.message : String(err),
        action: 'task delete',
        entityType: 'task',
        entityId: taskId,
        parentProjectId: id,
      });
      return;
    }
    auditChange({
      entityType: 'task',
      entityId: taskId,
      entityName: before?.msdyn_subject ?? '(deleted task)',
      action: 'delete',
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  async function handleCreateDependency(successorTaskId: string, predecessorTaskId: string, linkType?: number) {
    await createDependencyMutation.mutateAsync({ successorTaskId, predecessorTaskId, linkType });
    const succName = tasks.find((t) => t.msdyn_projecttaskid === successorTaskId)?.msdyn_subject ?? 'Task';
    const predName = tasks.find((t) => t.msdyn_projecttaskid === predecessorTaskId)?.msdyn_subject ?? 'Task';
    auditChange({
      entityType: 'task',
      entityId: successorTaskId,
      entityName: succName,
      action: 'update',
      changes: [{ kind: 'relationship', relation: 'dependency', action: 'add', label: `depends on ${predName}` }],
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  async function handleDeleteDependency(dependencyId: string) {
    const dep = dependencies.find((d) => d.msdyn_projecttaskdependencyid === dependencyId);
    const succId = dep?.['_msdyn_successortask_value'];
    const predId = dep?.['_msdyn_predecessortask_value'];
    const succName = succId ? tasks.find((t) => t.msdyn_projecttaskid === succId)?.msdyn_subject ?? 'Task' : 'Task';
    const predName = predId ? tasks.find((t) => t.msdyn_projecttaskid === predId)?.msdyn_subject ?? 'Task' : 'Task';
    await deleteDependencyMutation.mutateAsync(dependencyId);
    if (!succId) return;
    auditChange({
      entityType: 'task',
      entityId: succId,
      entityName: succName,
      action: 'update',
      changes: [{ kind: 'relationship', relation: 'dependency', action: 'remove', label: `no longer depends on ${predName}` }],
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  function handleTasksInvalidate() {
    queryClient.invalidateQueries({ queryKey: ['projectTasks', id] });
  }

  async function handleAssign(taskId: string, pickerId: string, initialHours?: number) {
    const memberName = taskTeamMembers.find((m) => m.id === pickerId)?.name ?? 'Resource';
    const taskSubject = tasks.find((t) => t.msdyn_projecttaskid === taskId)?.msdyn_subject ?? 'Task';

    // ── Option-C custom path ────────────────────────────────────────────────
    // Assignments are keyed by systemuserid (pmo_taskassignment.pmo_user), the
    // same identity the edit-access model + assignee picker use. No bookable
    // resource required, so ANY project-scoped user (admins / PMs / sponsors /
    // team members) can be assigned. We still pass the projectteam row id when
    // one happens to exist, so the reverse-ETL can mirror to P4W for
    // provisioned users; when it doesn't, the assignment stays app-only.
    if (customTaskSource) {
      // Resolve pickerId to a systemuserid. taskTeamMembers keys existing
      // BR-backed members by systemuserid already; a member row without a BR
      // is keyed by projectteamid, so map that back to a systemuserid via the
      // BR chain when possible. Scoped-user picks are already systemuserids.
      let userId: string | undefined = pickerId;
      let projectTeamId: string | undefined;
      const memberByTeamId = members.find((m) => m.msdyn_projectteamid === pickerId);
      if (memberByTeamId) {
        // pickerId was a projectteamid — recover the systemuserid via BR.
        projectTeamId = memberByTeamId.msdyn_projectteamid;
        const br = bookableResources.find(
          (r) => r.bookableresourceid === memberByTeamId['_msdyn_bookableresourceid_value'],
        );
        userId = br?.['_userid_value'] ?? undefined;
      } else {
        // pickerId is a systemuserid. Find an existing projectteam row for this
        // user (via BR) so P4W stays in sync; absence is fine (app-only).
        const br = bookableResources.find((r) => r['_userid_value'] === pickerId);
        const existingForResource = br
          ? members.find((m) => m['_msdyn_bookableresourceid_value'] === br.bookableresourceid)
          : undefined;
        projectTeamId = existingForResource?.msdyn_projectteamid;
      }
      if (!userId) {
        toast.error(`Couldn't resolve ${memberName} to a user account.`);
        return;
      }
      await assignMutation.mutateAsync({ taskId, userId, teamMemberId: projectTeamId ?? null, name: `${memberName} : ${taskSubject}`, projectName: project?.msdyn_subject, initialHours });
      auditChange({
        entityType: 'task',
        entityId: taskId,
        entityName: taskSubject,
        action: 'update',
        changes: [{ kind: 'relationship', relation: 'assignee', action: 'add', label: memberName }],
        parentProjectId: id!,
        parentProjectName: project?.msdyn_subject,
      });
      return;
    }

    // ── PSS path (bookable-resource required) ────────────────────────────────
    // The picker's id is either a msdyn_projectteamid (the person is already a
    // project resource) or a systemuserid (they're on a project team but not
    // yet on this project's roster - lazy-create the projectteam row).
    let projectTeamId: string | undefined;
    const existingMember = members.find((m) => m.msdyn_projectteamid === pickerId);
    if (existingMember) {
      projectTeamId = pickerId;
    } else {
      // Treat pickerId as a systemuserid. Resolve to bookableresource → existing
      // projectteam row → assign. If the projectteam row doesn't exist, create it.
      const br = bookableResources.find((r) => r['_userid_value'] === pickerId);
      if (!br) {
        toast.error(`${memberName} doesn't have a bookable resource and can't be assigned to tasks. Ask an admin to provision their P4W resource record.`);
        return;
      }
      const existingForResource = members.find(
        (m) => m['_msdyn_bookableresourceid_value'] === br.bookableresourceid,
      );
      if (existingForResource) {
        projectTeamId = existingForResource.msdyn_projectteamid;
      } else {
        // Lazy-create. Refresh the members list afterward so we can read the
        // new row's id; the scheduling action returns void.
        try {
          // Fix 2026-07-20: swallow "duplicate resource" — treat as success
          // and let the refetch below find the pre-existing row.
          try {
            await addMemberMutation.mutateAsync(br.bookableresourceid);
          } catch (addErr) {
            const addMsg = addErr instanceof Error ? addErr.message : String(addErr);
            if (!/duplicate resource|already a member/i.test(addMsg)) throw addErr;
          }
          // Force the cache refresh and refetch synchronously so we can find
          // the freshly-created row before issuing the assignment.
          await queryClient.invalidateQueries({ queryKey: ['projectTeamMembers', id] });
          const refreshed = await queryClient.fetchQuery({
            queryKey: ['projectTeamMembers', id],
            queryFn: () => listProjectTeamMembers(id!),
          });
          const newRow = refreshed.find(
            (m) => m['_msdyn_bookableresourceid_value'] === br.bookableresourceid,
          );
          projectTeamId = newRow?.msdyn_projectteamid;
        } catch (err) {
          toast.error(`Couldn't add ${memberName} to the project team: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      if (!projectTeamId) {
        toast.error(`Couldn't resolve ${memberName} to a project team row.`);
        return;
      }
    }

    await assignMutation.mutateAsync({ taskId, teamMemberId: projectTeamId, name: `${memberName} : ${taskSubject}` });
    auditChange({
      entityType: 'task',
      entityId: taskId,
      entityName: taskSubject,
      action: 'update',
      changes: [{ kind: 'relationship', relation: 'assignee', action: 'add', label: memberName }],
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  async function handleUnassign(_taskId: string, assignmentId: string) {
    // Look up name + task name BEFORE the mutation invalidates the cache.
    const assignment = assignments.find((a) => a.msdyn_resourceassignmentid === assignmentId);
    const taskId = assignment?.['_msdyn_taskid_value'] ?? undefined;
    const taskName = taskId ? tasks.find((t) => t.msdyn_projecttaskid === taskId)?.msdyn_subject ?? 'Task' : 'Task';
    // msdyn_name on the junction is "<resource> : <task>" — strip the suffix.
    const fullName = assignment?.msdyn_name ?? '';
    const memberName = (fullName.split(' : ')[0] || fullName) || 'team member';
    await unassignMutation.mutateAsync(assignmentId);
    if (!taskId) return;
    auditChange({
      entityType: 'task',
      entityId: taskId,
      entityName: taskName,
      action: 'update',
      changes: [{ kind: 'relationship', relation: 'assignee', action: 'remove', label: memberName }],
      parentProjectId: id!,
      parentProjectName: project?.msdyn_subject,
    });
  }

  // Add/remove member handlers moved to PlanWorkspace

  // Active tab — synced to URL search params for in-session state persistence
  const [activeTab, setActiveTab] = useUrlState('tab', 'overview', PROJECT_TABS);

  // Feature toggles for the project detail tabs. Hidden tabs neither render their
  // trigger nor their content; cross-tab links from Overview are also gated below.
  const ftAll = useFeatureToggles();
  const uatTab = useUatProjectTabEnabled(id);
  const tabEnabled = {
    overview:    ftAll['projectTab.overview']    !== false,
    plan:        ftAll['projectTab.plan']        !== false,
    tasks:       ftAll['projectTab.tasks']       !== false,
    // Payer Initiatives team-feature tabs — only on projects whose
    // Primary Team is Payer Initiatives. No feature-toggle gate.
    hpi:         isPayerInitiativesPrimary,
    payerIssues: isPayerInitiativesPrimary,
    // BI Coding team-feature tab — only on projects whose Primary Team is BI.
    // Lazy-loaded; zero render cost for non-BI projects (tab never mounts).
    coding:      isBiCodingPrimary,
    monitor:     ftAll['projectTab.monitor']     !== false,
    govern:      ftAll['projectTab.govern']      !== false,
    collaborate: ftAll['projectTab.collaborate'] !== false,
    status:      ftAll['projectTab.status']      !== false,
    notes:       ftAll['projectTab.notes']       !== false,
    activity:    ftAll['projectTab.activity']    !== false,
    // UAT (spec 001). Resolved by useUatProjectTabEnabled rather than read from
    // ftAll, because it needs THREE steps -- organisation toggle, team override, then
    // the project's own pmo_uatenabled -- and because ftAll here is the RAW global,
    // which ignores team opt-outs. G-ENABLE was answered opt-out-BY-TEAM, so a team
    // override that never reached the tab would make the answer meaningless. The
    // other tabs' use of the raw global is pre-existing; see progress.md finding 40.
    uat:         uatTab.enabled,
  } as const;
  // Fall back active tab to the first enabled one if the URL/state points at a hidden tab.
  const visibleActiveTab = tabEnabled[activeTab as keyof typeof tabEnabled]
    ? activeTab
    : (Object.entries(tabEnabled).find(([, on]) => on)?.[0] ?? activeTab);

  // Refetch project data whenever the user (a) enters the project detail
  // page (mount) or (b) switches to a different tab. Prevents stale data
  // scenarios like: colleague A creates a task + note; colleague B, who was
  // on this project earlier and whose React Query cache is still "fresh"
  // under the 5-minute default staleTime, would otherwise not see the new
  // rows until they hard-refreshed the app. Uses a predicate that matches
  // any query whose key contains the project id, so every project-scoped
  // cache entry is invalidated in one pass without having to enumerate the
  // ~15 different query hooks the page (and its child workspaces) use.
  //
  // React Query only refetches queries with active observers, so this is
  // cheap for tabs that aren't mounted — those queries just get marked
  // stale and will refetch the next time they're read. The visible tab's
  // queries refetch immediately.
  useEffect(() => {
    if (!id) return;
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey.some((seg) => seg === id),
    });
  }, [id, visibleActiveTab, queryClient]);
  const [monitorSubTab] = useUrlState('subtab', 'risks', MONITOR_SUB_TABS);
  const [, setSearchParams] = useSearchParams();
  function navigateToMonitor(subTab: MonitorSubTab) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'monitor');
      next.set('subtab', subTab);
      return next;
    }, { replace: true });
  }
  // Task workspace state — lifted to URL for deep linking
  const [activeView, setActiveView] = useUrlState<TaskView>('view', 'board', TASK_VIEWS);
  const [urlTaskId, setUrlTaskId] = useUrlState<string>('task', '');
  const selectedTaskId = urlTaskId || null;
  const handleSelectTask = useCallback((taskId: string | null) => {
    setUrlTaskId(taskId ?? '', { replace: false });
  }, [setUrlTaskId]);

  const [alertsExpanded, setAlertsExpanded] = useState(false);

  // Hash-driven scroll-into-view (e.g. /projects/<id>?tab=status#sr-<reportId>
  // from the cross-project Status Reports list). React Router does not honour
  // location.hash on its own, so we resolve the element after the tab content
  // mounts and scroll there. statusReports.length is in the dep array so we
  // also trigger once data has loaded if that happens after the tab switch.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || activeTab !== 'status') return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-primary/40');
      const timer = window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary/40'), 2000);
      return () => window.clearTimeout(timer);
    }
  }, [activeTab, statusReports.length]);

  // Lifecycle workspace hooks (data for tab badges; full CRUD inside workspace components)
  const { data: decisions = [] } = useProjectDecisions(id);

  // Notes tab badge count = project notes + rolled-up task notes (both panes the
  // Notes tab renders). Data-source derivation mirrors NotesSection: custom source
  // binds notes to pmo_project/pmo_task, PSS to the msdyn shells. These are the SAME
  // React-Query keys the tab's two <NotesSection>s use, so the badge shares their
  // cache and adds no extra network calls.
  const notesDataSource = useDataSource();
  const notesProjectTypeCode = usesCustomTables(notesDataSource) ? 'pmo_project' as const : 'msdyn_project' as const;
  const notesTaskTypeCode = usesCustomTables(notesDataSource) ? 'pmo_task' as const : 'msdyn_projecttask' as const;
  const { data: projectNotesForCount = [] } = useProjectNotes(id, notesProjectTypeCode);
  const { data: taskNotesForCount = [] } = useTaskNotesRollup(
    id,
    tasks.map((t) => t.msdyn_projecttaskid),
    notesTaskTypeCode,
  );
  const notesCount = projectNotesForCount.length + taskNotesForCount.length;
  // Display cap: 100+ shows as "99+".
  const notesBadge = notesCount >= 100 ? '99+' : String(notesCount);

  const { data: allTeams = [] } = useQuery({
    queryKey: ['systemTeams', 'forAdd', pmoTeamField],
    queryFn: async () => {
      const all = await fetchPmoTeams<Record<string, unknown>>(pmoTeamField, ['teamid', 'name']);
      return all.map((t) => ({ teamid: t['teamid'] as string, name: t['name'] as string }));
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  const primaryTeam       = orgTeams.find((t) => t.pmo_role === TEAM_ROLE.Primary);
  const contributingTeams = orgTeams.filter((t) => t.pmo_role === TEAM_ROLE.Contributing);
  const assignedTeamIds   = new Set(orgTeams.map((t) => t['_pmo_team_value']));
  const availableTeams    = allTeams.filter((t) => !assignedTeamIds.has(t.teamid));

  const assignedResourceIds = new Set<string>(members.map((m) => m['_msdyn_bookableresourceid_value']).filter((v): v is string => !!v));
  // filteredResources moved to PlanWorkspace

  // ── Task-level team member list for assignment picker ─────────────────────────
  // Union of:
  //   1. Existing msdyn_projectteam rows (people already on this project) -
  //      keyed by their systemuserid where we can resolve it via the
  //      bookable-resource → systemuser lookup, else by msdyn_projectteamid.
  //   2. All scoped users (primary + contributing team members from the
  //      Collaborate tab) — keyed by systemuserid. Picking one of these
  //      lazily creates a msdyn_projectteam row at assign time.
  // De-dupe on id so the same person doesn't appear twice when they're
  // already a project resource AND a member of a contributing team.
  const taskTeamMembers = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    // 1. Existing project resources keyed by systemuserid when available.
    for (const m of members) {
      const brId = m['_msdyn_bookableresourceid_value'];
      const br = brId ? bookableResources.find((r) => r.bookableresourceid === brId) : undefined;
      const systemUserId = br?.['_userid_value'];
      const id = systemUserId ?? m.msdyn_projectteamid;
      const name = m['_msdyn_bookableresourceid_value@OData.Community.Display.V1.FormattedValue'] ?? m.msdyn_name ?? '?';
      if (!map.has(id)) map.set(id, { id, name });
    }
    // 2. Scoped users from primary + contributing teams.
    for (const u of scopedUsers) {
      if (!map.has(u.systemuserid)) {
        map.set(u.systemuserid, {
          id: u.systemuserid,
          name: u.lastname && u.firstname ? `${u.lastname}, ${u.firstname}` : u.fullname,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, bookableResources, scopedUsers]);

  // Pre-normalized TaskAssignee[] for all tasks in this project. Placed after
  // taskTeamMembers (declared above) to avoid accessing it before declaration.
  const taskAssigneesMapped = useMemo(() => assignments.map((a) => {
    if (customTaskSource && a.assigneeUserId) {
      return {
        assignmentId: a.msdyn_resourceassignmentid,
        taskId: a['_msdyn_taskid_value'] ?? '',
        teamMemberId: a.assigneeUserId,
        name: a.assigneeUserName
          ?? taskTeamMembers.find((m) => m.id === a.assigneeUserId)?.name
          ?? a.msdyn_name ?? '?',
        contributedHours: a.contributedHours,
      };
    }
    const tmId = a['_msdyn_projectteamid_value'] ?? '';
    const member = members.find((m) => m.msdyn_projectteamid === tmId);
    const personName = member
      ? (member['_msdyn_bookableresourceid_value@OData.Community.Display.V1.FormattedValue'] ?? member.msdyn_name ?? '?')
      : (a.msdyn_name ?? '?');
    return {
      assignmentId: a.msdyn_resourceassignmentid,
      taskId: a['_msdyn_taskid_value'] ?? '',
      teamMemberId: (bookableResources.find((r) => r.bookableresourceid === member?.['_msdyn_bookableresourceid_value'])?.['_userid_value']) ?? tmId,
      name: personName,
      contributedHours: a.contributedHours,
    };
  }), [assignments, customTaskSource, taskTeamMembers, members, bookableResources]);

  // ── Schedule quality metrics (derived from tasks already in state) ──────────
  const schedQuality = useMemo(() => {
    const now = new Date();
    const leaf = tasks.filter(
      (t) => !t.msdyn_summary && !t.msdyn_projecttaskid.startsWith('optimistic-') && (t.msdyn_outlinelevel ?? 1) > 0,
    );
    const withDates = leaf.filter(
      (t) => t.msdyn_scheduledstart && (t.msdyn_scheduledend ?? t.msdyn_finish),
    );
    const overdueList = leaf.filter((t) => {
      const p = t.msdyn_progress ?? 0;
      const pct = p > 0 && p <= 1 ? p * 100 : p;
      const done = t.statecode === 1 || pct >= 100;
      const due = t.msdyn_scheduledend ?? t.msdyn_finish;
      return !done && !!due && new Date(due) < now;
    });
    const milestoneCount = tasks.filter((t) => t.msdyn_ismilestone).length;
    const hasWBS = tasks.some((t) => t.msdyn_summary && (t.msdyn_outlinelevel ?? 0) > 0);
    const datePct = leaf.length > 0 ? (withDates.length / leaf.length) * 100 : null;

    let status: 'none' | 'healthy' | 'fair' | 'attention' = 'none';
    if (leaf.length > 0) {
      if ((datePct ?? 0) >= 80 && overdueList.length === 0) status = 'healthy';
      else if ((datePct ?? 0) >= 50) status = 'fair';
      else status = 'attention';
    }
    return { leafCount: leaf.length, withDatesCount: withDates.length, overdueCount: overdueList.length, milestoneCount, hasWBS, datePct, status };
  }, [tasks]);

  // msdyn_progress is stored as decimal 0–1 in Dataverse; normalize to 0–100 for display.
  const normPct = (raw: number | null | undefined): number => {
    if (raw === null || raw === undefined) return 0;
    return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
  };
  const projectPct = normPct(project?.msdyn_progress);

  // Derived values
  // completedTasks / taskPct removed — identity card stats bar moved to Overview Quick Stats
  // Effective finish date for overdue detection. Mirrors the Details-tab
  // rendering rule for "Task Finish Date": trust msdyn_finish only when
  // PSS actually had tasks to compute it from; otherwise use the requester's
  // scheduled-completion ask. See Schedule block below for the read-side
  // equivalent.
  const effectiveFinish = tasks.length > 0
    ? project?.msdyn_finish
    : project?.proj_scheduledcompletion;
  const overdue = !!(effectiveFinish && new Date(effectiveFinish) < new Date() && projectPct < 100);
  const latestStatus = statusReports[0];
  const hasRecentStatus = latestStatus
    ? (Date.now() - new Date(latestStatus.proj_reportingdate ?? latestStatus.createdon ?? '').getTime()) < 30 * 24 * 60 * 60 * 1000
    : false;

  // Attention alerts
  const alerts: Array<{ icon: React.ElementType; message: string; level: 'warning' | 'error' | 'info'; action?: { label: string; onClick: () => void } }> = [];
  if (project && !project['_msdyn_projectmanager_value'])
    alerts.push({ icon: CircleAlert, message: 'No Project Manager assigned.', level: 'warning', action: canEdit ? { label: 'Edit Project', onClick: () => setEditProjectOpen(true) } : undefined });
  if (project && !project['_pmo_primaryteam_value'])
    alerts.push({ icon: Users, message: 'No Primary Team assigned. Every project needs an accountable team.', level: 'warning', action: canEdit ? { label: 'Assign Team', onClick: () => setEditProjectOpen(true) } : undefined });
  if (project && !project['_msdyn_program_value'])
    alerts.push({ icon: Layers, message: 'Not assigned to a Program. Active projects should belong to a program for portfolio visibility.', level: 'info', action: canEdit ? { label: 'Edit Project', onClick: () => setEditProjectOpen(true) } : undefined });
  if (overdue)
    alerts.push({ icon: AlertTriangle, message: `Finish date was ${fmtDate(effectiveFinish)} and progress is ${projectPct}% — project may be overdue.`, level: 'error' });
  if (project?.statecode === 0 && statusReports.length === 0)
    alerts.push({ icon: FileText, message: 'No status reports submitted. Weekly updates keep stakeholders informed.', level: 'info', action: canEdit ? { label: 'Submit Report', onClick: () => { setEditingStatus(null); setStatusDialogOpen(true); } } : undefined });
  else if (project?.statecode === 0 && statusReports.length > 0 && !hasRecentStatus)
    alerts.push({ icon: Clock, message: 'Last status report was more than 30 days ago.', level: 'warning', action: canEdit ? { label: 'Submit Report', onClick: () => { setEditingStatus(null); setStatusDialogOpen(true); } } : undefined });

  if (isLoading) return <LoadingOverlay isLoading label="Loading project..." />;

  return (
    <div className="space-y-5">
      <StagingFailureWatcher projectId={id} />
      <PageHeader
        title={project?.msdyn_subject ?? 'Project Detail'}
        subtitle={
          project?.pmo_projectid
            ? project.pmo_legacyprojectid
              ? `${project.pmo_projectid} · Legacy: ${project.pmo_legacyprojectid}`
              : project.pmo_projectid
            : project?.pmo_legacyprojectid
              ? `Legacy: ${project.pmo_legacyprojectid}`
              : undefined
        }
        showBack
        onBack={() => navigate(backTarget)}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setEditProjectOpen(true)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit Project
              </Button>
            )}
            {(adminRole === 'pmo_admin' || adminRole === 'system_admin') && (
              <Button size="sm" variant="destructive" onClick={handleOpenDeleteDialog}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Coming soon"
              className="opacity-50 cursor-not-allowed"
            >
              <Target className="h-3.5 w-3.5 mr-1.5" />
              Capture Baseline
            </Button>
            {/* Open Board temporarily hidden per operator request (2026-08-21).
                To restore: re-render a <Button asChild> linking to plannerUrl
                (usePlannerUrl) with target=_blank + the ExternalLink icon. */}
            {isDeepLinkAvailable() && (
              <Button size="sm" variant="outline" onClick={() => {
                const link = buildDeepLink({
                  page: 'projects',
                  id: id!,
                  tab: activeTab !== 'overview' ? activeTab : undefined,
                  subtab: activeTab === 'monitor' && monitorSubTab !== 'risks' ? monitorSubTab : undefined,
                  task: selectedTaskId ?? undefined,
                  view: activeView !== 'board' ? activeView : undefined,
                });
                if (link) {
                  navigator.clipboard.writeText(link);
                  toast.success('Link copied');
                }
              }}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" />Copy Link
              </Button>
            )}
          </div>
        }
      />

      <ErrorBanner error={error as Error | null} />

      {/* The project.detail.afterHeader slot has been removed in favor of
          first-class HPI and Payer Issues tabs (see TabsTrigger block
          below). The slot registration is also gone from
          features/teams/payer-initiatives/index.tsx. */}

      {!permission.loading && !permission.canEdit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3 dark:bg-amber-900/20 dark:border-amber-800">
          <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Read-only access</p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
              {permission.reason === 'no_primary_team'
                ? 'This project has no Primary Team assigned. An admin must assign one before edits are possible.'
                : "You aren't assigned to this project. Ask the Primary Team to add your team in the Collaborate tab."}
            </p>
          </div>
        </div>
      )}

      {project && (
        <>
          {/* ── Project identity card ── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-6 py-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <HealthBadge value={project.proj_overallhealth} />
                    {project['proj_stage@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary ring-1 ring-primary/20">
                        {project['proj_stage@OData.Community.Display.V1.FormattedValue']}
                      </span>
                    )}
                    {project['proj_priority@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                        {project['proj_priority@OData.Community.Display.V1.FormattedValue']} Priority
                      </span>
                    )}
                    {project['pmo_complexity@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                        {project['pmo_complexity@OData.Community.Display.V1.FormattedValue']} Complexity
                      </span>
                    )}
                  </div>
                  {/* Meta pills */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    {pmName && (
                      <MetaPill icon={User}>{pmName}</MetaPill>
                    )}
                    {primaryTeamName && (
                      <MetaPill icon={Users}>{primaryTeamName}</MetaPill>
                    )}
                    {programName && (
                      <button
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        onClick={() => project._msdyn_program_value && navigate(`/programs/${project._msdyn_program_value}`)}
                      >
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        {programName}
                      </button>
                    )}
                    {(project.msdyn_scheduledstart || effectiveFinish) && (
                      <MetaPill icon={Calendar}>
                        {fmtDate(project.msdyn_scheduledstart)} – {effectiveFinish ? fmtDate(effectiveFinish) : 'No Finish Date'}
                      </MetaPill>
                    )}
                  </div>
                </div>

                {/* Completion */}
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <p className="text-3xl font-bold text-foreground tabular-nums leading-none">
                    {projectPct}%
                  </p>
                  <p className="text-xs text-muted-foreground">Complete</p>
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                    <div
                      className={cn('h-full rounded-full', projectPct >= 80 ? 'bg-emerald-500' : projectPct >= 40 ? 'bg-primary' : 'bg-amber-500')}
                      style={{ width: `${projectPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* CFR Classification pills */}
            {(project['pmo_cfrcategory@OData.Community.Display.V1.FormattedValue'] || project['pmo_strategicpriority@OData.Community.Display.V1.FormattedValue']) && (
              <div className="border-t border-border bg-muted/20 px-6 py-2.5 flex flex-wrap gap-2">
                {project['pmo_cfrcategory@OData.Community.Display.V1.FormattedValue'] && (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                    {project['pmo_cfrcategory@OData.Community.Display.V1.FormattedValue']}
                  </span>
                )}
                {project['pmo_strategicpriority@OData.Community.Display.V1.FormattedValue'] && (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                    {project['pmo_strategicpriority@OData.Community.Display.V1.FormattedValue']}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── 7-Tab Navigation ── */}
          <Tabs
            value={visibleActiveTab}
            onValueChange={(v) => {
              // Guard against the fall-through-to-first-enabled-tab logic
              // above writing itself back to the URL. When feature toggles
              // or Payer/BI primary-team flags transiently flip off during
              // a query invalidation (e.g. after a DocumentLibrary upload)
              // tabEnabled[activeTab] briefly becomes false, visibleActiveTab
              // resolves to 'overview' via the fallback, and Radix emits
              // onValueChange('overview') to keep its internal state in
              // sync -- clobbering the URL and kicking the user off Plan.
              // Only mirror to the URL when the user genuinely clicked a
              // different visible tab.
              if (v === visibleActiveTab) return;
              setActiveTab(v as typeof activeTab);
            }}
          >
            <div className="overflow-x-auto">
              <TabsList className="bg-muted/30 flex w-max min-w-full">
                {tabEnabled.overview && <TabsTrigger value="overview">Overview</TabsTrigger>}
                {tabEnabled.plan && <TabsTrigger value="plan">Plan</TabsTrigger>}
                {tabEnabled.hpi && <TabsTrigger value="hpi">HPI</TabsTrigger>}
                {tabEnabled.payerIssues && <TabsTrigger value="payerIssues">Payer Inquiries</TabsTrigger>}
                {tabEnabled.coding && <TabsTrigger value="coding">Coding</TabsTrigger>}
                {tabEnabled.tasks && (
                  <TabsTrigger value="tasks">
                    Tasks {tasks.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({tasks.length})</span>}
                  </TabsTrigger>
                )}
                {tabEnabled.monitor && (
                  <TabsTrigger value="monitor">
                    Monitor <span className="ml-1 text-[10px] text-muted-foreground">({risks.length + issues.length + changes.length + decisions.length})</span>
                  </TabsTrigger>
                )}
                {tabEnabled.govern && <TabsTrigger value="govern">Govern</TabsTrigger>}
                {tabEnabled.collaborate && <TabsTrigger value="collaborate">Collaborate</TabsTrigger>}
                {tabEnabled.status && (
                  <TabsTrigger value="status">
                    Status {statusReports.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({statusReports.length})</span>}
                  </TabsTrigger>
                )}
                {tabEnabled.uat && (                   <TabsTrigger value="uat">UAT</TabsTrigger>                 )}
                {tabEnabled.notes && (
                  <TabsTrigger value="notes">
                    Notes {notesCount > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({notesBadge})</span>}
                  </TabsTrigger>
                )}
                {tabEnabled.activity && <TabsTrigger value="activity">Activity</TabsTrigger>}
              </TabsList>
            </div>

            {/* ── OVERVIEW (Command Center) ── */}
            <TabsContent value="overview" className="mt-6 space-y-5">
              {/* Alert Bar */}
              {alerts.length > 0 && (
                <div className="space-y-2">
                  {alerts.slice(0, alertsExpanded ? alerts.length : 1).map((a, i) => (
                    <AlertRow key={i} icon={a.icon} message={a.message} level={a.level} action={a.action} />
                  ))}
                  {alerts.length > 1 && !alertsExpanded && (
                    <button onClick={() => setAlertsExpanded(true)} className="text-xs text-primary hover:underline ml-1">
                      +{alerts.length - 1} more alert{alerts.length > 2 ? 's' : ''}
                    </button>
                  )}
                </div>
              )}


              <div className="grid grid-cols-12 gap-5">
                {/* LEFT COLUMN (7/12) */}
                <div className="col-span-12 lg:col-span-7 space-y-5">
                  {/* About */}
                  <div>
                    <SectionLabel className="mb-2">Description</SectionLabel>
                    {project.msdyn_description ? (
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed line-clamp-4">{project.msdyn_description}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No description &mdash; use Edit Project to add one.</p>
                    )}
                  </div>

                  {/* Latest Update */}
                  {latestStatus ? (
                    <div className="rounded-xl border-l-2 border-l-primary border border-border bg-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <SectionLabel>Latest Update</SectionLabel>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtDate(latestStatus.proj_reportingdate ?? latestStatus.createdon)}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground mb-2">{latestStatus.msdyn_name}</p>
                      {latestStatus.msdyn_accomplishedactivities && (
                        <p className="text-sm text-foreground/90 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                          {latestStatus.msdyn_accomplishedactivities}
                        </p>
                      )}
                      {tabEnabled.status && (
                        <button
                          onClick={() => setActiveTab('status')}
                          className="text-xs text-primary hover:underline underline-offset-2 mt-3"
                        >
                          View all reports &rarr;
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <SectionLabel className="mb-2">Latest Update</SectionLabel>
                      <p className="text-sm text-muted-foreground mb-2">No status reports submitted.</p>
                      {canEdit && (
                        <Button size="sm" variant="secondary" onClick={() => { setEditingStatus(null); setStatusDialogOpen(true); }}>
                          Submit Report
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Schedule */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <SectionLabel className="mb-0">Schedule</SectionLabel>
                        {schedQuality.leafCount > 0 && (
                          <span className={cn(
                            'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                            schedQuality.status === 'healthy' && 'bg-emerald-100 text-emerald-700',
                            schedQuality.status === 'fair' && 'bg-amber-100 text-amber-700',
                            schedQuality.status === 'attention' && 'bg-rose-100 text-rose-700',
                          )}>
                            {schedQuality.status === 'healthy' ? 'Healthy' : schedQuality.status === 'fair' ? 'Fair' : 'Needs Attention'}
                          </span>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          onClick={() => openEditProject('details')}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          <Pencil className="h-3 w-3" />Edit
                        </button>
                      )}
                    </div>
                    <ProgressBar value={projectPct} />
                    {/*
                      Schedule fields (three distinct dates so the Details tab
                      surfaces both the requester's original ask AND what PSS
                      is currently computing from tasks):
                        - Scheduled Start        (msdyn_scheduledstart, plan start)
                        - Scheduled Completion   (proj_scheduledcompletion — the
                          requester's original target completion date captured at
                          intake. See buildProjectPayload / intakeConversion.)
                        - Finish Date            (proj_actualfinishdate — the
                          manual, PMO-owned finish date, editable on the Details tab.)
                        - Task Finish Date       (msdyn_finish — PSS-owned,
                          computed from task dates. When the project has no
                          tasks, PSS reports msdyn_finish = msdyn_scheduledstart
                          which is misleading, so we render "—" for that case.)
                      The edit form's editable "Finish Date" binds
                      proj_actualfinishdate; "Task Finish Date" stays read-only
                      (msdyn_finish, PSS-owned).
                    */}
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <ReadOnlyField label="Scheduled Start" value={fmtDate(project.msdyn_scheduledstart)} />
                      <ReadOnlyField label="Scheduled Completion" value={fmtDate(project.proj_scheduledcompletion)} />
                      <ReadOnlyField label="Finish Date" value={fmtDate(project.proj_actualfinishdate)} />
                      <ReadOnlyField
                        label="Task Finish Date"
                        value={tasks.length > 0 ? fmtDate(project.msdyn_finish) : '—'}
                      />
                      <ReadOnlyField label="Duration (Days)" value={fmtNumber(project.msdyn_duration)} />
                      <ReadOnlyField label="Schedule Mode" value={project['msdyn_schedulemode@OData.Community.Display.V1.FormattedValue']} />
                    </div>
                    {(project.msdyn_effort != null || project.msdyn_effortcompleted != null) && (
                      <>
                        <div className="h-px bg-border/60 my-4" />
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Total Effort</p>
                            <p className="text-sm font-semibold text-foreground">{fmtNumber(project.msdyn_effort, 0)}h</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Completed</p>
                            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmtNumber(project.msdyn_effortcompleted, 0)}h</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Remaining</p>
                            <p className="text-sm font-semibold text-foreground">{fmtNumber(project.msdyn_effortremaining, 0)}h</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Business Case excerpt (conditional) */}
                  {project.msdyn_businesscase && (
                    <div>
                      <SectionLabel className="mb-2">Business Case</SectionLabel>
                      <p className="text-sm text-foreground/90 leading-relaxed line-clamp-2 whitespace-pre-wrap">{project.msdyn_businesscase}</p>
                      {tabEnabled.plan && (
                        <button
                          onClick={() => setActiveTab('plan')}
                          className="text-xs text-primary hover:underline underline-offset-2 mt-1"
                        >
                          View full business case &rarr;
                        </button>
                      )}
                    </div>
                  )}

                  {/* Financials (conditional) — hidden on custom Labor projects
                      (they track hours, not money). Shown for Financial projects
                      and for PSS projects (no metric column there). */}
                  {project.proj_budget != null
                    && (!isCustomSource || (project.pmo_resourcemetrictype ?? RESOURCE_METRIC_TYPE.Labor) === RESOURCE_METRIC_TYPE.Financial) && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <SectionLabel className="mb-0">Financials</SectionLabel>
                        {canEdit && (
                          <button
                            onClick={() => openEditProject('financials')}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <Pencil className="h-3 w-3" />Edit
                          </button>
                        )}
                      </div>
                      <div>
                        {([
                          { label: 'Budget', value: project.proj_budget, variance: false },
                          { label: 'Actual', value: project.proj_actualcost, variance: false },
                          { label: 'Variance', value: project.proj_budgetvariance, variance: true },
                        ] as { label: string; value?: number; variance: boolean }[]).map(({ label, value, variance }) => (
                          <div key={label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className={cn(
                              'text-sm font-semibold tabular-nums',
                              variance && value != null ? (value < 0 ? 'text-rose-500' : 'text-emerald-500') : 'text-foreground'
                            )}>
                              {fmtCurrency(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <BudgetBar budget={project.proj_budget} actual={project.proj_actualcost} />
                      {project.proj_roi != null && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">ROI</span>
                          <span className={cn('text-xs font-semibold', project.proj_roi >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                            {project.proj_roi.toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resourcing (custom Labor projects only) — mirrors the
                      Financials card but for the labor-hours model. */}
                  {isCustomSource
                    && (project.pmo_resourcemetrictype ?? RESOURCE_METRIC_TYPE.Labor) === RESOURCE_METRIC_TYPE.Labor
                    && (project.pmo_forecastedlaborhours != null
                        || project.pmo_currenttotalhours != null
                        || project.pmo_currentcompletedhours != null) && (
                    <div className="rounded-xl border border-border bg-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <SectionLabel className="mb-0">Labor Hours</SectionLabel>
                        {canEdit && (
                          <button
                            onClick={() => openEditProject('financials')}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <Pencil className="h-3 w-3" />Edit
                          </button>
                        )}
                      </div>
                      <div>
                        {([
                          { label: 'Forecasted Labor Hours (Entire Project)', value: project.pmo_forecastedlaborhours },
                          { label: 'Current Completed Hours', value: project.pmo_currentcompletedhours },
                          { label: 'Current Total Task Hours', value: project.pmo_currenttotalhours },
                        ] as { label: string; value?: number }[]).map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                            <span className="text-xs text-muted-foreground">{label}</span>
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              {value != null ? `${value}h` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN (5/12) */}
                <div className="col-span-12 lg:col-span-5 space-y-5">
                  {/* Health */}
                  <div className="rounded-xl border border-border bg-card p-5">
                    <SectionLabel className="mb-3">Health</SectionLabel>
                    <div className="space-y-0.5">
                      {[
                        { label: 'Overall',   value: project.proj_overallhealth },
                        { label: 'Schedule',  value: project.proj_schedulehealth },
                        { label: 'Effort',    value: project.proj_efforthealth },
                        { label: 'Financial', value: project.proj_financialhealth },
                        { label: 'Issues',    value: project.proj_issuehealth },
                      ].map((h) => (
                        <div key={h.label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                          <span className="text-xs text-muted-foreground">{h.label}</span>
                          {h.value != null ? (
                            <HealthBadge value={h.value} size="sm" />
                          ) : (
                            <span className="text-xs text-muted-foreground">Not set</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Key People */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <SectionLabel className="mb-0">Key People</SectionLabel>
                      {canEdit && (<button onClick={() => openEditProject('governance')} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <Pencil className="h-3 w-3" />Edit
                      </button>)}
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: 'Project Manager', name: pmName },
                        { label: 'Executive Sponsor', name: sponsorName },
                        // Payer Initiatives team-feature: only show this row
                        // when the project's Primary Team is Payer Initiatives.
                        ...(isPayerInitiativesPrimary
                          ? [{ label: 'Strategic Account Executive', name: saeName }]
                          : []),
                      ].map((p) => (
                        <div key={p.label} className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground w-28 shrink-0">{p.label}</span>
                          <span className={cn('text-sm', p.name ? 'text-foreground' : 'text-muted-foreground')}>
                            {p.name ?? 'Not assigned'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Stats — cards deep-link into Monitor; hide entire block if Monitor is off */}
                  {tabEnabled.monitor && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                      <div className="grid grid-cols-2 divide-x divide-border">
                        <StatCell
                          label="Active Risks"
                          value={risks.length}
                          accent={risks.length > 0 ? 'rose' : undefined}
                          onClick={() => navigateToMonitor('risks')}
                        />
                        <StatCell
                          label="Open Issues"
                          value={issues.length}
                          accent={issues.length > 0 ? 'amber' : undefined}
                          onClick={() => navigateToMonitor('issues')}
                        />
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
                        <StatCell
                          label="Pending Changes"
                          value={changes.length}
                          accent={changes.length > 0 ? 'blue' : undefined}
                          onClick={() => navigateToMonitor('changes')}
                        />
                        <StatCell
                          label="Open Decisions"
                          value={decisions.length}
                          onClick={() => navigateToMonitor('decisions')}
                        />
                      </div>
                    </div>
                  )}

                  {/* Tracking Labels. INTENTIONALLY ungated by canEdit: pmo_tracking has
                      Global CRUD on all CFR PMO roles so a user from any team can tag any
                      project. Do not add a permission check without reading the 2026-09-17
                      Tracking Labels plan context. Positioned after the Risks/Issues/Changes/
                      Decisions Quick Stats grid per operator request 2026-09-17. */}
                  <TrackingLabelsCard recordType="Project" recordId={id!} />
                </div>
              </div>
            </TabsContent>

            {/* OLD TABS REMOVED — content moved to workspace components */}
            {/* Business Case → Plan workspace, Financials → Overview, Resources → Plan workspace */}
            {/* Risks/Issues/Changes/Decisions → Monitor workspace */}
            {/* Initiation/Gates/Closeout → Govern workspace */}
            {/* Documents → Plan workspace, Meetings → Collaborate workspace */}

            {/* ── PLAN ── */}
            <TabsContent value="plan" className="mt-6">
              <PlanWorkspace
                projectId={id!}
                projectName={project.msdyn_subject}
                project={project}
                members={members}
                bookableResources={bookableResources}
                assignedResourceIds={assignedResourceIds}
                onAddMember={async (resourceId) => { await addMemberMutation.mutateAsync(resourceId); }}
                onRemoveMember={async (teamMemberId) => { await removeMemberMutation.mutateAsync(teamMemberId); }}
                addMemberPending={addMemberMutation.isPending}
                canEdit={canEdit}
                tasks={tasks}
                useNewResourceModel={project?.pmo_usenewresourcemodel === true}
                newModelAssignees={taskAssigneesMapped}
                capacityHours={standardCapacityHours}
                resourceMetricType={project?.pmo_resourcemetrictype ?? RESOURCE_METRIC_TYPE.Labor}
              />
            </TabsContent>

            {/* ── PAYER INITIATIVES — HPI ── */}
            {tabEnabled.hpi && (
              <TabsContent value="hpi" className="mt-6">
                <ProjectHpiTab
                  projectId={id!}
                  currentHpiId={project['_pmo_payerinitiatives_hpiissue_value']}
                  currentHpiLabel={project['_pmo_payerinitiatives_hpiissue_value@OData.Community.Display.V1.FormattedValue']}
                  canEdit={canEdit}
                />
              </TabsContent>
            )}

            {/* ── PAYER INITIATIVES — Payer Issues ── */}
            {tabEnabled.payerIssues && (
              <TabsContent value="payerIssues" className="mt-6">
                <ProjectPayerIssuesTab projectId={id!} canEdit={canEdit} />
              </TabsContent>
            )}

            {/* ── BI CODING ── */}
            {tabEnabled.coding && (
              <TabsContent value="coding" className="mt-6">
                <ProjectCodingTab projectId={id!} />
              </TabsContent>
            )}

            {/* ── TASKS ── */}
            <TabsContent value="tasks" className="mt-6">
              <TaskWorkspace
                projectId={id!}
                projectCreatedOn={project?.createdon}
                tasks={tasks}
                buckets={buckets}
                dependencies={dependencies}
                assignments={taskAssigneesMapped}
                allProjectAssignees={taskAssigneesMapped}
                useNewResourceModel={project?.pmo_usenewresourcemodel === true}
                teamMembers={taskTeamMembers}
                onCreateTask={handleCreateTask}
                onAfterCreateTask={handleAfterCreateTask}
                onUpdateTask={handleUpdateTask}
                onUpdateTaskFull={handleUpdateTaskFull}
                onUpdateTaskFullNoAudit={handleUpdateTaskFullNoAudit}
                onAuditTaskBatch={(taskId, taskName, entries) => {
                  // Wave 1 batched audit — the panel hands us a single
                  // entries[] covering BOTH field changes and label /
                  // assignee / checklist relationship changes. The panel
                  // routes its field mutation through the no-audit mutator
                  // above, so this is the only audit row written for the
                  // entire Submit. Result: one row per Submit, even when
                  // the user changed 5 fields + added 2 labels.
                  auditChange({
                    entityType: 'task',
                    entityId: taskId,
                    entityName: taskName,
                    action: 'update',
                    changes: entries,
                    parentProjectId: id!,
                    parentProjectName: project?.msdyn_subject,
                  });
                }}
                onDeleteTask={handleDeleteTask}
                onCreateDependency={customTaskSource ? handleCreateDependency : undefined}
                onDeleteDependency={customTaskSource ? handleDeleteDependency : undefined}
                onAssign={handleAssign}
                onUnassign={handleUnassign}
                onTasksInvalidate={handleTasksInvalidate}
                selectedTaskId={selectedTaskId}
                onSelectTask={handleSelectTask}
                activeView={activeView}
                onActiveViewChange={setActiveView}
                canEdit={canEdit}
              />
            </TabsContent>

            {/* ── MONITOR ── */}
            <TabsContent value="monitor" className="mt-6">
              <MonitorWorkspace
                projectId={id!}
                risks={risks}
                issues={issues}
                changes={changes}
                decisions={{ length: decisions.length }}
                defaultSubTab={monitorSubTab}
                onOpenRiskDialog={(r) => { setEditingRisk(r); setRiskDialogOpen(true); }}
                onDeleteRisk={setDeleteRiskTarget}
                onOpenIssueDialog={(i) => { setEditingIssue(i); setIssueDialogOpen(true); }}
                onDeleteIssue={setDeleteIssueTarget}
                onOpenChangeDialog={(c) => { setEditingChange(c); setChangeDialogOpen(true); }}
                onDeleteChange={setDeleteChangeTarget}
                canEdit={canEdit}
              />
            </TabsContent>

            {/* ── GOVERN ── */}
            <TabsContent value="govern" className="mt-6">
              <GovernWorkspace
                projectId={id!}
                projectStage={project['proj_stage@OData.Community.Display.V1.FormattedValue']}
                onEditProject={() => setEditProjectOpen(true)}
                canEdit={canEdit}
              />
            </TabsContent>

            {/* ── COLLABORATE ── */}
            <TabsContent value="collaborate" className="mt-6">
              <CollaborateWorkspace
                projectId={id!}
                projectName={project.msdyn_subject}
                primaryTeamName={primaryTeamName}
                primaryTeam={primaryTeam}
                contributingTeams={contributingTeams}
                availableTeams={availableTeams}
                onAddTeam={(payload) => addMutation.mutate(payload as Parameters<typeof addMutation.mutate>[0], { onSuccess: () => {} })}
                onRemoveTeam={(teamId) => removeMutation.mutate(teamId)}
                addTeamPending={addMutation.isPending}
                removingTeamRecordId={removeMutation.isPending ? (removeMutation.variables as string | undefined) : undefined}
                onEditProject={() => setEditProjectOpen(true)}
                canManageRoster={canManageRoster}
                canEdit={canEdit}
                collaborators={collaborators}
                collaborationMode={collaborationMode}
                onAddCollaborators={(entries, onSuccess) => addCollabMutation.mutate(entries, { onSuccess })}
                onRemoveCollaborator={(collaboratorId, userId) => removeCollabMutation.mutate({ collaboratorId, userId })}
                addCollaboratorPending={addCollabMutation.isPending}
                removeCollaboratorPending={removeCollabMutation.isPending}
              />
            </TabsContent>

            {/* ── STATUS ── */}
            {/* UAT (spec 001). Rendered only when tabEnabled.uat, so the trigger and
                the content can never disagree about visibility. */}
            {tabEnabled.uat && id && (
              <TabsContent value="uat" className="mt-6">
                <ProjectUatTab projectId={id} />
              </TabsContent>
            )}
            <TabsContent value="status" className="mt-6 max-w-3xl space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{statusReports.length} report{statusReports.length !== 1 ? 's' : ''}</p>
                <Button size="sm" onClick={() => { setEditingStatus(null); setStatusDialogOpen(true); }} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />New Report
                </Button>
              </div>
              {statusReports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">No status reports yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
                    Status reports capture progress, accomplishments, and planned activities. Submit them on a regular cadence.
                  </p>
                </div>
              ) : (
                statusReports.map((sr, idx) => (
                  <div
                    key={sr.msdyn_projectstatusreportid}
                    id={`sr-${sr.msdyn_projectstatusreportid}`}
                    className={cn(
                      'rounded-xl border bg-card overflow-hidden scroll-mt-24',
                      idx === 0 ? 'border-primary/25 shadow-sm' : 'border-border'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-between px-4 py-3 border-b',
                      idx === 0 ? 'border-primary/20 bg-primary/5' : 'border-border bg-muted/20'
                    )}>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{sr.msdyn_name}</p>
                          {idx === 0 && (
                            <span className="text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">Latest</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sr.proj_reportingdate ? fmtDate(sr.proj_reportingdate) : fmtDate(sr.createdon)}
                          {sr['_proj_submitter_value@OData.Community.Display.V1.FormattedValue']
                            ? ` · ${sr['_proj_submitter_value@OData.Community.Display.V1.FormattedValue']}`
                            : ''}
                        </p>
                      </div>
                      {canEdit && (canModifyStatusReport(sr)) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => { setEditingStatus(sr); setStatusDialogOpen(true); }}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                            title="Edit report"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteStatusTarget(sr)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete report"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="divide-y divide-border/60">
                      {sr.msdyn_accomplishedactivities && (
                        <div className="px-4 py-3.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Accomplished</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{sr.msdyn_accomplishedactivities}</p>
                        </div>
                      )}
                      {sr.msdyn_plannedactivities && (
                        <div className="px-4 py-3.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Planned Activities</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{sr.msdyn_plannedactivities}</p>
                        </div>
                      )}
                      {sr.msdyn_additionalcomments && (
                        <div className="px-4 py-3.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Additional Comments</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{sr.msdyn_additionalcomments}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            {tabEnabled.notes && (
              <TabsContent value="notes" className="mt-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Notes</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Project notes on the left; rolled-up task notes on the right.
                  </p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Project notes
                    </h3>
                    <NotesSection
                      mode="projectOnly"
                      scope={{
                        kind: 'project',
                        projectId: id!,
                        projectName: project?.msdyn_subject,
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Task notes
                    </h3>
                    <NotesSection
                      mode="tasksOnly"
                      scope={{
                        kind: 'project',
                        projectId: id!,
                        projectName: project?.msdyn_subject,
                        rollupTasks: tasks.map((tt) => ({ id: tt.msdyn_projecttaskid, name: tt.msdyn_subject })),
                      }}
                    />
                  </div>
                </div>
              </TabsContent>
            )}

            {tabEnabled.activity && (
              <TabsContent value="activity" className="mt-6 max-w-3xl space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Activity</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Every change made to this project and its tasks. Most recent first.
                  </p>
                </div>
                <ActivityFeed
                  scope={{ kind: 'project', projectId: id! }}
                  searchable
                  searchPlaceholder="Search activity by user, field, value…"
                />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}

      {/* ── Dialogs ── */}

      {/* ── Risk Dialog ── */}
      <RiskFormDialog
        open={riskDialogOpen}
        editing={editingRisk}
        existingRisks={risks}
        isPending={updateRiskMutation.isPending}
        assigneeOptions={scopedAssigneeOptions}
        resolveAssigneeLabel={scopedAssigneeResolveLabel}
        onClose={() => setRiskDialogOpen(false)}
        onSave={(payload) => {
          setRiskDialogOpen(false);
          const name = payload.msdyn_subject ?? '(unnamed risk)';
          if (editingRisk) {
            const before = editingRisk as unknown as Record<string, unknown>;
            const after = payload as unknown as Record<string, unknown>;
            const changes = diffEntityUpdate(before, after, RISK_FIELD_LABELS);
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            const prevAssignee = (editingRisk['_proj_assignedto_value'] ?? '').replace(/[{}]/g, '').trim().toLowerCase();
            updateRiskMutation.mutate(
              { id: editingRisk.msdyn_projectriskid, payload },
              {
                onSuccess: () => {
                  if (newAssignee && newAssignee.toLowerCase() !== prevAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'risk', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'risk',
                  entityId: editingRisk.msdyn_projectriskid,
                  entityName: name,
                  action: 'update',
                  changes,
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          } else {
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            createRiskMutation.mutate(
              { ...stripNullAssignee(payload), 'msdyn_project@odata.bind': `/msdyn_projects(${id})` },
              {
                onSuccess: (created) => {
                  if (newAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'risk', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'risk',
                  entityId: (created as { msdyn_projectriskid?: string })?.msdyn_projectriskid ?? '',
                  entityName: name,
                  action: 'create',
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          }
        }}
      />
      <ConfirmDialog
        open={!!deleteRiskTarget}
        title="Delete risk"
        message={`Delete "${deleteRiskTarget?.msdyn_subject ?? deleteRiskTarget?.msdyn_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteRiskMutation.isPending}
        onConfirm={() => {
          if (!deleteRiskTarget) return;
          const target = deleteRiskTarget;
          deleteRiskMutation.mutate(target.msdyn_projectriskid, {
            onSuccess: () => {
              auditChange({
                entityType: 'risk',
                entityId: target.msdyn_projectriskid,
                entityName: target.msdyn_subject ?? target.msdyn_name ?? '(unnamed risk)',
                action: 'delete',
                parentProjectId: id!,
                parentProjectName: project?.msdyn_subject,
              });
              setDeleteRiskTarget(null);
            },
          });
        }}
        onCancel={() => setDeleteRiskTarget(null)}
      />

      {/* ── Issue Dialog ── */}
      <IssueFormDialog
        open={issueDialogOpen}
        editing={editingIssue}
        existingIssues={issues}
        isPending={updateIssueMutation.isPending}
        assigneeOptions={scopedAssigneeOptions}
        resolveAssigneeLabel={scopedAssigneeResolveLabel}
        onClose={() => setIssueDialogOpen(false)}
        onSave={(payload) => {
          setIssueDialogOpen(false);
          const name = payload.msdyn_name ?? '(unnamed issue)';
          if (editingIssue) {
            const before = editingIssue as unknown as Record<string, unknown>;
            const after = payload as unknown as Record<string, unknown>;
            const changes = diffEntityUpdate(before, after, ISSUE_FIELD_LABELS);
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            const prevAssignee = (editingIssue['_proj_assignedto_value'] ?? '').replace(/[{}]/g, '').trim().toLowerCase();
            updateIssueMutation.mutate(
              { id: editingIssue.msdyn_projectissueid, payload },
              {
                onSuccess: () => {
                  if (newAssignee && newAssignee.toLowerCase() !== prevAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'issue', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'issue',
                  entityId: editingIssue.msdyn_projectissueid,
                  entityName: name,
                  action: 'update',
                  changes,
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          } else {
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            createIssueMutation.mutate(
              { ...stripNullAssignee(payload), 'msdyn_project@odata.bind': `/msdyn_projects(${id})` },
              {
                onSuccess: (created) => {
                  if (newAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'issue', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'issue',
                  entityId: (created as { msdyn_projectissueid?: string })?.msdyn_projectissueid ?? '',
                  entityName: name,
                  action: 'create',
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          }
        }}
      />
      <ConfirmDialog
        open={!!deleteIssueTarget}
        title="Delete issue"
        message={`Delete "${deleteIssueTarget?.msdyn_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteIssueMutation.isPending}
        onConfirm={() => {
          if (!deleteIssueTarget) return;
          const target = deleteIssueTarget;
          deleteIssueMutation.mutate(target.msdyn_projectissueid, {
            onSuccess: () => {
              auditChange({
                entityType: 'issue',
                entityId: target.msdyn_projectissueid,
                entityName: target.msdyn_name ?? '(unnamed issue)',
                action: 'delete',
                parentProjectId: id!,
                parentProjectName: project?.msdyn_subject,
              });
              setDeleteIssueTarget(null);
            },
          });
        }}
        onCancel={() => setDeleteIssueTarget(null)}
      />

      {/* ── Change Dialog ── */}
      <ChangeFormDialog
        open={changeDialogOpen}
        editing={editingChange}
        existingChanges={changes}
        isPending={updateChangeMutation.isPending}
        assigneeOptions={scopedAssigneeOptions}
        resolveAssigneeLabel={scopedAssigneeResolveLabel}
        onClose={() => setChangeDialogOpen(false)}
        onSave={(payload) => {
          setChangeDialogOpen(false);
          const name = payload.msdyn_name ?? '(unnamed change)';
          if (editingChange) {
            const before = editingChange as unknown as Record<string, unknown>;
            const after = payload as unknown as Record<string, unknown>;
            const changes = diffEntityUpdate(before, after, CHANGE_FIELD_LABELS);
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            const prevAssignee = (editingChange['_proj_assignedto_value'] ?? '').replace(/[{}]/g, '').trim().toLowerCase();
            updateChangeMutation.mutate(
              { id: editingChange.msdyn_projectchangeid, payload },
              {
                onSuccess: () => {
                  if (newAssignee && newAssignee.toLowerCase() !== prevAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'change', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'change',
                  entityId: editingChange.msdyn_projectchangeid,
                  entityName: name,
                  action: 'update',
                  changes,
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          } else {
            const newAssignee = assigneeGuidFromBind(payload['proj_AssignedTo@odata.bind']);
            createChangeMutation.mutate(
              { ...stripNullAssignee(payload), 'msdyn_project@odata.bind': `/msdyn_projects(${id})` },
              {
                onSuccess: (created) => {
                  if (newAssignee) {
                    void emitMonitorItemAssigned({ assigneeUserId: newAssignee, actorUserId: dv.getCurrentUserId(), kind: 'change', itemName: name, projectId: id!, projectName: project?.msdyn_subject });
                  }
                  auditChange({
                  entityType: 'change',
                  entityId: (created as { msdyn_projectchangeid?: string })?.msdyn_projectchangeid ?? '',
                  entityName: name,
                  action: 'create',
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                  });
                },
              },
            );
          }
        }}
      />
      <ConfirmDialog
        open={!!deleteChangeTarget}
        title="Delete change request"
        message={`Delete "${deleteChangeTarget?.msdyn_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteChangeMutation.isPending}
        onConfirm={() => {
          if (!deleteChangeTarget) return;
          const target = deleteChangeTarget;
          deleteChangeMutation.mutate(target.msdyn_projectchangeid, {
            onSuccess: () => {
              auditChange({
                entityType: 'change',
                entityId: target.msdyn_projectchangeid,
                entityName: target.msdyn_name ?? '(unnamed change)',
                action: 'delete',
                parentProjectId: id!,
                parentProjectName: project?.msdyn_subject,
              });
              setDeleteChangeTarget(null);
            },
          });
        }}
        onCancel={() => setDeleteChangeTarget(null)}
      />

      {/* ── Status Report Dialog ── */}
      <StatusReportFormDialog
        open={statusDialogOpen}
        editing={editingStatus}
        projectId={id!}
        isPending={createStatusMutation.isPending || updateStatusMutation.isPending}
        onClose={() => setStatusDialogOpen(false)}
        onSave={(payload) => {
          setStatusDialogOpen(false);
          const name = (payload as { msdyn_name?: string }).msdyn_name ?? 'Status report';
          if (editingStatus) {
            const before = editingStatus as unknown as Record<string, unknown>;
            const after = payload as unknown as Record<string, unknown>;
            const changes = diffEntityUpdate(before, after, STATUS_REPORT_FIELD_LABELS);
            updateStatusMutation.mutate(
              { id: editingStatus.msdyn_projectstatusreportid, payload },
              {
                onSuccess: () => auditChange({
                  entityType: 'statusreport',
                  entityId: editingStatus.msdyn_projectstatusreportid,
                  entityName: name,
                  action: 'update',
                  changes,
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                }),
              },
            );
          } else {
            // Stamp the current user as proj_Submitter — Dataverse does not
            // populate this lookup automatically on create. Without it the
            // "Submitted By" column on the Status Reports list and the project
            // status tab card both render blank.
            //
            // 2026-07-22 fix (Chandra Sicairos-Brown, "Chandra test" project):
            // dv.getCurrentUserId() reads window.Xrm which is not injected
            // into Power Apps Code Apps -- it returns the literal string
            // 'anonymous', which produced /systemusers(anonymous) in the
            // payload and Dataverse rejected with 0x80060888 "Bad Request -
            // Error in query syntax". Use the resolved GUID from
            // useCurrentUserId() (Power Apps SDK context -> AAD -> systemuser
            // lookup) and gate on a real GUID pattern, not just truthy.
            const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const submitterBind = (currentUserId && GUID_RE.test(currentUserId))
              ? { 'proj_Submitter@odata.bind': `/systemusers(${currentUserId})` }
              : {};
            createStatusMutation.mutate(
              { ...payload, 'msdyn_Project@odata.bind': `/msdyn_projects(${id})`, ...submitterBind },
              {
                onSuccess: (created) => auditChange({
                  entityType: 'statusreport',
                  entityId: (created as { msdyn_projectstatusreportid?: string })?.msdyn_projectstatusreportid ?? '',
                  entityName: name,
                  action: 'create',
                  parentProjectId: id!,
                  parentProjectName: project?.msdyn_subject,
                }),
              },
            );
          }
        }}
      />
      <ConfirmDialog
        open={!!deleteStatusTarget}
        title="Delete status report"
        message={`Delete "${deleteStatusTarget?.msdyn_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteStatusMutation.isPending}
        onConfirm={() => {
          if (!deleteStatusTarget) return;
          const target = deleteStatusTarget;
          deleteStatusMutation.mutate(target.msdyn_projectstatusreportid, {
            onSuccess: () => {
              auditChange({
                entityType: 'statusreport',
                entityId: target.msdyn_projectstatusreportid,
                entityName: target.msdyn_name ?? 'Status report',
                action: 'delete',
                parentProjectId: id!,
                parentProjectName: project?.msdyn_subject,
              });
              setDeleteStatusTarget(null);
            },
          });
        }}
        onCancel={() => setDeleteStatusTarget(null)}
      />

      {/* ── Project edit dialog ── */}
      {project && (
        <ProjectEditDialog
          open={editProjectOpen}
          onClose={() => { setEditProjectOpen(false); setEditProjectInitialTab('details'); updateProjectMutation.reset(); }}
          project={project}
          initialTab={editProjectInitialTab}
          hasTasks={tasks.length > 0}
          isAdmin={isStatusAdmin}
          isPending={updateProjectMutation.isPending}
          error={updateProjectMutation.error as Error | null}
          onSave={async (payload, scheduleUpdate) => {
            // Intercept a Primary-Team change (2026-07-22). The payload
            // arrives with pmo_PrimaryTeam@odata.bind set to a new /teams(...)
            // string OR to null (unset). If it changed, open the confirmation
            // modal and defer the actual save until the operator confirms.
            const primaryBind = payload['pmo_PrimaryTeam@odata.bind'] as string | null | undefined;
            if (primaryBind !== undefined) {
              const oldTeamId = (project['_pmo_primaryteam_value'] as string | undefined) ?? null;
              const newTeamId = (typeof primaryBind === 'string')
                ? (primaryBind.match(/\(([0-9a-f-]{36})\)/i)?.[1] ?? null)
                : null;
              if (oldTeamId !== newTeamId) {
                // Open modal and pause here until Confirm or Cancel resolves.
                await new Promise<void>((resolve, reject) => {
                  setPendingPrimaryTeamSave({
                    payload,
                    scheduleUpdate,
                    oldTeamId,
                    newTeamId,
                    resolve,
                    reject,
                  });
                });
                // Confirm path (resolve) fell through here after the cascade
                // ran; the ProjectEditDialog will now see no error and close
                // itself. Return early -- everything's already been written.
                return;
              }
            }

            try {
              // Start date: PSS engine (msdyn_project shell) on the PSS source,
              // but a plain pmo_project PATCH on the custom source -- migrated
              // custom projects are shell-less, so PSS 404s. buildCustomProjectPayload
              // maps msdyn_scheduledstart -> pmo_scheduledstart.
              const patch: typeof payload = { ...payload };
              if (scheduleUpdate?.scheduledStart !== undefined) {
                if (isCustomSource) {
                  (patch as Record<string, unknown>).msdyn_scheduledstart = scheduleUpdate.scheduledStart;
                } else {
                  await updateProjectSchedule({ projectId: id!, ...scheduleUpdate });
                }
              }
              // Non-scheduling fields (plus custom-mode start date) go through direct PATCH
              if (Object.keys(patch).length > 0) {
                await updateProjectMutation.mutateAsync(patch);
              }
              // Wave 1 audit — emit one EntityChange row covering all field
              // diffs from this save (PSS-managed start date + direct-PATCH fields).
              const before: Record<string, unknown> = project as unknown as Record<string, unknown>;
              const after: Record<string, unknown> = { ...payload };
              if (scheduleUpdate?.scheduledStart !== undefined) {
                after.msdyn_scheduledstart = scheduleUpdate.scheduledStart;
              }
              const changes: ChangeAuditFieldDiff[] = diffEntityUpdate(before, after, PROJECT_FIELD_LABELS);
              if (changes.length > 0) {
                auditChange({
                  entityType: 'project',
                  entityId: id!,
                  entityName: project.msdyn_subject,
                  action: 'update',
                  changes,
                  parentProjectId: id!,
                  parentProjectName: project.msdyn_subject,
                });
              }
              setEditProjectOpen(false);
            } catch (err) {
              throw err instanceof Error ? err : new Error(String(err));
            }
          }}
        />
      )}

      {/* Primary-team change confirmation (2026-07-22). Fires from the
          Edit Project dialog's save handler when the operator changed the
          Governance-tab Primary Team dropdown. On confirm, we run the project
          mutation THEN applyPrimaryTeamChange (roster demote/promote + share
          reconcile + cache invalidation) THEN audit + close. */}
      {project && pendingPrimaryTeamSave && (
        <PrimaryTeamChangeConfirmDialog
          open={!!pendingPrimaryTeamSave}
          oldTeamName={primaryTeamOldNameQuery.data?.name}
          newTeamName={primaryTeamNewNameQuery.data?.name}
          isPending={primaryTeamCascadeRunning}
          onCancel={() => {
            const pending = pendingPrimaryTeamSave;
            setPendingPrimaryTeamSave(null);
            if (pending) pending.reject(new Error('Primary team change cancelled'));
          }}
          onConfirm={async () => {
            const pending = pendingPrimaryTeamSave;
            if (!pending) return;
            setPrimaryTeamCascadeRunning(true);
            try {
              // 1. Project row write (lookup + any other governance fields).
              //    Start date: custom source is shell-less, so PATCH pmo_project
              //    directly (buildCustomProjectPayload maps to pmo_scheduledstart);
              //    PSS engine only on the PSS source.
              const teamPatch: typeof pending.payload = { ...pending.payload };
              if (pending.scheduleUpdate?.scheduledStart !== undefined) {
                if (isCustomSource) {
                  (teamPatch as Record<string, unknown>).msdyn_scheduledstart = pending.scheduleUpdate.scheduledStart;
                } else {
                  await updateProjectSchedule({ projectId: id!, ...pending.scheduleUpdate });
                }
              }
              if (Object.keys(teamPatch).length > 0) {
                await updateProjectMutation.mutateAsync(teamPatch);
              }
              // 2. Cascade: roster demote/promote + share reconcile + cache invalidation.
              await applyPrimaryTeamChange({
                projectId: id!,
                oldTeamId: pending.oldTeamId,
                newTeamId: pending.newTeamId,
                qc: queryClient,
              });
              // 3. Audit. Regular field-diff audit + a relationship audit for
              //    the primary-team change so the change history shows a
              //    human-readable "Team A → Team B" entry.
              const before: Record<string, unknown> = project as unknown as Record<string, unknown>;
              const after: Record<string, unknown> = { ...pending.payload };
              if (pending.scheduleUpdate?.scheduledStart !== undefined) {
                after.msdyn_scheduledstart = pending.scheduleUpdate.scheduledStart;
              }
              const fieldChanges: ChangeAuditFieldDiff[] = diffEntityUpdate(before, after, PROJECT_FIELD_LABELS);
              const oldName = primaryTeamOldNameQuery.data?.name ?? '—';
              const newName = primaryTeamNewNameQuery.data?.name ?? '—';
              auditChange({
                entityType: 'project',
                entityId: id!,
                entityName: project.msdyn_subject,
                action: 'update',
                changes: [
                  ...fieldChanges,
                  { kind: 'relationship', relation: 'primary-team', action: 'update', label: `${oldName} → ${newName}` },
                ],
                parentProjectId: id!,
                parentProjectName: project.msdyn_subject,
              });
              setPendingPrimaryTeamSave(null);
              setPrimaryTeamCascadeRunning(false);
              pending.resolve();
              setEditProjectOpen(false);
            } catch (err) {
              setPrimaryTeamCascadeRunning(false);
              setPendingPrimaryTeamSave(null);
              pending.reject(err instanceof Error ? err : new Error(String(err)));
            }
          }}
        />
      )}

      {/* Team dialogs moved to CollaborateWorkspace */}

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete project"
        recordName={project?.msdyn_subject ?? ''}
        childSummary={deleteSummary}
        childSummaryLoading={deleteSummaryLoading}
        extraWarning="This PERMANENTLY DELETES the project, the originating intake request, and every related task, risk, issue, change, status report, baseline, decision, gate, artifact, closeout, document link, meeting link, notification, and telemetry event. There is no undo."
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
