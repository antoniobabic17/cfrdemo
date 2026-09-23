import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar, Users, Layers,
  AlertTriangle, ChevronRight, FolderKanban, Clock, Pencil, Link2, Trash2, Coins,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { resolveSidebarTeamName } from '../../lib/pmoTeams';
import { PageHeader } from '../../components/layout/PageHeader';
import { isDeepLinkAvailable, buildDeepLink } from '../../lib/deepLink';
import { toast } from '../../hooks/useToast';
import { HealthBadge } from '../../components/common/HealthBadge';
import { ReadOnlyField } from '../../components/common/ReadOnlyField';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { Button } from '../../components/ui/button';
import { DocumentLibrary } from '../../components/projects/DocumentLibrary';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import { useProgram, useUpdateProgram } from '../../hooks/usePrograms';
import { useChangeAudit, type ChangeAuditFieldDiff } from '../../hooks/useChangeAudit';
import { diffEntityUpdate, PROGRAM_FIELD_LABELS } from '../../lib/changeAuditFields';
import { ActivityFeed } from '../../components/common/ActivityFeed';
import { DeleteConfirmDialog, type DeleteChildSummary } from '../../components/common/DeleteConfirmDialog';
import { cascadeDeleteProgram, summarizeProgramDelete } from '../../lib/cascadeDelete';
import { markDeleting, unmarkDeleting } from '../../lib/deletingStore';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import { useQueryClient } from '@tanstack/react-query';
import { useActiveProjects } from '../../hooks/useProjects';
import { listStatusReportsByProjects } from '../../api/statusReports.api';
import { listCustomStatusReportsByProjects } from '../../api/customStatusReports.api';
import { useDataSource, usesCustomTables } from '../../lib/taskSource';
import * as dv from '../../lib/dataverseClient';
import { emitRoleAssigned } from '../../lib/notify';
import { OVERALL_HEALTH, ACCEL_STATE, ACCEL_PRIORITY, PROG_TYPE, PROG_GOALS, PROG_BUSINESS_UNIT, ENTITY_SETS, SETTING_USER_SCOPE_GROUP } from '../../lib/constants';
import { useAppSetting, useAppSettings } from '../../hooks/useAppSettings';
import type { Project } from '../../models/project.model';
import type { ProgramUpdate, Program } from '../../models/program.model';
import { dateInputValue, fmtDateOnly, toDataverseDateOnly } from '../../lib/dateOnly';

// ─── Formatters ──────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

function fmtCurrency(v?: number) { return v != null ? currencyFmt.format(v) : '—'; }
function fmtDate(v?: string) { return fmtDateOnly(v); }

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-xs font-semibold uppercase tracking-widest text-muted-foreground', className)}>
      {children}
    </h3>
  );
}

// ─── Dialog form helpers ──────────────────────────────────────────────────────

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



function TabSectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="pb-4 border-b border-border/60">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
  );
}

// ─── Dialog option sets ───────────────────────────────────────────────────────

const PROG_STATE_OPTIONS = [
  { value: String(ACCEL_STATE.Proposed), label: 'Proposed' },
  { value: String(ACCEL_STATE.Active),   label: 'Active' },
  { value: String(ACCEL_STATE.Closed),   label: 'Closed' },
  { value: String(ACCEL_STATE.OnHold),   label: 'On Hold' },
];
const PROG_PRIORITY_OPTIONS = [
  { value: String(ACCEL_PRIORITY.Critical), label: 'Critical' },
  { value: String(ACCEL_PRIORITY.High),     label: 'High' },
  { value: String(ACCEL_PRIORITY.Moderate), label: 'Moderate' },
  { value: String(ACCEL_PRIORITY.Low),      label: 'Low' },
];
const PROG_HEALTH_OPTIONS = [
  { value: String(OVERALL_HEALTH.OnTrack),  label: 'On Track' },
  { value: String(OVERALL_HEALTH.AtRisk),   label: 'At Risk' },
  { value: String(OVERALL_HEALTH.OffTrack), label: 'Off Track' },
];
const PROG_TYPE_OPTIONS = [
  { value: String(PROG_TYPE.Customer),    label: 'Customer' },
  { value: String(PROG_TYPE.Development), label: 'Development' },
  { value: String(PROG_TYPE.Support),     label: 'Support' },
  { value: String(PROG_TYPE.Enhancement), label: 'Enhancement' },
  { value: String(PROG_TYPE.Program),     label: 'Program' },
  { value: String(PROG_TYPE.Other),       label: 'Other' },
];
const PROG_GOALS_OPTIONS = [
  { value: String(PROG_GOALS.CustomerSatisfaction), label: 'Customer Satisfaction' },
  { value: String(PROG_GOALS.GrowBusiness),         label: 'Grow Business' },
  { value: String(PROG_GOALS.RunBusiness),          label: 'Run Business' },
  { value: String(PROG_GOALS.Transformation),       label: 'Transformation' },
  { value: String(PROG_GOALS.Other),                label: 'Other' },
];
const PROG_BU_OPTIONS = [
  { value: String(PROG_BUSINESS_UNIT.Enteral),        label: 'Enteral' },
  { value: String(PROG_BUSINESS_UNIT.Epic),           label: 'Epic' },
  { value: String(PROG_BUSINESS_UNIT.InfusionLegacy), label: 'Infusion Legacy' },
  { value: String(PROG_BUSINESS_UNIT.Medicare),       label: 'Medicare' },
];

