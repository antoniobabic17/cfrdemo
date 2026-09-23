import type { ProjectContext } from '../context/projectContext';
import type {
  DeliveryAttentionItem,
  NeedsAttentionAdvisory,
  OpenTasksAdvisory,
  SourceStatus,
} from '../contracts';

function mergeSourceStatus(...groups: SourceStatus[][]): SourceStatus[] {
  const merged = new Map<string, SourceStatus>();

  for (const status of groups.flat()) {
    const existing = merged.get(status.source);
    if (!existing || existing.state !== 'failed' || status.state === 'failed') {
      merged.set(status.source, status);
    }
  }

  return [...merged.values()];
}

function confidenceFromSourceStatus(sourceStatus: SourceStatus[]): 'high' | 'medium' | 'low' {
  const failed = sourceStatus.filter((status) => status.state === 'failed').length;
  const missing = sourceStatus.filter((status) => status.state === 'missing').length;

  if (failed > 0) return 'low';
  if (missing > 1) return 'medium';
  return 'high';
}

function severityRank(severity: DeliveryAttentionItem['severity']): number {
  if (severity === 'high') return 0;
  if (severity === 'medium') return 1;
  return 2;
}

function latestStatusDate(projectContext: ProjectContext): Date | undefined {
  const latest = projectContext.recentStatusReports[0];
  const raw = latest?.proj_reportingdate ?? latest?.createdon;
  return raw ? new Date(raw) : undefined;
}

function issuePriorityRank(issue: ProjectContext['issues'][number]): number {
  const label = issue['proj_priority@OData.Community.Display.V1.FormattedValue']?.toLowerCase() ?? '';
  if (label.includes('critical') || label.includes('high')) return 0;
  if (label.includes('medium')) return 1;
  return 2;
}

function issueSortValue(issue: ProjectContext['issues'][number], now: Date): number {
  const dueAt = issue.proj_duedate ? new Date(issue.proj_duedate).getTime() : Number.POSITIVE_INFINITY;
  const overdueBoost = dueAt < now.getTime() ? -1_000_000_000_000 : 0;
  return overdueBoost + dueAt + issuePriorityRank(issue);
}

function riskSortValue(risk: ProjectContext['risks'][number], now: Date): number {
  const dueAt = risk.proj_due ? new Date(risk.proj_due).getTime() : Number.POSITIVE_INFINITY;
  const overdueBoost = dueAt < now.getTime() ? -1_000_000_000_000 : 0;
  const exposureBoost = -(risk.proj_exposure ?? 0) * 1000;
  return overdueBoost + dueAt + exposureBoost;
}

