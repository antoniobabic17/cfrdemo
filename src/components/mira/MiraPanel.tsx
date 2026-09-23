/**
 * MiraPanel — Mira assistant panel (Waves 1-3).
 * Route-aware: detects active project or program from URL and offers
 * contextual quick actions (advisory + draft-generation) plus Wave 3
 * approval-gated mutation submission for feedback recording.
 */

import { useState, useCallback } from 'react';
import { useDataSource } from '../../lib/taskSource';
import { isDemoActive } from '../../lib/demoMode';
import { getCurrentUserId } from '../../lib/dataverseClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, AlertTriangle, CheckCircle2, Circle, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';
import {
  loadProjectContext,
  loadProjectOpenTasksContext,
  loadProgramContextEnriched,
  loadStatusContext,
  loadTriageContext,
  explainProjectHealth,
  explainProgramHealth,
  draftWeeklyStatusReport,
  whatAreMyOpenTasks,
  whatNeedsMyAttention,
  whatChangedSinceLastStatusReport,
  whatIsBlockingThisProjectRightNow,
  pmoTriageNeedsAttention,
  reportBug,
  suggestEnhancement,
  draftWbsTaskPlan,
  assessProjectRisk,
  improveStatusReportDraft,
  identifyBlockersOverdueWork,
  prepareBugReportMutation,
  prepareEnhancementSuggestionMutation,
  createBugReportRecord,
  createEnhancementSuggestionRecord,
  prepareRetryMutation,
  type MiraTopicResult,
  type ProjectHealthAdvisory,
  type ProgramHealthAdvisory,
  type StatusReportDraft,
  type OpenTasksAdvisory,
  type NeedsAttentionAdvisory,
  type StatusChangesAdvisory,
  type ProjectBlockersAdvisory,
  type DeliveryAttentionItem,
  type TriageSummary,
  type BugReportDraft,
  type EnhancementSuggestionDraft,
  type WbsTaskPlanDraft,
  type ProjectRiskAssessmentAdvisory,
  type ImprovedStatusReportDraft,
  type BlockersOverdueWorkAdvisory,
  type BugReportMutation,
  type EnhancementSuggestionMutation,
  type HealthSignal,
  type SignalStatus,
  type SourceStatus,
} from '../../ai';
import { useMiraSignalThresholds } from '../../providers/ConfigurationProvider';

// ── Route context detection ──────────────────────────────────────────────────

interface RouteContext {
  type: 'project' | 'program' | 'other';
  id: string | null;
}

function detectRouteContext(pathname: string): RouteContext {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) return { type: 'project', id: projectMatch[1] };
  const programMatch = pathname.match(/^\/programs\/([^/]+)/);
  if (programMatch) return { type: 'program', id: programMatch[1] };
  return { type: 'other', id: null };
}

// ── Signal status icon ───────────────────────────────────────────────────────

function SignalIcon({ status }: { status: SignalStatus }) {
  if (status === 'critical') return <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  if (status === 'warn') return <Circle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
}

function HealthSignalRow({ signal }: { signal: HealthSignal }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <SignalIcon status={signal.status} />
        <span className="text-xs text-muted-foreground truncate">{signal.dimension}</span>
      </div>
      <span className="text-xs font-medium text-foreground shrink-0">{signal.value}</span>
    </div>
  );
}

// ── Health badge ─────────────────────────────────────────────────────────────

function healthBadgeVariant(health: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (health === 'On Track') return 'default';
  if (health === 'At Risk') return 'outline';
  if (health === 'Off Track') return 'destructive';
  return 'secondary';
}

// ── Result renderers ─────────────────────────────────────────────────────────