// ─── Program edit dialog ──────────────────────────────────────────────────────

function ProgramEditDialog({
  open, onClose, program, onSave, isPending,
}: {
  open: boolean; onClose: () => void; program: Program;
  onSave: (payload: ProgramUpdate) => void; isPending: boolean;
}) {
  const [activeTab, setActiveTab] = useState('details');

  // Details
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [businessCase, setBusinessCase] = useState('');
  const [startDate, setStartDate]     = useState('');
  const [dueDate, setDueDate]         = useState('');

  // Governance
  const [managerId, setManagerId]         = useState('');
  const [initManagerId, setInitManagerId] = useState('');
  const [state, setState]                 = useState('');
  const [priority, setPriority]           = useState('');
  const [programType, setProgramType]     = useState('');
  const [programGoals, setProgramGoals]   = useState('');
  const [businessUnit, setBusinessUnit]   = useState('');

  // Health
  const [overallHealth, setOverallHealth]     = useState('');
  const [scheduleHealth, setScheduleHealth]   = useState('');
  const [effortHealth, setEffortHealth]       = useState('');
  const [financialHealth, setFinancialHealth] = useState('');

  // Financials
  const [budget, setBudget]   = useState('');
  const [benefit, setBenefit] = useState('');
  const [roi, setRoi]         = useState('');

  const userScopeGroupId = useAppSetting(SETTING_USER_SCOPE_GROUP);

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

  type UserRow = { systemuserid: string; fullname: string; lastname: string; firstname: string };
  const fmtUserName = (u: UserRow) =>
    u.lastname && u.firstname ? `${u.lastname}, ${u.firstname}` : u.fullname;

  const USER_BASE_FILTER = "isdisabled eq false and accessmode ne 4 and accessmode ne 5 and applicationid eq null";

  const searchUsers = useCallback(async (query: string) => {
    const nameFilter = `(contains(lastname,'${query}') or contains(firstname,'${query}') or contains(fullname,'${query}'))`;
    const scopeFilter = scopeTeamId
      ? `teammembership_association/any(t: t/teamid eq '${scopeTeamId}') and `
      : '';
    const users = await dv.list<UserRow>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid', 'fullname', 'lastname', 'firstname'],
      $filter: `${scopeFilter}${USER_BASE_FILTER} and ${nameFilter}`,
      $orderby: 'lastname asc,firstname asc',
      $top: 50,
    });
    return users.map((u) => ({ value: u.systemuserid, label: fmtUserName(u) }));
  }, [scopeTeamId]);

  const resolveUserLabel = useCallback(async (id: string) => {
    const u = await dv.get<UserRow>(ENTITY_SETS.systemUser, id, ['systemuserid', 'fullname', 'lastname', 'firstname']);
    return fmtUserName(u);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab('details');
    setName(program.msdyn_name ?? '');
    setDescription(program.msdyn_description ?? '');
    setBusinessCase(program.msdyn_businesscase ?? '');
    setStartDate(dateInputValue(program.proj_programstart));
    setDueDate(dateInputValue(program.proj_programdue));
    const initMgr = program['_proj_manager_value'] ?? '';
    setManagerId(initMgr);
    setInitManagerId(initMgr);
    setState(program.proj_state != null ? String(program.proj_state) : '');
    setPriority(program.proj_priority != null ? String(program.proj_priority) : '');
    setProgramType(program.proj_programtype != null ? String(program.proj_programtype) : '');
    setProgramGoals(program.proj_programgoals != null ? String(program.proj_programgoals) : '');
    setBusinessUnit(program.proj_businessunit != null ? String(program.proj_businessunit) : '');
    setOverallHealth(program.proj_overallhealth   != null ? String(program.proj_overallhealth)   : '');
    setScheduleHealth(program.proj_schedulehealth != null ? String(program.proj_schedulehealth) : '');
    setEffortHealth(program.proj_efforthealth     != null ? String(program.proj_efforthealth)   : '');
    setFinancialHealth(program.proj_financialhealth != null ? String(program.proj_financialhealth) : '');
    setBudget(program.msdyn_budget?.toString() ?? '');
    setBenefit(program.msdyn_benefit?.toString() ?? '');
    setRoi(program.msdyn_roi?.toString() ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, program.msdyn_projectprogramid]);

  function handleSave() {
    const numOrNull  = (s: string): number | null    => (s && s !== '__none__') ? Number(s) : null;
    const numOrUndef = (s: string): number | undefined => s.trim() ? Number(s) : undefined;

    const payload: ProgramUpdate = {
      msdyn_name:        name.trim(),
      msdyn_description: description || undefined,
      msdyn_businesscase: businessCase || undefined,
      proj_programstart: toDataverseDateOnly(startDate) ?? undefined,
      proj_programdue:   toDataverseDateOnly(dueDate) ?? undefined,
      proj_state:        numOrNull(state),
      proj_priority:     numOrNull(priority),
      proj_programtype:  numOrNull(programType),
      proj_programgoals: numOrNull(programGoals),
      proj_businessunit: numOrNull(businessUnit),
      proj_overallhealth:   numOrNull(overallHealth),
      proj_schedulehealth:  numOrNull(scheduleHealth),
      proj_efforthealth:    numOrNull(effortHealth),
      proj_financialhealth: numOrNull(financialHealth),
      msdyn_budget:  numOrUndef(budget),
      msdyn_benefit: numOrUndef(benefit),
      msdyn_roi:     numOrUndef(roi),
    };

    if (managerId !== initManagerId) {
      payload['proj_Manager@odata.bind'] = managerId ? `/systemusers(${managerId})` : null;
    }

    onSave(payload);
    // Notify newly-assigned Program Manager (skip self-assign). Program
    // reuses proj_Manager as the program manager role.
    if (managerId && managerId !== initManagerId) {
      void emitRoleAssigned({ assigneeUserId: managerId, actorUserId: dv.getCurrentUserId(), role: 'Program Manager', entityKind: 'program', entityId: program.msdyn_projectprogramid, entityName: program.msdyn_name });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl flex flex-col overflow-hidden" style={{ maxHeight: '88vh' }}>
        <DialogHeader className="shrink-0 pb-0">
          <DialogTitle>Edit Program</DialogTitle>
          <DialogDescription>
            Update program details, governance, health indicators, and financial targets.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden mt-2">
          <TabsList className="shrink-0 bg-muted/30 w-full justify-start rounded-none border-b border-border/60 h-auto p-0 gap-0">
            {(['details', 'governance', 'financials'] as const).map((t) => (
              <TabsTrigger
                key={t}
                value={t}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent capitalize px-4 py-2.5 text-sm"
              >
                {t === 'details' ? 'Details' : t === 'governance' ? 'Governance' : 'Financials'}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── DETAILS TAB ── */}
          <TabsContent value="details" className="flex-1 overflow-y-auto px-1 py-4 space-y-4 mt-0">
            <TabSectionHeader
              title="Program Details"
              description="Core identification, description, business case, and schedule."
            />
            <FormRow label="Program Name *">
              <FormInput value={name} onChange={setName} placeholder="Program name" />
            </FormRow>
            <FormRow label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                placeholder="Brief program description..." />
            </FormRow>
            <FormRow label="Business Case">
              <Textarea value={businessCase} onChange={(e) => setBusinessCase(e.target.value)} rows={5}
                placeholder="Business justification and expected outcomes..." />
            </FormRow>
            <div className="grid grid-cols-2 gap-4">
              <FormRow label="Start Date">
                <FormInput type="date" value={startDate} onChange={setStartDate} />
              </FormRow>
              <FormRow label="Due Date">
                <FormInput type="date" value={dueDate} onChange={setDueDate} />
              </FormRow>
            </div>
          </TabsContent>

          {/* ── GOVERNANCE TAB ── */}
          <TabsContent value="governance" className="flex-1 overflow-y-auto px-1 py-4 space-y-5 mt-0">
            <TabSectionHeader
              title="Governance & Health"
              description="Program manager, lifecycle state, priority, and health indicators."
            />
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Ownership</p>
              <FormRow label="Program Manager">
                <SearchableSelect value={managerId} onChange={setManagerId} onSearch={searchUsers} resolveLabel={resolveUserLabel} placeholder="— None —" />
              </FormRow>
              <div className="grid grid-cols-2 gap-4">
                <FormRow label="State">
                  <FormSelect value={state} onChange={setState} options={PROG_STATE_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Priority">
                  <FormSelect value={priority} onChange={setPriority} options={PROG_PRIORITY_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Program Type">
                  <FormSelect value={programType} onChange={setProgramType} options={PROG_TYPE_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Goals">
                  <FormSelect value={programGoals} onChange={setProgramGoals} options={PROG_GOALS_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Business Unit">
                  <FormSelect value={businessUnit} onChange={setBusinessUnit} options={PROG_BU_OPTIONS} placeholder="Not set" />
                </FormRow>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
                Selecting "None" for a currently-assigned field will clear that assignment on save.
              </p>
            </div>

            <div className="space-y-4 border-t border-border/60 pt-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Health Indicators</p>
              <div className="grid grid-cols-2 gap-4">
                <FormRow label="Overall Health">
                  <FormSelect value={overallHealth} onChange={setOverallHealth} options={PROG_HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Schedule Health">
                  <FormSelect value={scheduleHealth} onChange={setScheduleHealth} options={PROG_HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Effort Health">
                  <FormSelect value={effortHealth} onChange={setEffortHealth} options={PROG_HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
                <FormRow label="Financial Health">
                  <FormSelect value={financialHealth} onChange={setFinancialHealth} options={PROG_HEALTH_OPTIONS} placeholder="Not set" />
                </FormRow>
              </div>
            </div>
          </TabsContent>

          {/* ── FINANCIALS TAB ── */}
          <TabsContent value="financials" className="flex-1 overflow-y-auto px-1 py-4 space-y-4 mt-0">
            <TabSectionHeader
              title="Financial Targets"
              description="Program-level budget, expected benefits, and ROI target."
            />
            <div className="grid grid-cols-3 gap-4">
              <FormRow label="Budget ($)">
                <FormInput type="number" value={budget} onChange={setBudget} placeholder="0" />
              </FormRow>
              <FormRow label="Benefits ($)">
                <FormInput type="number" value={benefit} onChange={setBenefit} placeholder="0" />
              </FormRow>
              <FormRow label="ROI (%)">
                <FormInput type="number" value={roi} onChange={setRoi} placeholder="0" />
              </FormRow>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
              Project Budget, Actual Cost, Remaining Budget, and Project Benefits are rollup values
              computed by the PMO Accelerator from member project financials and cannot be edited directly.
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 border-t border-border/60 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button disabled={!name.trim() || isPending} onClick={handleSave}>
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, accent }: {
  label: string;
  value: string | number;
  accent?: 'emerald' | 'amber' | 'rose';
}) {
  const textColor =
    accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
    accent === 'amber'   ? 'text-amber-600 dark:text-amber-400' :
    accent === 'rose'    ? 'text-rose-600 dark:text-rose-400' :
    'text-foreground';
  return (
    <div className="text-center px-4 py-3">
      <p className={cn('text-2xl font-bold tabular-nums leading-none', textColor)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function StatusFreshness({ daysAgo }: { daysAgo: number | null }) {
  if (daysAgo === null)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-rose-500/80 whitespace-nowrap">
        <Clock className="h-2.5 w-2.5" />No reports
      </span>
    );
  if (daysAgo <= 14)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
        <Clock className="h-2.5 w-2.5" />{daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
      </span>
    );
  if (daysAgo <= 30)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
        <Clock className="h-2.5 w-2.5" />{daysAgo}d ago
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-rose-500/80 whitespace-nowrap">
      <Clock className="h-2.5 w-2.5" />Stale ({daysAgo}d)
    </span>
  );
}

function ProjectRow({ project, onClick, reportDaysAgo }: {
  project: Project;
  onClick: () => void;
  reportDaysAgo?: number | null;
}) {
  const { data: appSettings = [] } = useAppSettings();
  const pct = normPct(project.msdyn_progress);
  const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-primary' : 'bg-amber-500';
  const isOverdue = project.msdyn_finish && new Date(project.msdyn_finish) < new Date() && pct < 100;

  return (
    <button
      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left group"
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{project.msdyn_subject}</span>
          <HealthBadge value={project.proj_overallhealth} size="sm" />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {project['_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue'] && (
            <span>{project['_msdyn_projectmanager_value@OData.Community.Display.V1.FormattedValue']}</span>
          )}
          {(() => {
            const raw = project['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
            const id = project._pmo_primaryteam_value;
            if (!raw) return null;
            const label = id ? resolveSidebarTeamName(id, raw, appSettings) : raw;
            return <span>{label}</span>;
          })()}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {reportDaysAgo !== undefined && <StatusFreshness daysAgo={reportDaysAgo} />}
        <div className="w-20">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={cn('h-full rounded-full', barColor)} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-7 text-right">{pct}%</span>
          </div>
        </div>
        {project.msdyn_finish && (
          <span className={cn('text-xs whitespace-nowrap', isOverdue ? 'text-rose-500 font-medium' : 'text-muted-foreground')}>
            {fmtDate(project.msdyn_finish)}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ProgramDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Intake-queue notifications pass { from: 'intake' } so the Back button
  // returns to the queue rather than the programs list.
  const backState = location.state as { from?: string } | null;
  const backTarget = backState?.from === 'intake' ? '/intake' : '/programs';
  const adminRole = useEffectiveAdminRole();
  const qc = useQueryClient();
  const [filterStale, setFilterStale] = useState(false);
  const [activeProgramTab, setActiveProgramTab] = useState<'overview' | 'documents' | 'activity'>('overview');
  const [editProgramOpen, setEditProgramOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteSummary, setDeleteSummary] = useState<DeleteChildSummary[] | undefined>(undefined);
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false);

  const { data: program, isLoading, error } = useProgram(id);
  const updateMutation = useUpdateProgram(id ?? '');
  const auditChange = useChangeAudit();
  const { data: allProjects = [] } = useActiveProjects();
  const dataSource = useDataSource();

  // Filter projects belonging to this program
  const programProjects = allProjects.filter(
    (p) => p._msdyn_program_value === id
  );

  // ── Resourcing rollups (labor hours) ──────────────────────────────────────
  // Aggregate the New-Resource-Model labor stats across the program's projects.
  // Only projects on the new model contribute (others have no per-task hours).
  const laborProjects = programProjects.filter((p) => p.pmo_usenewresourcemodel === true);
  const laborForecast = laborProjects.reduce((sum, p) => sum + (p.pmo_forecastedlaborhours ?? 0), 0);
  const laborTotal = laborProjects.reduce((sum, p) => sum + (p.pmo_currenttotalhours ?? 0), 0);
  const laborCompleted = laborProjects.reduce((sum, p) => sum + (p.pmo_currentcompletedhours ?? 0), 0);
  const hasLaborData = laborProjects.length > 0 && (laborForecast > 0 || laborTotal > 0 || laborCompleted > 0);

  // ── Local rollups ─────────────────────────────────────────────────────────────
  // Compute local rollups from project data as fallback
  const localOnTrack  = programProjects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.OnTrack).length;
  const localAtRisk   = programProjects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.AtRisk).length;
  const localOffTrack = programProjects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.OffTrack).length;
  const localAvgProgress = programProjects.length > 0
    ? Math.round(programProjects.reduce((s, p) => s + normPct(p.msdyn_progress), 0) / programProjects.length)
    : 0;

  const { data: programStatusReports = [] } = useQuery({
    queryKey: ['statusReports', 'program', dataSource, id],
    queryFn: () => {
      const ids = programProjects.map((p) => p.msdyn_projectid);
      return usesCustomTables(dataSource)
        ? listCustomStatusReportsByProjects(ids)
        : listStatusReportsByProjects(ids);
    },
    enabled: programProjects.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const latestReportByProject = new Map<string, number>();
  for (const report of programStatusReports) {
    const projectId = report['_msdyn_project_value'];
    if (!projectId || latestReportByProject.has(projectId)) continue;
    const date = report.proj_reportingdate ?? report.createdon ?? '';
    const daysAgo = date ? Math.round((Date.now() - new Date(date).getTime()) / 86400000) : Infinity;
    latestReportByProject.set(projectId, daysAgo);
  }

  const staleCount = programStatusReports.length > 0
    ? programProjects.filter((p) => {
        const days = latestReportByProject.get(p.msdyn_projectid);
        return days === undefined || days > 30;
      }).length
    : 0;

  if (isLoading) return <LoadingOverlay isLoading label="Loading program..." />;

  // Use Dataverse rollups when available, fallback to computed
  const activeCount   = program?.proj_activeprojects ?? programProjects.length;
  const onTrackCount  = program?.proj_projectsontrack ?? localOnTrack;
  const atRiskCount   = program?.proj_projectsatrisk ?? localAtRisk;
  const offTrackCount = program?.proj_projectsintrouble ?? localOffTrack;
  const unhealthyCount = atRiskCount + offTrackCount;

  return (
    <div className="space-y-5">
      <PageHeader
        title={program?.msdyn_name ?? 'Program Detail'}
        subtitle={program?.pmo_programid}
        showBack
        onBack={() => navigate(backTarget)}
        actions={program && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditProgramOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit Program
            </Button>
            {isDeepLinkAvailable() && (
              <Button size="sm" variant="outline" onClick={() => {
                const link = buildDeepLink({ page: 'programs', id: id! });
                if (link) { navigator.clipboard.writeText(link); toast.success('Link copied'); }
              }}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" />Copy Link
              </Button>
            )}
            {(adminRole === 'pmo_admin' || adminRole === 'system_admin') && (
              <Button size="sm" variant="destructive" onClick={async () => {
                if (!id) return;
                setDeleteSummary(undefined);
                setDeleteSummaryLoading(true);
                setDeleteDialogOpen(true);
                try {
                  setDeleteSummary(await summarizeProgramDelete(id));
                } finally {
                  setDeleteSummaryLoading(false);
                }
              }}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
              </Button>
            )}
          </div>
        )}
      />
      <ErrorBanner error={error as Error | null} />

      {program && (
        <>
          {/* ── Identity card ── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-6 py-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  {/* Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <HealthBadge value={program.proj_overallhealth} />
                    {program['proj_state@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary ring-1 ring-primary/20">
                        {program['proj_state@OData.Community.Display.V1.FormattedValue']}
                      </span>
                    )}
                    {program['proj_priority@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                        {program['proj_priority@OData.Community.Display.V1.FormattedValue']} Priority
                      </span>
                    )}
                    {program['proj_programtype@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground ring-1 ring-border">
                        {program['proj_programtype@OData.Community.Display.V1.FormattedValue']}
                      </span>
                    )}
                  </div>
                  {/* Meta pills */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    {program['_proj_manager_value@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5 shrink-0" />
                        {program['_proj_manager_value@OData.Community.Display.V1.FormattedValue']}
                      </span>
                    )}
                    {program['proj_businessunit@OData.Community.Display.V1.FormattedValue'] && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        {program['proj_businessunit@OData.Community.Display.V1.FormattedValue']}
                      </span>
                    )}
                    {(program.proj_programstart || program.proj_programdue) && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        {fmtDate(program.proj_programstart)} – {fmtDate(program.proj_programdue)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Project count + progress */}
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <p className="text-3xl font-bold text-foreground tabular-nums leading-none">
                    {activeCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Active Projects</p>
                  {programProjects.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Avg. {localAvgProgress}% complete
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Health stats bar */}
            <div className="border-t border-border bg-muted/20 grid grid-cols-4 divide-x divide-border">
              <StatCard label="On Track" value={onTrackCount} accent={onTrackCount > 0 ? 'emerald' : undefined} />
              <StatCard label="At Risk" value={atRiskCount} accent={atRiskCount > 0 ? 'amber' : undefined} />
              <StatCard label="Off Track" value={offTrackCount} accent={offTrackCount > 0 ? 'rose' : undefined} />
              <StatCard
                label={unhealthyCount > 0 ? 'Need Attention' : 'All Healthy'}
                value={unhealthyCount > 0 ? unhealthyCount : '\u2713'}
                accent={unhealthyCount > 0 ? 'rose' : 'emerald'}
              />
            </div>
          </div>

          {/* ── Tabbed surface ── */}
          <Tabs value={activeProgramTab} onValueChange={(v) => setActiveProgramTab(v as typeof activeProgramTab)}>
            <div className="overflow-x-auto">
              <TabsList className="bg-muted/30 flex w-max min-w-full">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-6">
          {/* ── Content grid ── */}
          <div className="grid grid-cols-12 gap-5">

            {/* LEFT: Projects in program */}
            <div className="col-span-12 lg:col-span-7 space-y-5">
              {/* Description */}
              {program.msdyn_description && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <SectionLabel className="mb-3">Description</SectionLabel>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {program.msdyn_description}
                  </p>
                </div>
              )}

              {/* Project list */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Projects</h2>
                    <span className="text-xs font-medium text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
                      {programProjects.length}
                    </span>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="text-xs text-muted-foreground h-7"
                    onClick={() => navigate('/projects')}
                  >
                    All projects <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                  </Button>
                </div>

                {programProjects.length === 0 ? (
                  <div className="p-8 text-center">
                    <FolderKanban className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">No projects in this program</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Assign projects to this program using the project Edit dialog.
                    </p>
                  </div>
                ) : (() => {
                  const sorted = [...programProjects].sort((a, b) => {
                    const ha = a.proj_overallhealth ?? 0;
                    const hb = b.proj_overallhealth ?? 0;
                    if (hb !== ha) return hb - ha;
                    return a.msdyn_subject.localeCompare(b.msdyn_subject);
                  });
                  const displayed = filterStale
                    ? sorted.filter((p) => {
                        const days = latestReportByProject.get(p.msdyn_projectid);
                        return days === undefined || days > 30;
                      })
                    : sorted;
                  return (
                    <>
                      {filterStale && (
                        <div className="px-5 py-2 bg-rose-500/6 border-b border-rose-500/15 flex items-center justify-between">
                          <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                            Showing {displayed.length} project{displayed.length !== 1 ? 's' : ''} with stale or missing reports
                          </span>
                          <button
                            onClick={() => setFilterStale(false)}
                            className="text-xs text-rose-600 dark:text-rose-400 hover:underline underline-offset-2"
                          >
                            Clear filter
                          </button>
                        </div>
                      )}
                      <div className="divide-y divide-border/50">
                        {displayed.length === 0 ? (
                          <div className="px-5 py-4 text-xs text-muted-foreground">All projects have recent status reports.</div>
                        ) : displayed.map((p) => (
                          <ProjectRow
                            key={p.msdyn_projectid}
                            project={p}
                            onClick={() => navigate(`/projects/${p.msdyn_projectid}`, { state: { from: 'program', programId: id } })}
                            reportDaysAgo={latestReportByProject.has(p.msdyn_projectid)
                              ? latestReportByProject.get(p.msdyn_projectid)!
                              : null}
                          />
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Business Case */}
              {program.msdyn_businesscase && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <SectionLabel className="mb-3">Business Case</SectionLabel>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {program.msdyn_businesscase}
                  </p>
                </div>
              )}
              {/* Resourcing — labor hours rollup + financial metrics. Schedule
                  Signals removed 2026 per operator directive (low value). */}
              {(hasLaborData || program.msdyn_budget != null || program.proj_projectbudget != null) ? (
                <div className="rounded-xl border border-border bg-card p-5 space-y-5">
                  <div className="flex items-center gap-2 pb-3 border-b border-border">
                    <Coins className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Resourcing</h2>
                  </div>

                  {/* Labor Hours */}
                  {hasLaborData && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Labor Hours</p>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { label: 'Forecast', value: laborForecast },
                          { label: 'Total', value: laborTotal },
                          { label: 'Completed', value: laborCompleted },
                        ]).map(({ label, value }) => (
                          <div key={label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center">
                            <p className="text-lg font-bold text-foreground tabular-nums leading-none">{value.toLocaleString()}<span className="text-xs font-medium text-muted-foreground">h</span></p>
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{label}</p>
                          </div>
                        ))}
                      </div>
                      {laborTotal > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                            <span>Hours completed</span>
                            <span className="font-semibold text-foreground">{Math.min(100, Math.round((laborCompleted / laborTotal) * 100))}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (laborCompleted / laborTotal) * 100)}%` }} />
                          </div>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground">Across {laborProjects.length} project{laborProjects.length === 1 ? '' : 's'} on the New Resource Model.</p>
                    </div>
                  )}

                  {/* Financial Metrics */}
                  {(program.msdyn_budget != null || program.proj_projectbudget != null) && (
                    <div className={cn('space-y-2', hasLaborData && 'border-t border-border/40 pt-4')}>
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Financial Metrics</p>
                      <div className="space-y-0.5">
                        {([
                          { label: 'Program Budget',   value: program.msdyn_budget },
                          { label: 'Project Budget',   value: program.proj_projectbudget },
                          { label: 'Actual Cost',      value: program.proj_projectactualcost },
                          { label: 'Remaining Budget', value: program.proj_remainingbudget },
                          { label: 'Benefits',         value: program.proj_projectbenefits ?? program.msdyn_benefit },
                          { label: 'ROI',              value: program.msdyn_roi },
                        ] as { label: string; value?: number }[])
                          .filter(f => f.value != null)
                          .map(({ label, value }) => (
                            <div key={label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                              <span className="text-xs text-muted-foreground">{label}</span>
                              <span className={cn(
                                'text-sm font-semibold tabular-nums',
                                label === 'ROI' && value != null
                                  ? value >= 0 ? 'text-emerald-500' : 'text-rose-500'
                                  : 'text-foreground'
                              )}>
                                {label === 'ROI' && value != null ? `${value.toFixed(1)}%` : fmtCurrency(value)}
                              </span>
                            </div>
                          ))
                        }
                      </div>
                      {program.proj_projectbudget != null && program.proj_projectactualcost != null && program.proj_projectbudget > 0 && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                            <span>Budget utilization</span>
                            <span className="font-semibold text-foreground">{Math.min(100, Math.round((program.proj_projectactualcost / program.proj_projectbudget) * 100))}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn('h-full rounded-full',
                                (program.proj_projectactualcost / program.proj_projectbudget) > 0.9 ? 'bg-rose-500' :
                                (program.proj_projectactualcost / program.proj_projectbudget) > 0.7 ? 'bg-amber-500' :
                                'bg-emerald-500'
                              )}
                              style={{ width: `${Math.min(100, (program.proj_projectactualcost / program.proj_projectbudget) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

            </div>

            {/* RIGHT: Health, financials, governance */}
            <div className="col-span-12 lg:col-span-5 space-y-5">

              {/* Health indicators */}
              {[program.proj_overallhealth, program.proj_efforthealth, program.proj_schedulehealth, program.proj_financialhealth].some(v => v != null) && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <SectionLabel className="mb-3">Health Indicators</SectionLabel>
                  <div className="space-y-0.5">
                    {[
                      { label: 'Overall',   value: program.proj_overallhealth },
                      { label: 'Schedule',  value: program.proj_schedulehealth },
                      { label: 'Effort',    value: program.proj_efforthealth },
                      { label: 'Financial', value: program.proj_financialhealth },
                    ].filter(h => h.value != null).map(h => (
                      <div key={h.label} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                        <span className="text-xs text-muted-foreground">{h.label}</span>
                        <HealthBadge value={h.value} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}


              {/* Governance & classification */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel className="mb-0">Governance</SectionLabel>
                  <button
                    onClick={() => setEditProgramOpen(true)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <Pencil className="h-3 w-3" />Edit
                  </button>
                </div>
                <div className="space-y-3">
                  <ReadOnlyField label="Program Manager" value={program['_proj_manager_value@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="State" value={program['proj_state@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="Priority" value={program['proj_priority@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="Type" value={program['proj_programtype@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="Goals" value={program['proj_programgoals@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="Business Unit" value={program['proj_businessunit@OData.Community.Display.V1.FormattedValue']} />
                  <ReadOnlyField label="Start Date" value={fmtDate(program.proj_programstart)} />
                  <ReadOnlyField label="Due Date" value={fmtDate(program.proj_programdue)} />
                </div>
              </div>

              {/* Unhealthy projects alert */}
              {unhealthyCount > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {unhealthyCount} project{unhealthyCount !== 1 ? 's' : ''} need attention
                      </p>
                      <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                        {atRiskCount > 0 && `${atRiskCount} at risk`}
                        {atRiskCount > 0 && offTrackCount > 0 && ', '}
                        {offTrackCount > 0 && `${offTrackCount} off track`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Stale status reports alert — click to filter project list */}
              {staleCount > 0 && (
                <button
                  onClick={() => setFilterStale(!filterStale)}
                  className={cn(
                    'w-full rounded-xl border p-4 text-left transition-all',
                    filterStale
                      ? 'border-rose-500/60 bg-rose-500/15 ring-1 ring-rose-500/30'
                      : 'border-rose-500/30 bg-rose-500/8 hover:border-rose-500/50 hover:bg-rose-500/12'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Clock className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                        {staleCount} project{staleCount !== 1 ? 's' : ''} missing recent status
                      </p>
                      <p className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-0.5">
                        {filterStale ? 'Click to show all projects' : 'Click to show only affected projects →'}
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>

            </TabsContent>

            <TabsContent value="documents" className="mt-6">
          {/* Documents */}
          <div className="mt-1">
            <DocumentLibrary
              recordType="Program"
              recordId={id!}
              recordName={program.msdyn_name ?? ''}
              programId={id}
              aggregateFromProjects={programProjects.map((p) => ({
                projectId: p.msdyn_projectid,
                projectName: p.msdyn_subject ?? 'Untitled Project',
              }))}
            />
          </div>
            </TabsContent>

            <TabsContent value="activity" className="mt-6 space-y-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Activity</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every change made to this program, its {programProjects.length} project{programProjects.length === 1 ? '' : 's'}, and their tasks. Most recent first.
                </p>
              </div>
              {/* Three side-by-side columns, one per entity level. The
                  underlying ActivityFeed hits one Dataverse query per
                  scope; the three columns share the same program scope
                  and just filter client-side by entityType. */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Program
                  </h3>
                  <ActivityFeed
                    scope={{ kind: 'program', programId: id!, childProjectIds: programProjects.map((pp) => pp.msdyn_projectid) }}
                    entityTypeFilter={['program']}
                    emptyMessage="No program-level edits yet."
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Projects
                  </h3>
                  <ActivityFeed
                    scope={{ kind: 'program', programId: id!, childProjectIds: programProjects.map((pp) => pp.msdyn_projectid) }}
                    entityTypeFilter={['project']}
                    emptyMessage="No project-level edits yet."
                  />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tasks
                  </h3>
                  <ActivityFeed
                    scope={{ kind: 'program', programId: id!, childProjectIds: programProjects.map((pp) => pp.msdyn_projectid) }}
                    entityTypeFilter={['task']}
                    emptyMessage="No task-level edits yet."
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {program && (
        <ProgramEditDialog
          open={editProgramOpen}
          onClose={() => setEditProgramOpen(false)}
          program={program}
          isPending={updateMutation.isPending}
          onSave={(payload) => {
            updateMutation.mutate(payload, {
              onSuccess: () => {
                const before = program as unknown as Record<string, unknown>;
                const after = payload as unknown as Record<string, unknown>;
                const changes: ChangeAuditFieldDiff[] = diffEntityUpdate(before, after, PROGRAM_FIELD_LABELS);
                if (changes.length > 0) {
                  auditChange({
                    entityType: 'program',
                    entityId: id!,
                    entityName: program.msdyn_name ?? '(program)',
                    action: 'update',
                    changes,
                  });
                }
                setEditProgramOpen(false);
              },
            });
          }}
        />
      )}

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete program"
        recordName={program?.msdyn_name ?? ''}
        childSummary={deleteSummary}
        childSummaryLoading={deleteSummaryLoading}
        extraWarning="This PERMANENTLY DELETES the program, its originating intake request, AND every project under it (plus each project's own intake request) AND every project's tasks, risks, issues, status reports, baselines, gates, artifacts, decisions, closeouts, document links, meeting links, notifications, and telemetry events. There is no undo. This is the largest delete in the app."
        onConfirm={async () => {
          if (!id) return;
          const programName = program?.msdyn_name ?? 'Program';
          // Optimistic delete (matches ProjectDetailPage): close the dialog,
          // mark the program deleting so the list drops it immediately, bounce
          // to /programs, and run the (potentially large) cascade in the
          // background. On failure we toast + invalidate so the row returns.
          setDeleteDialogOpen(false);
          markDeleting(id);
          navigate('/programs');
          cascadeDeleteProgram(id)
            .then(async () => {
              auditChange({ entityType: 'program', entityId: id, entityName: programName, action: 'delete' });
              toast.success('Program deleted');
              await qc.invalidateQueries({ queryKey: ['programs'] });
              await qc.invalidateQueries({ queryKey: ['projects'] });
              await qc.invalidateQueries({ queryKey: ['projectRequests'] });
              await qc.invalidateQueries({ queryKey: ['pendingApprovals'] });
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : 'Delete failed';
              toast.error(`Failed to delete ${programName}: ${msg}`);
              qc.invalidateQueries({ queryKey: ['programs'] });
            })
            .finally(() => { unmarkDeleting(id); });
        }}
      />
    </div>
  );
}
