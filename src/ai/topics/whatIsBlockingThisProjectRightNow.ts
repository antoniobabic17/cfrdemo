import type { ProjectContext } from '../context/projectContext';
import type {
  DeliveryAttentionItem,
  OpenTasksAdvisory,
  ProjectBlockersAdvisory,
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
  if (sourceStatus.some((status) => status.state === 'failed')) return 'low';
  if (sourceStatus.filter((status) => status.state === 'missing').length > 1) return 'medium';
  return 'high';
}

function severityRank(severity: DeliveryAttentionItem['severity']): number {
  if (severity === 'high') return 0;
  if (severity === 'medium') return 1;
  return 2;
}

function issuePriorityRank(issue: ProjectContext['issues'][number]): number {
  const label = issue['proj_priority@OData.Community.Display.V1.FormattedValue']?.toLowerCase() ?? '';
  if (label.includes('critical') || label.includes('high')) return 0;
  if (label.includes('medium')) return 1;
  return 2;
}

export function whatIsBlockingThisProjectRightNow(
  projectContext: ProjectContext,
  openTasks: OpenTasksAdvisory,
): ProjectBlockersAdvisory {
  const now = new Date();
  const blockerItems: DeliveryAttentionItem[] = [];

  const blockingIssues = projectContext.issues
    .filter((issue) => issue.statecode !== 1)
    .sort((left, right) => {
      const leftDue = left.proj_duedate ? new Date(left.proj_duedate).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.proj_duedate ? new Date(right.proj_duedate).getTime() : Number.POSITIVE_INFINITY;
      const leftScore = (leftDue < now.getTime() ? -1_000_000_000_000 : 0) + leftDue + issuePriorityRank(left);
      const rightScore = (rightDue < now.getTime() ? -1_000_000_000_000 : 0) + rightDue + issuePriorityRank(right);
      return leftScore - rightScore;
    })
    .slice(0, 3);

  for (const issue of blockingIssues) {
    const isOverdue = issue.proj_duedate ? new Date(issue.proj_duedate).getTime() < now.getTime() : false;
    blockerItems.push({
      category: 'issue',
      title: `Active issue: ${issue.msdyn_name}`,
      detail: isOverdue
        ? `${issue.msdyn_name} is overdue and still blocking delivery flow.`
        : `${issue.msdyn_name} is still open and should be treated as an active blocker until resolved.`,
      severity: isOverdue || issuePriorityRank(issue) === 0 ? 'high' : 'medium',
      recommendedAction: 'Confirm owner, next action, and whether this issue should be escalated in the next PMO checkpoint.',
    });
  }

  const blockedTasks = openTasks.tasks
    .filter((task) => task.dueState === 'overdue' || (task.ownershipState === 'unassigned' && task.dueState !== 'on-track'))
    .slice(0, 2);

  for (const task of blockedTasks) {
    blockerItems.push({
      category: 'task',
      title: `Task pressure: ${task.taskName}`,
      detail: task.ownershipState === 'unassigned'
        ? `${task.taskName} is ${task.dueState === 'overdue' ? 'overdue' : task.dueState.replace('-', ' ')} and has no active owner.`
        : `${task.taskName} is overdue at ${task.progressPercent}% progress.`,
      severity: task.dueState === 'overdue' ? 'high' : 'medium',
      recommendedAction: 'Assign or confirm task ownership and decide whether the schedule needs a recovery adjustment.',
    });
  }

  const blockingRisk = projectContext.risks
    .filter((risk) => risk.statecode !== 1)
    .sort((left, right) => (right.proj_exposure ?? 0) - (left.proj_exposure ?? 0))
    .find((risk) => (risk.proj_exposure ?? 0) >= 12 || (risk.proj_due ? new Date(risk.proj_due).getTime() < now.getTime() : false));

  if (blockingRisk) {
    blockerItems.push({
      category: 'risk',
      title: `Escalated risk: ${blockingRisk.msdyn_subject ?? blockingRisk.msdyn_name}`,
      detail: `${blockingRisk.msdyn_subject ?? blockingRisk.msdyn_name} remains open${blockingRisk.proj_exposure ? ` with exposure ${blockingRisk.proj_exposure}` : ''} and is likely constraining delivery progress.`,
      severity: (blockingRisk.proj_exposure ?? 0) >= 16 ? 'high' : 'medium',
      recommendedAction: 'Decide whether the risk now requires issue treatment, milestone adjustment, or explicit escalation.',
    });
  }

  if (blockerItems.length === 0 && projectContext.project.proj_schedulehealth === 189330002) {
    blockerItems.push({
      category: 'health',
      title: 'Schedule health is Off Track',
      detail: 'Structured issue, risk, or task blockers were not dominant, but the schedule health signal is already Off Track.',
      severity: 'medium',
      recommendedAction: 'Review milestone dependencies and confirm what hidden delivery friction is not yet captured as a task, issue, or risk.',
    });
  }

  const sourceStatus = mergeSourceStatus(projectContext.sourceStatus, openTasks.sourceStatus);
  const rankedBlockers = blockerItems
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
    .slice(0, 6);

  const summary =
    rankedBlockers.length === 0
      ? 'No active issue, task, or risk blocker was strong enough to classify as a current delivery block.'
      : `Identified ${rankedBlockers.length} current blocker signal(s) affecting ${projectContext.project.msdyn_subject}.`;

  return {
    topicId: 'what-is-blocking-this-project-right-now',
    mode: 'advisory',
    projectId: projectContext.project.msdyn_projectid,
    projectName: projectContext.project.msdyn_subject,
    summary,
    blockerItems: rankedBlockers,
    sourceStatus,
    confidence: confidenceFromSourceStatus(sourceStatus),
    generatedAt: new Date().toISOString(),
  };
}