function AdvisoryResult({ result }: { result: ProjectHealthAdvisory | ProgramHealthAdvisory }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {result.topicId === 'explain-project-health' ? result.projectName : result.programName}
        </span>
        <Badge variant={healthBadgeVariant(result.overallHealth)} className="text-xs h-5">
          {result.overallHealth}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>

      <div>
        <p className="text-xs font-semibold text-foreground mb-1.5">Health Signals</p>
        <div className="bg-muted/40 rounded-md px-3 py-1">
          {result.healthSignals.map((s) => (
            <HealthSignalRow key={s.dimension} signal={s} />
          ))}
        </div>
      </div>

      {result.attentionItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground mb-1.5">What needs attention</p>
          <ul className="space-y-1">
            {result.attentionItems.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <ChevronRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <span className="text-xs text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {'projectRollup' in result && (
        <div className="bg-muted/40 rounded-md px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Portfolio: </span>
          {result.projectRollup.total} projects — {result.projectRollup.onTrack} on track,{' '}
          {result.projectRollup.atRisk} at risk, {result.projectRollup.offTrack} off track
        </div>
      )}

      <SourceStatusSummary sourceStatus={result.sourceStatus} />

      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function DraftResult({
  result,
  onChange,
}: {
  result: StatusReportDraft;
  onChange: (updated: StatusReportDraft) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{result.projectName}</span>
        <Badge variant="outline" className="text-xs h-5">
          Draft
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Reporting period: <span className="text-foreground font-medium">{result.reportingPeriod}</span>
      </p>

      <div className="space-y-0.5">
        <label className="text-xs font-semibold text-foreground">Accomplished Activities</label>
        <Textarea
          className="text-xs min-h-[72px] resize-none"
          value={result.accomplishedActivities}
          onChange={(e) => onChange({ ...result, accomplishedActivities: e.target.value })}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-xs font-semibold text-foreground">Planned Activities</label>
        <Textarea
          className="text-xs min-h-[72px] resize-none"
          value={result.plannedActivities}
          onChange={(e) => onChange({ ...result, plannedActivities: e.target.value })}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-xs font-semibold text-foreground">Additional Comments</label>
        <Textarea
          className="text-xs min-h-[56px] resize-none"
          value={result.additionalComments}
          onChange={(e) => onChange({ ...result, additionalComments: e.target.value })}
        />
      </div>

      <div className="bg-muted/40 rounded-md px-3 py-2">
        <p className="text-xs font-semibold text-foreground mb-1">Source signals</p>
        {result.sourceSignals.map((s, i) => (
          <p key={i} className="text-xs text-muted-foreground">{s}</p>
        ))}
      </div>

      <SourceStatusSummary sourceStatus={result.sourceStatus} />

      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function ConfidenceFooter({
  confidence,
  generatedAt,
}: {
  confidence: string;
  generatedAt: string;
}) {
  return (
    <p className="text-xs text-muted-foreground/60">
      Confidence: {confidence} · {new Date(generatedAt).toLocaleTimeString()}
    </p>
  );
}

function SourceStatusSummary({ sourceStatus }: { sourceStatus: SourceStatus[] }) {
  const failed = sourceStatus.filter((s) => s.state === 'failed');
  const missing = sourceStatus.filter((s) => s.state === 'missing');

  if (failed.length === 0 && missing.length === 0) return null;

  return (
    <div className="rounded-md bg-yellow-500/10 px-3 py-2">
      <p className="text-xs font-semibold text-foreground mb-0.5">Partial data notice</p>
      {failed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Failed sources: {failed.map((s) => s.source).join(', ')}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No-record sources: {missing.map((s) => s.source).join(', ')}
        </p>
      )}
    </div>
  );
}

function TriageResult({ result }: { result: TriageSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">PMO Triage</span>
        <Badge variant="outline" className="text-xs h-5 capitalize">
          {result.scope}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>

      {result.rankedAttentionItems.length > 0 ? (
        <div className="space-y-2">
          {result.rankedAttentionItems.map((item) => (
            <div key={`${item.rank}-${item.entityId ?? item.title}`} className="rounded-md border border-border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">
                  {item.rank}. {item.title}
                </p>
                <Badge variant={item.severity === 'high' ? 'destructive' : item.severity === 'medium' ? 'outline' : 'secondary'} className="text-[10px] h-5 uppercase">
                  {item.severity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Why now: </span>{item.whyNow}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Next: </span>{item.recommendedNextStep}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No urgent items identified from current signals.</p>
      )}

      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function openTaskDueBadgeVariant(dueState: OpenTasksAdvisory['tasks'][number]['dueState']): 'destructive' | 'outline' | 'secondary' {
  if (dueState === 'overdue') return 'destructive';
  if (dueState === 'due-soon') return 'outline';
  return 'secondary';
}

function openTaskDueLabel(task: OpenTasksAdvisory['tasks'][number]): string {
  if (!task.dueDate) return 'No due date';

  const prefix = task.dueState === 'overdue'
    ? 'Overdue'
    : task.dueState === 'due-soon'
      ? 'Due soon'
      : 'Due';

  return `${prefix}: ${new Date(task.dueDate).toLocaleDateString()}`;
}

function OpenTasksResult({ result }: { result: OpenTasksAdvisory }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{result.projectName}</span>
        <Badge variant="outline" className="text-xs h-5">
          {result.openTaskCount} open
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={result.overdueTaskCount > 0 ? 'destructive' : 'secondary'} className="text-[10px] h-5">
          {result.overdueTaskCount} overdue
        </Badge>
        <Badge variant={result.dueSoonTaskCount > 0 ? 'outline' : 'secondary'} className="text-[10px] h-5">
          {result.dueSoonTaskCount} due soon
        </Badge>
        <Badge variant={result.unassignedTaskCount > 0 ? 'outline' : 'secondary'} className="text-[10px] h-5">
          {result.unassignedTaskCount} unassigned
        </Badge>
      </div>

      {result.tasks.length > 0 ? (
        <div className="space-y-2">
          {result.tasks.map((task) => (
            <div key={task.taskId} className="rounded-md border border-border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{task.taskName}</p>
                <div className="flex items-center gap-1.5">
                  {task.isMilestone && (
                    <Badge variant="secondary" className="text-[10px] h-5 uppercase">
                      Milestone
                    </Badge>
                  )}
                  <Badge variant={openTaskDueBadgeVariant(task.dueState)} className="text-[10px] h-5 uppercase">
                    {task.dueState.replace('-', ' ')}
                  </Badge>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Progress: </span>{task.progressPercent}%
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Timeline: </span>{openTaskDueLabel(task)}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Assignees: </span>
                {task.assignees.length > 0 ? task.assignees.join(', ') : 'Unassigned'}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">No active leaf tasks were found in the current project context.</p>
        </div>
      )}

      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function attentionBadgeVariant(severity: DeliveryAttentionItem['severity']): 'destructive' | 'outline' | 'secondary' {
  if (severity === 'high') return 'destructive';
  if (severity === 'medium') return 'outline';
  return 'secondary';
}

function AttentionItemsResult({
  title,
  summary,
  items,
  sourceStatus,
  confidence,
  generatedAt,
}: {
  title: string;
  summary: string;
  items: DeliveryAttentionItem[];
  sourceStatus: SourceStatus[];
  confidence: string;
  generatedAt: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <Badge variant="outline" className="text-xs h-5">
          {items.length} item{items.length === 1 ? '' : 's'}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={`${item.category}-${item.title}-${index}`} className="rounded-md border border-border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <Badge variant={attentionBadgeVariant(item.severity)} className="text-[10px] h-5 uppercase">
                  {item.severity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">Next: </span>
                {item.recommendedAction}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No immediate action items were identified.</p>
      )}

      <SourceStatusSummary sourceStatus={sourceStatus} />
      <ConfidenceFooter confidence={confidence} generatedAt={generatedAt} />
    </div>
  );
}

function StatusChangesResult({ result }: { result: StatusChangesAdvisory }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{result.projectName}</span>
        <Badge variant="outline" className="text-xs h-5">
          Delta view
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>

      {result.baselineDate && (
        <p className="text-xs text-muted-foreground">
          Baseline: <span className="font-medium text-foreground">{new Date(result.baselineDate).toLocaleDateString()}</span>
        </p>
      )}

      <div className="space-y-1.5">
        {result.changeItems.map((item, index) => (
          <div key={`${item.category}-${index}`} className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{item.summary}</p>
          </div>
        ))}
      </div>

      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function FeedbackDraftResult({
  result,
  onChange,
  onSubmit,
}: {
  result: BugReportDraft | EnhancementSuggestionDraft;
  onChange: (updated: BugReportDraft | EnhancementSuggestionDraft) => void;
  onSubmit?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {result.topicId === 'report-bug' ? 'Bug Draft' : 'Enhancement Draft'}
        </span>
        <Badge variant="outline" className="text-xs h-5">
          Draft
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Source route: <span className="text-foreground font-medium">{result.sourceRoute}</span>
      </p>

      <div className="space-y-0.5">
        <label className="text-xs font-semibold text-foreground">Your Description</label>
        <Textarea
          className="text-xs min-h-[64px] resize-none"
          value={result.userDescription}
          onChange={(e) => onChange({ ...result, userDescription: e.target.value })}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-xs font-semibold text-foreground">Structured Draft (Review Before Submission)</label>
        <Textarea
          className="text-xs min-h-[180px] resize-none"
          value={result.structuredDraft}
          onChange={(e) => onChange({ ...result, structuredDraft: e.target.value })}
        />
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-2.5">
        <p className="text-xs text-blue-700 font-semibold mb-1">Wave 3 — Approval-Gated Recording</p>
        <p className="text-xs text-blue-600">
          Review the draft carefully. When you click "Submit for Recording," you'll confirm the details before a record is created in Dataverse.
        </p>
      </div>

      <Button
        size="sm"
        className="w-full h-8 text-xs"
        onClick={onSubmit}
        disabled={!result.userDescription || !result.structuredDraft}
      >
        Submit for Recording
      </Button>

      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function WbsDraftResult({ result }: { result: WbsTaskPlanDraft }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{result.projectName}</span>
        <Badge variant="outline" className="text-xs h-5">Draft</Badge>
      </div>
      <div className="bg-muted/40 rounded-md px-3 py-2">
        <p className="text-xs font-semibold text-foreground mb-1">Planning assumptions</p>
        {result.planningAssumptions.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {item}</p>
        ))}
      </div>
      <Textarea className="text-xs min-h-[200px] resize-none" value={result.draftTasks} readOnly />
      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function RiskAssessmentResult({ result }: { result: ProjectRiskAssessmentAdvisory }) {
  const { riskScoreWarn, riskScoreCritical } = useMiraSignalThresholds();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{result.projectName}</span>
        <Badge variant={result.riskScore >= riskScoreCritical ? 'destructive' : result.riskScore >= riskScoreWarn ? 'outline' : 'secondary'} className="text-xs h-5">
          Risk Score: {result.riskScore}
        </Badge>
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Top risks</p>
        {result.topRisks.map((risk, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {risk}</p>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Mitigation recommendations</p>
        {result.mitigationRecommendations.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {item}</p>
        ))}
      </div>
      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function ImprovedStatusDraftResult({ result }: { result: ImprovedStatusReportDraft }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Improved Status Draft</span>
        <Badge variant="outline" className="text-xs h-5">Draft</Badge>
      </div>
      <Textarea className="text-xs min-h-[120px] resize-none" value={result.originalDraft} readOnly />
      <Textarea className="text-xs min-h-[180px] resize-none" value={result.improvedDraft} readOnly />
      <div>
        {result.improvementNotes.map((note, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {note}</p>
        ))}
      </div>
      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

function BlockersOverdueResult({ result }: { result: BlockersOverdueWorkAdvisory }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Blockers and Overdue Work</span>
        <Badge variant="outline" className="text-xs h-5 capitalize">{result.scope}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{result.summary}</p>
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Blockers</p>
        {result.blockers.length ? result.blockers.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {item}</p>
        )) : <p className="text-xs text-muted-foreground">No blocker signals detected.</p>}
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Overdue work</p>
        {result.overdueItems.length ? result.overdueItems.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {item}</p>
        )) : <p className="text-xs text-muted-foreground">No overdue work detected.</p>}
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground mb-1">Recommended actions</p>
        {result.recommendedActions.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground">- {item}</p>
        ))}
      </div>
      <SourceStatusSummary sourceStatus={result.sourceStatus} />
      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

// ── Wave 3 approval gates ────────────────────────────────────────────────────

interface ApprovalGateDialogProps {
  isOpen: boolean;
  mutation: BugReportMutation | EnhancementSuggestionMutation | null;
  hasReviewed: boolean;
  onReviewedChange: (value: boolean) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function ApprovalGateDialog({
  isOpen,
  mutation,
  hasReviewed,
  onReviewedChange,
  onConfirm,
  onCancel,
  isSubmitting,
}: ApprovalGateDialogProps) {
  if (!isOpen || !mutation) return null;

  const isBug = mutation.topicId === 'report-bug';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full mx-4 p-4">
        <h2 className="text-sm font-semibold text-foreground mb-2">
          Confirm {isBug ? 'Bug Report' : 'Enhancement Suggestion'} Submission
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          This will create a new {isBug ? 'bug report' : 'enhancement'} record in Dataverse. Review the details below before confirming.
        </p>

        <div className="bg-muted/40 rounded-md p-3 mb-3 space-y-2 max-h-[300px] overflow-y-auto">
          <div>
            <p className="text-xs font-semibold text-foreground">Title</p>
            <p className="text-xs text-muted-foreground">{mutation.title}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Description</p>
            <p className="text-xs text-muted-foreground">{mutation.description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Source Route</p>
            <p className="text-xs text-muted-foreground font-mono">{mutation.sourceRoute}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{isBug ? 'Severity' : 'Priority'}</p>
            <p className="text-xs text-muted-foreground">{isBug ? mutation.severity : mutation.priority}</p>
          </div>
          {mutation.affectedEntityRef !== 'other' && (
            <div>
              <p className="text-xs font-semibold text-foreground">Affected Entity</p>
              <p className="text-xs text-muted-foreground">{mutation.affectedEntityRef}</p>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 mb-4 rounded-md border border-border p-2.5">
          <input
            type="checkbox"
            checked={hasReviewed}
            onChange={(e) => onReviewedChange(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span className="text-xs text-muted-foreground">
            I reviewed this payload and approve creating a new Dataverse record.
          </span>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="flex-1 text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40"
          >
            Cancel  
          </button>
          <button
            type="button"
            disabled={isSubmitting || !hasReviewed}
            onClick={onConfirm}
            className="flex-1 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
          >
            {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
            {isSubmitting ? 'Creating...' : 'Confirm & Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mutation result renderer ─────────────────────────────────────────────────

export function MutationResultComponent({
  result,
  onRetry,
}: {
  result: BugReportMutation | EnhancementSuggestionMutation;
  onRetry?: () => void;
}) {
  const isBug = result.topicId === 'report-bug';
  const isSuccess = result.creationResult === 'success';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {isBug ? 'Bug Report' : 'Enhancement Suggestion'}
        </span>
        <Badge 
          variant={isSuccess ? 'default' : result.creationResult === 'failed' ? 'destructive' : 'secondary'} 
          className="text-xs h-5"
        >
          {isSuccess ? 'Recorded' : result.creationResult === 'failed' ? 'Failed' : 'Pending'}
        </Badge>
      </div>

      {isSuccess && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3">
          <p className="text-xs text-green-700 font-semibold mb-1">✓ Record Created Successfully</p>
          <p className="text-xs text-green-600">Record ID: {result.recordId}</p>
        </div>
      )}

      {result.creationResult === 'failed' && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
          <p className="text-xs text-destructive font-semibold">✗ Creation Failed</p>
          <p className="text-xs text-muted-foreground mt-1">Please try again or contact support.</p>
          {result.failureReason && (
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Reason: </span>{result.failureReason}
            </p>
          )}
          {result.telemetryId && (
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-medium text-foreground">Telemetry ID: </span>{result.telemetryId}
            </p>
          )}
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={onRetry}>
              Retry Submission
            </Button>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-foreground">Title</p>
        <p className="text-xs text-muted-foreground">{result.title}</p>
      </div>

      <div>
        <p className="text-xs font-semibold text-foreground">Description</p>
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{result.description}</p>
      </div>

      <div className="bg-muted/40 rounded-md px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Submitted at: </span>
        {new Date(result.createdAt).toLocaleString()}
      </div>

      <ConfidenceFooter confidence={result.confidence} generatedAt={result.generatedAt} />
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3 pt-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────────────

interface QuickActionProps {
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

function QuickAction({ label, description, disabled, onClick }: QuickActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent transition-colors px-3 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </button>
  );
}

// ── Main MiraPanel ────────────────────────────────────────────────────────────

export function MiraPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeCtx = detectRouteContext(location.pathname);
  const dataSource = useDataSource();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MiraTopicResult | null>(null);

  // Wave 3 mutation state
  const [pendingMutation, setPendingMutation] = useState<BugReportMutation | EnhancementSuggestionMutation | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalReviewed, setApprovalReviewed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Agent iframe integration (Wave 1+) ──────────────────────────────────
  // When VITE_MIRA_AGENT_URL is set, render the Copilot Studio agent iframe
  // instead of the app-side fallback. Set this in .env.local:
  //   VITE_MIRA_AGENT_URL=https://copilotstudio.microsoft.com/environments/.../bots/.../webchat
  // When NOT set, the Wave 0 app-side quick-action panel renders unchanged.
  const agentUrl = (import.meta.env.VITE_MIRA_AGENT_URL as string | undefined) || '';

  const run = useCallback(
    async (
      action:
        | 'explain-project-health'
        | 'explain-program-health'
        | 'draft-weekly-status-report'
        | 'what-are-my-open-tasks'
        | 'what-needs-my-attention'
        | 'what-changed-since-last-status-report'
        | 'what-is-blocking-this-project-right-now'
        | 'pmo-triage-needs-attention'
        | 'draft-wbs-task-plan'
        | 'assess-project-risk'
        | 'improve-status-report-draft'
        | 'identify-blockers-overdue-work'
        | 'report-bug'
        | 'suggest-enhancement',
    ) => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        if (action === 'explain-project-health' && routeCtx.id) {
          const ctx = await loadProjectContext(routeCtx.id, dataSource);
          setResult(explainProjectHealth(ctx));
        } else if (action === 'explain-program-health' && routeCtx.id) {
          const ctx = await loadProgramContextEnriched(routeCtx.id, dataSource);
          setResult(explainProgramHealth(ctx));
        } else if (action === 'draft-weekly-status-report' && routeCtx.id) {
          const [pCtx, sCtx] = await Promise.all([
            loadProjectContext(routeCtx.id, dataSource),
            loadStatusContext(routeCtx.id),
          ]);
          setResult(draftWeeklyStatusReport(pCtx, sCtx));
        } else if (action === 'what-are-my-open-tasks' && routeCtx.id && routeCtx.type === 'project') {
          const ctx = await loadProjectOpenTasksContext(routeCtx.id);
          setResult(whatAreMyOpenTasks(ctx));
        } else if (action === 'what-needs-my-attention' && routeCtx.id && routeCtx.type === 'project') {
          const [projectCtx, taskCtx] = await Promise.all([
            loadProjectContext(routeCtx.id, dataSource),
            loadProjectOpenTasksContext(routeCtx.id),
          ]);
          setResult(whatNeedsMyAttention(projectCtx, whatAreMyOpenTasks(taskCtx)));
        } else if (action === 'what-changed-since-last-status-report' && routeCtx.id && routeCtx.type === 'project') {
          const [projectCtx, statusCtx, taskCtx] = await Promise.all([
            loadProjectContext(routeCtx.id, dataSource),
            loadStatusContext(routeCtx.id),
            loadProjectOpenTasksContext(routeCtx.id),
          ]);
          setResult(whatChangedSinceLastStatusReport(projectCtx, statusCtx, whatAreMyOpenTasks(taskCtx)));
        } else if (action === 'what-is-blocking-this-project-right-now' && routeCtx.id && routeCtx.type === 'project') {
          const [projectCtx, taskCtx] = await Promise.all([
            loadProjectContext(routeCtx.id, dataSource),
            loadProjectOpenTasksContext(routeCtx.id),
          ]);
          setResult(whatIsBlockingThisProjectRightNow(projectCtx, whatAreMyOpenTasks(taskCtx)));
        } else if (action === 'pmo-triage-needs-attention') {
          const scope = routeCtx.type === 'project' || routeCtx.type === 'program' ? routeCtx.type : 'portfolio';
          const triageCtx = await loadTriageContext(scope, routeCtx.id ?? undefined);
          setResult(pmoTriageNeedsAttention(triageCtx));
        } else if (action === 'draft-wbs-task-plan' && routeCtx.id && routeCtx.type === 'project') {
          const ctx = await loadProjectContext(routeCtx.id, dataSource);
          setResult(draftWbsTaskPlan(ctx));
        } else if (action === 'assess-project-risk' && routeCtx.id && routeCtx.type === 'project') {
          const pCtx = await loadProjectContext(routeCtx.id, dataSource);
          setResult(assessProjectRisk(pCtx));
        } else if (action === 'improve-status-report-draft' && routeCtx.id && routeCtx.type === 'project') {
          const originalDraft = window.prompt('Paste your current status draft to improve (optional):') ?? '';
          const pCtx = await loadProjectContext(routeCtx.id, dataSource);
          setResult(
            improveStatusReportDraft({
              originalDraft,
              projectId: pCtx.project.msdyn_projectid,
              projectName: pCtx.project.msdyn_subject,
            }),
          );
        } else if (action === 'identify-blockers-overdue-work') {
          const scope = routeCtx.type === 'project' || routeCtx.type === 'program' ? routeCtx.type : 'portfolio';
          const triageCtx = await loadTriageContext(scope, routeCtx.id ?? undefined);
          setResult(identifyBlockersOverdueWork(triageCtx));
        } else if (action === 'report-bug' || action === 'suggest-enhancement') {
          const userDescription = window.prompt(
            action === 'report-bug'
              ? 'Describe the bug you observed:'
              : 'Describe your enhancement suggestion:',
          );

          if (!userDescription || !userDescription.trim()) {
            setError('A description is required to draft this item.');
            return;
          }

          const sourceEntityType: 'project' | 'program' | 'other' =
            routeCtx.type === 'project' || routeCtx.type === 'program' ? routeCtx.type : 'other';

          const draftInput = {
            sourceRoute: location.pathname,
            sourceEntityId: routeCtx.id ?? undefined,
            sourceEntityType,
          };

          if (action === 'report-bug') {
            setResult(reportBug(draftInput, userDescription.trim()));
          } else {
            setResult(suggestEnhancement(draftInput, userDescription.trim()));
          }
        } else {
          setError('Navigate to a project or program page to use this action.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred loading context.');
      } finally {
        setLoading(false);
      }
    },
    [location.pathname, routeCtx],
  );

  const updateDraft = useCallback((updated: StatusReportDraft) => {
    setResult(updated);
  }, []);

  const updateFeedbackDraft = useCallback(
    (updated: BugReportDraft | EnhancementSuggestionDraft) => {
      setResult(updated);
    },
    [],
  );

  // Wave 3: Submit feedback draft for record creation with approval gate
  const submitFeedbackForRecording = useCallback(() => {
    if (!result || (result.topicId !== 'report-bug' && result.topicId !== 'suggest-enhancement')) {
      setError('Invalid submission state');
      return;
    }

    const draft = result as BugReportDraft | EnhancementSuggestionDraft;
    const userId = getCurrentUserId();

    try {
      setError(null);
      let mutation: BugReportMutation | EnhancementSuggestionMutation;
      if (draft.topicId === 'report-bug') {
        mutation = prepareBugReportMutation(draft as BugReportDraft, userId);
      } else {
        mutation = prepareEnhancementSuggestionMutation(draft as EnhancementSuggestionDraft, userId);
      }

      setPendingMutation(mutation);
      setApprovalDialogOpen(true);
      setApprovalReviewed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare mutation');
    }
  }, [result]);

  // Wave 3: Confirm and create the record
  const confirmMutation = useCallback(async () => {
    if (!pendingMutation) return;

    setIsSubmitting(true);
    setError(null);
    try {
      let createdMutation: BugReportMutation | EnhancementSuggestionMutation;
      if (pendingMutation.topicId === 'report-bug') {
        createdMutation = await createBugReportRecord(pendingMutation as BugReportMutation);
      } else {
        createdMutation = await createEnhancementSuggestionRecord(pendingMutation as EnhancementSuggestionMutation);
      }

      // Show the mutation result
      setResult(createdMutation);
      setApprovalDialogOpen(false);
      setPendingMutation(null);
      setApprovalReviewed(false);

      if (createdMutation.creationResult === 'failed') {
        setError(
          createdMutation.failureReason
            ? `Submission failed: ${createdMutation.failureReason}`
            : 'Submission failed. Please retry.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create record');
    } finally {
      setIsSubmitting(false);
    }
  }, [pendingMutation]);

  const cancelMutation = useCallback(() => {
    setApprovalDialogOpen(false);
    setPendingMutation(null);
    setApprovalReviewed(false);
  }, []);

  const retryMutation = useCallback(() => {
    if (!result || result.mode !== 'mutation') return;

    const retryPayload = prepareRetryMutation(result as BugReportMutation | EnhancementSuggestionMutation);

    setPendingMutation(retryPayload);
    setApprovalDialogOpen(true);
    setApprovalReviewed(false);
    setError(null);
  }, [result]);

  if (isDemoActive()) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] mt-4 text-center px-6">
        <Sparkles className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-semibold text-foreground">Mira is unavailable in demo mode</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          The AI assistant connects to Copilot Studio, which isn&rsquo;t available in a
          front-end-only demo. Everything else in the app works with sample data.
        </p>
      </div>
    );
  }

  if (agentUrl) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)] mt-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Mira Agent</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Live</Badge>
        </div>
        <iframe
          src={agentUrl}
          title="Mira PMO delivery assistant"
          allow="microphone"
          className="flex-1 w-full rounded-lg border border-border bg-card"
          style={{ minHeight: 0 }}
        />
        <p className="mt-2 text-[10px] text-muted-foreground text-center">
          Powered by Copilot Studio · pmo_mira
        </p>
      </div>
    );
  }

  const onProjectPage = routeCtx.type === 'project';
  const onProgramPage = routeCtx.type === 'program';

  const showingActions = !result && !loading;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] mt-4">

      {/* ── Action list (hidden once a result is showing) ────────────────── */}
      {showingActions && (
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 pb-2">

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {/* Project-only actions — visible only on /projects/:id */}
          {onProjectPage && (
            <>
              <QuickAction
                label="Explain Project Health"
                description="Advisory summary of delivery signals, risks, and schedule."
                onClick={() => run('explain-project-health')}
              />
              <QuickAction
                label="Draft Weekly Status Report"
                description="Generate a draft status update from current project signals."
                onClick={() => run('draft-weekly-status-report')}
              />
              <QuickAction
                label="What Are My Open Tasks?"
                description="List active project tasks with real due-date and assignee signals."
                onClick={() => run('what-are-my-open-tasks')}
              />
              <QuickAction
                label="What Needs My Attention?"
                description="Summarize the highest-pressure project signals in direct user language."
                onClick={() => run('what-needs-my-attention')}
              />
              <QuickAction
                label="What Changed Since The Last Status Report?"
                description="Compare the latest active status report baseline with current signals."
                onClick={() => run('what-changed-since-last-status-report')}
              />
              <QuickAction
                label="What Is Blocking This Project Right Now?"
                description="Call out active issue, risk, and task blockers affecting delivery flow."
                onClick={() => run('what-is-blocking-this-project-right-now')}
              />
              <QuickAction
                label="Draft WBS Task Plan"
                description="Generate a draft work breakdown structure from project context."
                onClick={() => run('draft-wbs-task-plan')}
              />
              <QuickAction
                label="Assess Project Risk"
                description="Summarize top project risks and recommended mitigations."
                onClick={() => run('assess-project-risk')}
              />
              <QuickAction
                label="Improve Status Report Draft"
                description="Generate an improved status draft with clarity and completeness."
                onClick={() => run('improve-status-report-draft')}
              />
            </>
          )}

          {/* Program-only actions — visible only on /programs/:id */}
          {onProgramPage && (
            <QuickAction
              label="Explain Program Health"
              description="Rollup health summary across all projects in this program."
              onClick={() => run('explain-program-health')}
            />
          )}

          {/* Universal actions — always visible */}
          <QuickAction
            label="Submit a Request"
            description="Start a new PMO intake request for a project, change, or operational need."
            onClick={() => navigate('/intake/new')}
          />
          <QuickAction
            label="Identify Blockers and Overdue Work"
            description="Highlight blocker and overdue signals with recommended actions."
            onClick={() => run('identify-blockers-overdue-work')}
          />
          <QuickAction
            label="PMO Triage Needs Attention"
            description="Rank urgent PMO attention items and explain why they need action now."
            onClick={() => run('pmo-triage-needs-attention')}
          />


          {!onProjectPage && !onProgramPage && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              Navigate to a project or program page for additional actions.
            </p>
          )}
        </div>
      )}

      {/* ── Result / loading mode ────────────────────────────────────────── */}
      {!showingActions && (
        <>
          {result && !loading && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground shrink-0"
              onClick={() => setResult(null)}
            >
              ← New action
            </Button>
          )}

          <Separator className="my-3 shrink-0" />

          <div className="flex-1 overflow-y-auto">
            {loading && <LoadingSkeleton />}

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {!loading && !error && result && result.topicId === 'draft-weekly-status-report' && (
              <DraftResult result={result as StatusReportDraft} onChange={updateDraft} />
            )}

            {!loading && !error && result && result.topicId === 'what-are-my-open-tasks' && (
              <OpenTasksResult result={result as OpenTasksAdvisory} />
            )}

            {!loading && !error && result && result.topicId === 'what-needs-my-attention' && (
              <AttentionItemsResult
                title={(result as NeedsAttentionAdvisory).projectName}
                summary={(result as NeedsAttentionAdvisory).summary}
                items={(result as NeedsAttentionAdvisory).attentionItems}
                sourceStatus={(result as NeedsAttentionAdvisory).sourceStatus}
                confidence={(result as NeedsAttentionAdvisory).confidence}
                generatedAt={(result as NeedsAttentionAdvisory).generatedAt}
              />
            )}

            {!loading && !error && result && result.topicId === 'what-changed-since-last-status-report' && (
              <StatusChangesResult result={result as StatusChangesAdvisory} />
            )}

            {!loading && !error && result && result.topicId === 'what-is-blocking-this-project-right-now' && (
              <AttentionItemsResult
                title={(result as ProjectBlockersAdvisory).projectName}
                summary={(result as ProjectBlockersAdvisory).summary}
                items={(result as ProjectBlockersAdvisory).blockerItems}
                sourceStatus={(result as ProjectBlockersAdvisory).sourceStatus}
                confidence={(result as ProjectBlockersAdvisory).confidence}
                generatedAt={(result as ProjectBlockersAdvisory).generatedAt}
              />
            )}

            {!loading && !error && result &&
              (result.topicId === 'explain-project-health' ||
                result.topicId === 'explain-program-health') && (
              <AdvisoryResult result={result as ProjectHealthAdvisory | ProgramHealthAdvisory} />
            )}

            {!loading && !error && result && result.topicId === 'pmo-triage-needs-attention' && (
              <TriageResult result={result as TriageSummary} />
            )}

            {!loading && !error && result && result.topicId === 'draft-wbs-task-plan' && (
              <WbsDraftResult result={result as WbsTaskPlanDraft} />
            )}

            {!loading && !error && result && result.topicId === 'assess-project-risk' && (
              <RiskAssessmentResult result={result as ProjectRiskAssessmentAdvisory} />
            )}

            {!loading && !error && result && result.topicId === 'improve-status-report-draft' && (
              <ImprovedStatusDraftResult result={result as ImprovedStatusReportDraft} />
            )}

            {!loading && !error && result && result.topicId === 'identify-blockers-overdue-work' && (
              <BlockersOverdueResult result={result as BlockersOverdueWorkAdvisory} />
            )}

            {!loading && !error && result &&
              (result.topicId === 'report-bug' || result.topicId === 'suggest-enhancement') &&
              result.mode === 'draft' && (
              <FeedbackDraftResult
                result={result as BugReportDraft | EnhancementSuggestionDraft}
                onChange={updateFeedbackDraft}
                onSubmit={submitFeedbackForRecording}
              />
            )}

            {!loading && !error && result &&
              (result.topicId === 'report-bug' || result.topicId === 'suggest-enhancement') &&
              result.mode === 'mutation' && (
              <MutationResultComponent
                result={result as BugReportMutation | EnhancementSuggestionMutation}
                onRetry={(result as BugReportMutation | EnhancementSuggestionMutation).creationResult === 'failed' ? retryMutation : undefined}
              />
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 pt-3 border-t border-border shrink-0">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Loading context…</p>
            </div>
          )}
        </>
      )}

      {/* Wave 3: Approval gate dialog */}
      <ApprovalGateDialog
        isOpen={approvalDialogOpen}
        mutation={pendingMutation}
        hasReviewed={approvalReviewed}
        onReviewedChange={setApprovalReviewed}
        onConfirm={confirmMutation}
        onCancel={cancelMutation}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