export function whatNeedsMyAttention(
  projectContext: ProjectContext,
  openTasks: OpenTasksAdvisory,
): NeedsAttentionAdvisory {
  const now = new Date();
  const items: DeliveryAttentionItem[] = [];
  const latestStatus = latestStatusDate(projectContext);

  if (projectContext.project.proj_overallhealth === 189330002) {
    items.push({
      category: 'health',
      title: 'Project health is Off Track',
      detail: `${projectContext.project.msdyn_subject} is currently marked Off Track, which raises delivery escalation risk immediately.`,
      severity: 'high',
      recommendedAction: 'Review the recovery path and confirm owner-level corrective actions this week.',
    });
  } else if (projectContext.project.proj_overallhealth === 189330001) {
    items.push({
      category: 'health',
      title: 'Project health is At Risk',
      detail: `${projectContext.project.msdyn_subject} has an At Risk overall health signal and should be reviewed before the next milestone.`,
      severity: 'medium',
      recommendedAction: 'Check near-term milestones and resolve the highest exposure risks before the next update.',
    });
  }

  if (!latestStatus) {
    items.push({
      category: 'status',
      title: 'No active status report is on record',
      detail: 'Mira cannot confirm recent delivery narrative because no active project status report was found.',
      severity: 'medium',
      recommendedAction: 'Capture a current status report so new risks, issues, and schedule changes are grounded in a fresh baseline.',
    });
  } else {
    const ageDays = Math.floor((now.getTime() - latestStatus.getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays > 14) {
      items.push({
        category: 'status',
        title: 'Latest status report is stale',
        detail: `The latest active status report is ${ageDays} day(s) old, which weakens confidence in the current project narrative.`,
        severity: 'medium',
        recommendedAction: 'Refresh the project status report and confirm whether planned activities are still accurate.',
      });
    }
  }

  const overdueTasks = openTasks.tasks.filter((task) => task.dueState === 'overdue').slice(0, 2);
  for (const task of overdueTasks) {
    items.push({
      category: 'task',
      title: `Overdue task: ${task.taskName}`,
      detail: `${task.taskName} is overdue at ${task.progressPercent}% progress${task.assignees.length > 0 ? ` and is currently assigned to ${task.assignees.join(', ')}` : ' and currently has no active assignee'}.`,
      severity: 'high',
      recommendedAction: 'Confirm recovery timing and whether the current owner can still deliver the task without milestone impact.',
    });
  }

  const urgentUnassignedTasks = openTasks.tasks
    .filter((task) => task.ownershipState === 'unassigned' && task.dueState !== 'on-track' && task.dueState !== 'unscheduled')
    .filter((task) => !overdueTasks.some((overdueTask) => overdueTask.taskId === task.taskId))
    .slice(0, 2);

  for (const task of urgentUnassignedTasks) {
    items.push({
      category: 'task',
      title: `Unassigned task: ${task.taskName}`,
      detail: `${task.taskName} is ${task.dueState === 'due-soon' ? 'due soon' : 'time-sensitive'} but has no active assignment.`,
      severity: task.dueState === 'due-soon' ? 'high' : 'medium',
      recommendedAction: 'Assign a delivery owner and confirm completion timing before the task becomes overdue.',
    });
  }

  const urgentIssues = projectContext.issues
    .filter((issue) => issue.statecode !== 1)
    .sort((left, right) => issueSortValue(left, now) - issueSortValue(right, now))
    .slice(0, 2);

  for (const issue of urgentIssues) {
    const isOverdue = issue.proj_duedate ? new Date(issue.proj_duedate).getTime() < now.getTime() : false;
    const assignee = issue['_proj_assignedto_value@OData.Community.Display.V1.FormattedValue'];

    items.push({
      category: 'issue',
      title: `Open issue: ${issue.msdyn_name}`,
      detail: isOverdue
        ? `${issue.msdyn_name} is overdue and still active${assignee ? ` for ${assignee}` : ''}.`
        : `${issue.msdyn_name} remains active${assignee ? ` with ${assignee} assigned` : ''}.`,
      severity: isOverdue ? 'high' : issuePriorityRank(issue) === 0 ? 'high' : 'medium',
      recommendedAction: 'Review the blocker path, confirm the owner, and set the next dated resolution step.',
    });
  }

  const urgentRisks = projectContext.risks
    .filter((risk) => risk.statecode !== 1)
    .sort((left, right) => riskSortValue(left, now) - riskSortValue(right, now))
    .slice(0, 1);

  for (const risk of urgentRisks) {
    const isOverdue = risk.proj_due ? new Date(risk.proj_due).getTime() < now.getTime() : false;
    items.push({
      category: 'risk',
      title: `Risk exposure: ${risk.msdyn_subject ?? risk.msdyn_name}`,
      detail: `${risk.msdyn_subject ?? risk.msdyn_name} remains open${risk.proj_exposure ? ` with exposure ${risk.proj_exposure}` : ''}${isOverdue ? ' and its mitigation due date has already passed' : ''}.`,
      severity: isOverdue || (risk.proj_exposure ?? 0) >= 12 ? 'high' : 'medium',
      recommendedAction: 'Confirm mitigation ownership and decide whether the risk should now be escalated as an active issue.',
    });
  }

  const sourceStatus = mergeSourceStatus(projectContext.sourceStatus, openTasks.sourceStatus);
  const attentionItems = items
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
    .slice(0, 6);

  const summary =
    attentionItems.length === 0
      ? 'No immediate attention signals were detected from the current project context.'
      : `Found ${attentionItems.length} attention item(s) for ${projectContext.project.msdyn_subject}, led by ${attentionItems[0].category.replace('-', ' ')} pressure.`;

  return {
    topicId: 'what-needs-my-attention',
    mode: 'advisory',
    projectId: projectContext.project.msdyn_projectid,
    projectName: projectContext.project.msdyn_subject,
    summary,
    attentionItems,
    sourceStatus,
    confidence: confidenceFromSourceStatus(sourceStatus),
    generatedAt: new Date().toISOString(),
  };
}