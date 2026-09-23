import { useState } from 'react';
import {
  AlertTriangle, Plus, Trash2,
  Calendar, User, ChevronDown, ChevronUp, Pencil, Clock, Target,
  FileText, Loader2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import type { ProjectRisk } from '../../models/projectRisk.model';
import type { ProjectIssue } from '../../models/projectIssue.model';
import type { ProjectChange } from '../../models/projectChange.model';
import { DecisionWorkspace } from './DecisionWorkspace';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';
import { fmtDateOnly } from '../../lib/dateOnly';

function fmtDate(v?: string) { return fmtDateOnly(v); }
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function fmtCurrency(v?: number) { return v != null ? currencyFmt.format(v) : '—'; }

function riskSeverityStyle(exposure?: number, impact?: number) {
  const score = exposure ?? (impact != null ? impact * 20 : undefined);
  if (score == null) return { border: 'border-border', badge: 'bg-muted/40 text-muted-foreground', label: 'Unknown' };
  if (score >= 60) return { border: 'border-rose-500/30', badge: 'bg-rose-500/12 text-rose-700 dark:text-rose-300', label: 'High' };
  if (score >= 30) return { border: 'border-amber-500/30', badge: 'bg-amber-500/12 text-amber-700 dark:text-amber-300', label: 'Medium' };
  return { border: 'border-emerald-500/20', badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', label: 'Low' };
}

function issuePriorityStyle(formatted?: string) {
  const v = (formatted ?? '').toLowerCase();
  if (v.includes('critical')) return 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20';
  if (v.includes('high')) return 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20';
  if (v.includes('medium')) return 'bg-blue-500/12 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20';
  return 'bg-muted/40 text-muted-foreground ring-1 ring-border';
}

function changeApprovalStyle(formatted?: string) {
  const v = (formatted ?? '').toLowerCase();
  if (v.includes('approved')) return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20';
  if (v.includes('rejected')) return 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20';
  if (v.includes('requested')) return 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20';
  return 'bg-blue-500/12 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/20';
}

// ── Card Components ──

function RiskCard({ risk, onEdit, onDelete, canEdit }: {
  risk: ProjectRisk;
  onEdit?: (r: ProjectRisk) => void;
  onDelete?: (r: ProjectRisk) => void;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const saving = !!(risk as unknown as { _saving?: boolean })._saving;
  const sev = riskSeverityStyle(risk.proj_exposure, risk.proj_impact);
  const hasMitigation = !!(risk.msdyn_mitigationplan || risk.msdyn_contingencyplan);

  return (
    <div className={cn('rounded-xl border bg-card overflow-hidden relative', sev.border)}>
      {saving && (
        <div className="absolute inset-0 bg-card/70 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', sev.badge)}>
                {sev.label} Risk
              </span>
              {risk['proj_state@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {risk['proj_state@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
              {risk['proj_category@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs text-muted-foreground">{risk['proj_category@OData.Community.Display.V1.FormattedValue']}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground leading-snug">{risk.msdyn_subject ?? risk.msdyn_name}</p>
            {risk.msdyn_description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{risk.msdyn_description}</p>
            )}
          </div>
          <div className="shrink-0 flex items-start gap-1.5">
            {risk.proj_exposure != null && (
              <div className="text-center mr-2">
                <p className={cn('text-xl font-bold tabular-nums leading-none',
                  risk.proj_exposure >= 60 ? 'text-rose-500' :
                  risk.proj_exposure >= 30 ? 'text-amber-500' : 'text-emerald-500'
                )}>
                  {risk.proj_exposure.toFixed(0)}%
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Exposure</p>
              </div>
            )}
            {onEdit && canEdit && (
              <button onClick={() => onEdit(risk)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Edit risk">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && canEdit && (
              <button onClick={() => onDelete(risk)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete risk">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {risk.proj_impact != null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Impact</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className={cn('h-2.5 w-1.5 rounded-sm', i < (risk.proj_impact ?? 0) ? 'bg-rose-500' : 'bg-muted')} />
                ))}
              </div>
              <span className="text-foreground font-medium">{risk.proj_impact}/5</span>
            </div>
          )}
          {risk.proj_probability != null && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Probability</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className={cn('h-2.5 w-1.5 rounded-sm', i < (risk.proj_probability ?? 0) ? 'bg-amber-500' : 'bg-muted')} />
                ))}
              </div>
              <span className="text-foreground font-medium">{risk.proj_probability}/5</span>
            </div>
          )}
          {risk['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'] && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{risk['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue']}</span>
            </div>
          )}
          {risk.proj_due && (
            <div className={cn('flex items-center gap-1.5', new Date(risk.proj_due) < new Date() ? 'text-rose-500' : 'text-muted-foreground')}>
              <Calendar className="h-3 w-3" />
              <span>{fmtDate(risk.proj_due)}</span>
            </div>
          )}
        </div>
      </div>
      {hasMitigation && (
        <div className="border-t border-border/60">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded((e) => !e)}
          >
            <span className="font-medium">Mitigation & Contingency</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-3">
              {risk.msdyn_mitigationplan && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Mitigation Plan</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{risk.msdyn_mitigationplan}</p>
                </div>
              )}
              {risk.msdyn_contingencyplan && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contingency Plan</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{risk.msdyn_contingencyplan}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IssueCard({ issue, onEdit, onDelete, canEdit }: {
  issue: ProjectIssue;
  onEdit?: (i: ProjectIssue) => void;
  onDelete?: (i: ProjectIssue) => void;
  canEdit: boolean;
}) {
  const saving = !!(issue as unknown as { _saving?: boolean })._saving;
  const priorityClass = issuePriorityStyle(issue['proj_priority@OData.Community.Display.V1.FormattedValue']);
  const isResolved = (issue['proj_state@OData.Community.Display.V1.FormattedValue'] ?? '').toLowerCase().includes('resolved');
  const isBlocking = (issue['proj_state@OData.Community.Display.V1.FormattedValue'] ?? '').toLowerCase().includes('block');

  return (
    <div className={cn('rounded-xl border bg-card overflow-hidden relative', isBlocking ? 'border-rose-500/40' : 'border-border')}>
      {saving && (
        <div className="absolute inset-0 bg-card/70 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {issue['proj_priority@OData.Community.Display.V1.FormattedValue'] && (
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', priorityClass)}>
                  {issue['proj_priority@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
              {isBlocking && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20">
                  <AlertTriangle className="h-3 w-3" />Blocker
                </span>
              )}
              {issue['proj_state@OData.Community.Display.V1.FormattedValue'] && !isBlocking && (
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  isResolved ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-muted/50 text-muted-foreground'
                )}>
                  {issue['proj_state@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
              {issue['proj_issuecategory@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs text-muted-foreground">{issue['proj_issuecategory@OData.Community.Display.V1.FormattedValue']}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground leading-snug">{issue.msdyn_name}</p>
            {issue.msdyn_description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{issue.msdyn_description}</p>
            )}
          </div>
          <div className="shrink-0 flex items-start gap-1">
            {onEdit && canEdit && (
              <button onClick={() => onEdit(issue)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Edit issue">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && canEdit && (
              <button onClick={() => onDelete(issue)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete issue">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {issue['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'] && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{issue['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue']}</span>
            </div>
          )}
          {issue['_proj_requestor_value@OData.Community.Display.V1.FormattedValue'] && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FileText className="h-3 w-3" />
              <span>Requested by {issue['_proj_requestor_value@OData.Community.Display.V1.FormattedValue']}</span>
            </div>
          )}
          {issue.proj_duedate && (
            <div className={cn('flex items-center gap-1.5', new Date(issue.proj_duedate) < new Date() && !isResolved ? 'text-rose-500' : 'text-muted-foreground')}>
              <Calendar className="h-3 w-3" />
              <span>Due {fmtDate(issue.proj_duedate)}</span>
            </div>
          )}
        </div>
      </div>
      {issue.msdyn_resolution && (
        <div className="border-t border-border/60 px-4 py-3 bg-emerald-500/4">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">Resolution</p>
          <p className="text-xs text-foreground leading-relaxed">{issue.msdyn_resolution}</p>
        </div>
      )}
    </div>
  );
}

function ChangeCard({ change, onEdit, onDelete, canEdit }: {
  change: ProjectChange;
  onEdit?: (c: ProjectChange) => void;
  onDelete?: (c: ProjectChange) => void;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const saving = !!(change as unknown as { _saving?: boolean })._saving;
  const approvalClass = changeApprovalStyle(change['proj_approval@OData.Community.Display.V1.FormattedValue']);
  const hasCostImpact = change.proj_costimpact != null && change.proj_costimpact !== 0;
  const hasDetail = !!(change.proj_changebenefits || change.proj_changeplan);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden relative">
      {saving && (
        <div className="absolute inset-0 bg-card/70 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {change['proj_approval@OData.Community.Display.V1.FormattedValue'] && (
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', approvalClass)}>
                  {change['proj_approval@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
              {change['proj_changetype@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
                  {change['proj_changetype@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
              {change['proj_changeimpact@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs text-muted-foreground">{change['proj_changeimpact@OData.Community.Display.V1.FormattedValue']} impact</span>
              )}
              {change['proj_state@OData.Community.Display.V1.FormattedValue'] && (
                <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {change['proj_state@OData.Community.Display.V1.FormattedValue']}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground leading-snug">{change.msdyn_name}</p>
            {change.msdyn_description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{change.msdyn_description}</p>
            )}
          </div>
          <div className="shrink-0 flex items-start gap-1.5">
            {hasCostImpact && (
              <div className="text-right mr-2">
                <p className={cn('text-sm font-bold tabular-nums', (change.proj_costimpact ?? 0) > 0 ? 'text-rose-500' : 'text-emerald-500')}>
                  {fmtCurrency(change.proj_costimpact)}
                </p>
                <p className="text-[10px] text-muted-foreground">Cost impact</p>
              </div>
            )}
            {onEdit && canEdit && (
              <button onClick={() => onEdit(change)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title="Edit change">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && canEdit && (
              <button onClick={() => onDelete(change)} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete change">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {change['_proj_requestedby_value@OData.Community.Display.V1.FormattedValue'] && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Requested by {change['_proj_requestedby_value@OData.Community.Display.V1.FormattedValue']}</span>
            </div>
          )}
          {change['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'] && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Target className="h-3 w-3" />
              <span>Assigned to {change['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue']}</span>
            </div>
          )}
          {change.proj_requesteddate && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Requested {fmtDate(change.proj_requesteddate)}</span>
            </div>
          )}
          {change.proj_plannedduedate && (
            <div className={cn('flex items-center gap-1.5', new Date(change.proj_plannedduedate) < new Date() ? 'text-rose-500' : 'text-muted-foreground')}>
              <Clock className="h-3 w-3" />
              <span>Due {fmtDate(change.proj_plannedduedate)}</span>
            </div>
          )}
        </div>
      </div>
      {hasDetail && (
        <div className="border-t border-border/60">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded((e) => !e)}
          >
            <span className="font-medium">Change detail</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-3">
              {change.proj_changebenefits && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Benefits</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{change.proj_changebenefits}</p>
                </div>
              )}
              {change.proj_changeplan && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Change Plan</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{change.proj_changeplan}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary Header Stat Cell ──

function MonitorStatCell({ label, value, accent, detail }: {
  label: string; value: number; accent?: 'rose' | 'amber' | 'blue' | 'purple'; detail?: string;
}) {
  const textColor =
    accent === 'rose' ? 'text-rose-500' :
    accent === 'amber' ? 'text-amber-500' :
    accent === 'blue' ? 'text-blue-500' :
    accent === 'purple' ? 'text-purple-500' :
    'text-foreground';
  return (
    <div className="px-4 py-3 text-center">
      <p className={cn('text-lg font-bold tabular-nums leading-none', textColor)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      {detail && <p className="text-[10px] text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

// ── Main Component ──

interface MonitorWorkspaceProps {
  projectId: string;
  risks: ProjectRisk[];
  issues: ProjectIssue[];
  changes: ProjectChange[];
  decisions: { length: number };
  onOpenRiskDialog: (risk: ProjectRisk | null) => void;
  onDeleteRisk: (risk: ProjectRisk) => void;
  onOpenIssueDialog: (issue: ProjectIssue | null) => void;
  onDeleteIssue: (issue: ProjectIssue) => void;
  onOpenChangeDialog: (change: ProjectChange | null) => void;
  onDeleteChange: (change: ProjectChange) => void;
  defaultSubTab?: string;
  canEdit: boolean;
}

export function MonitorWorkspace({
  projectId, risks, issues, changes, decisions,
  onOpenRiskDialog, onDeleteRisk,
  onOpenIssueDialog, onDeleteIssue,
  onOpenChangeDialog, onDeleteChange,
  defaultSubTab, canEdit,
}: MonitorWorkspaceProps) {
  const [subTab, setSubTab] = useState(defaultSubTab ?? 'risks');

  const blockerCount = issues.filter((i) =>
    (i['proj_state@OData.Community.Display.V1.FormattedValue'] ?? '').toLowerCase().includes('block')
  ).length;

  const highestExposure = risks.reduce((max, r) => {
    const e = r.proj_exposure ?? (r.proj_impact != null ? r.proj_impact * 20 : 0);
    return Math.max(max, e);
  }, 0);

  const awaitingApproval = changes.filter((c) => {
    const v = (c['proj_approval@OData.Community.Display.V1.FormattedValue'] ?? '').toLowerCase();
    return v.includes('requested');
  }).length;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-4 divide-x divide-border">
          <MonitorStatCell
            label="Active Risks"
            value={risks.length}
            accent={risks.length > 0 ? 'rose' : undefined}
            detail={risks.length > 0 ? `Highest: ${highestExposure.toFixed(0)}%` : undefined}
          />
          <MonitorStatCell
            label="Open Issues"
            value={issues.length}
            accent={issues.length > 0 ? 'amber' : undefined}
            detail={blockerCount > 0 ? `${blockerCount} blocker${blockerCount > 1 ? 's' : ''}` : undefined}
          />
          <MonitorStatCell
            label="Pending Changes"
            value={changes.length}
            accent={changes.length > 0 ? 'blue' : undefined}
            detail={awaitingApproval > 0 ? `${awaitingApproval} awaiting approval` : undefined}
          />
          <MonitorStatCell
            label="Open Decisions"
            value={decisions.length}
            accent={decisions.length > 0 ? 'purple' : undefined}
          />
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="bg-muted/30 h-8 gap-0">
          <TabsTrigger value="risks" className="text-xs h-7 px-3">
            Risks <span className={cn('ml-1 text-[10px]', risks.length === 0 ? 'text-muted-foreground' : '')}>({risks.length})</span>
          </TabsTrigger>
          <TabsTrigger value="issues" className="text-xs h-7 px-3">
            Issues <span className={cn('ml-1 text-[10px]', issues.length === 0 ? 'text-muted-foreground' : '')}>({issues.length})</span>
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-xs h-7 px-3">
            Changes <span className={cn('ml-1 text-[10px]', changes.length === 0 ? 'text-muted-foreground' : '')}>({changes.length})</span>
          </TabsTrigger>
          <TabsTrigger value="decisions" className="text-xs h-7 px-3">
            Decisions <span className={cn('ml-1 text-[10px]', decisions.length === 0 ? 'text-muted-foreground' : '')}>({decisions.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="risks" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">
              {risks.length} risk{risks.length !== 1 ? 's' : ''}{risks.length > 0 ? ' · sorted by severity' : ''}
            </p>
            <Button size="sm" onClick={() => onOpenRiskDialog(null)} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />New Risk
            </Button>
          </div>
          {risks.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">No active risks.{canEdit && <> <button onClick={() => onOpenRiskDialog(null)} className="text-primary hover:underline">+ New Risk</button></>}</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl">
              {[...risks].sort((a, b) => {
                const sa = a.proj_exposure ?? (a.proj_impact != null ? a.proj_impact * 20 : 0);
                const sb = b.proj_exposure ?? (b.proj_impact != null ? b.proj_impact * 20 : 0);
                return sb - sa;
              }).map((r) => (
                <RiskCard
                  key={r.msdyn_projectriskid}
                  risk={r}
                  onEdit={(r) => onOpenRiskDialog(r)}
                  onDelete={onDeleteRisk}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">{issues.length} issue{issues.length !== 1 ? 's' : ''}</p>
            <Button size="sm" onClick={() => onOpenIssueDialog(null)} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />New Issue
            </Button>
          </div>
          {issues.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">No open issues.{canEdit && <> <button onClick={() => onOpenIssueDialog(null)} className="text-primary hover:underline">+ New Issue</button></>}</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl">
              {issues.map((i) => (
                <IssueCard
                  key={i.msdyn_projectissueid}
                  issue={i}
                  onEdit={(i) => onOpenIssueDialog(i)}
                  onDelete={onDeleteIssue}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="changes" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-muted-foreground">{changes.length} change request{changes.length !== 1 ? 's' : ''}</p>
            <Button size="sm" onClick={() => onOpenChangeDialog(null)} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />New Change Request
            </Button>
          </div>
          {changes.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">No change requests.{canEdit && <> <button onClick={() => onOpenChangeDialog(null)} className="text-primary hover:underline">+ New Change Request</button></>}</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-4xl">
              {changes.map((c) => (
                <ChangeCard
                  key={c.msdyn_projectchangeid}
                  change={c}
                  onEdit={(c) => onOpenChangeDialog(c)}
                  onDelete={onDeleteChange}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="decisions" className="mt-4">
          <DecisionWorkspace projectId={projectId} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
