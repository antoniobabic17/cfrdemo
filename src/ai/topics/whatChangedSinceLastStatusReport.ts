import type { ProjectContext } from '../context/projectContext';
import type { StatusContext } from '../context/statusContext';
import type {
  OpenTasksAdvisory,
  SourceStatus,
  StatusChangeItem,
  StatusChangesAdvisory,
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

function confidenceFromSourceStatus(sourceStatus: SourceStatus[], hasBaseline: boolean): 'high' | 'medium' | 'low' {
  if (!hasBaseline || sourceStatus.some((status) => status.state === 'failed')) return 'low';
  if (sourceStatus.filter((status) => status.state === 'missing').length > 1) return 'medium';
  return 'high';
}

function baselineDate(statusContext: StatusContext): Date | undefined {
  const raw = statusContext.mostRecent?.proj_reportingdate ?? statusContext.mostRecent?.createdon;
  return raw ? new Date(raw) : undefined;
}

export function whatChangedSinceLastStatusReport(
  projectContext: ProjectContext,
  statusContext: StatusContext,
  openTasks: OpenTasksAdvisory,
): StatusChangesAdvisory {
  const baseline = baselineDate(statusContext);
  const changeItems: StatusChangeItem[] = [];

  if (!baseline) {
    changeItems.push({
      category: 'status',
      summary: 'No prior active status report exists, so Mira cannot compute a true since-last-report delta yet.',
    });
  } else {
    const newRisks = projectContext.risks.filter((risk) => risk.createdon && new Date(risk.createdon).getTime() > baseline.getTime());
    const newIssues = projectContext.issues.filter((issue) => issue.createdon && new Date(issue.createdon).getTime() > baseline.getTime());

    if (newRisks.length > 0) {
      changeItems.push({
        category: 'risk',
        summary: `${newRisks.length} new risk(s) were logged after the last status report, including ${newRisks.slice(0, 2).map((risk) => risk.msdyn_subject ?? risk.msdyn_name).join(', ')}.`,
      });
    }

    if (newIssues.length > 0) {
      changeItems.push({
        category: 'issue',
        summary: `${newIssues.length} new issue(s) were logged after the last status report, including ${newIssues.slice(0, 2).map((issue) => issue.msdyn_name).join(', ')}.`,
      });
    }

    const reportAgeDays = Math.floor((Date.now() - baseline.getTime()) / (1000 * 60 * 60 * 24));
    if (reportAgeDays > 14) {
      changeItems.push({
        category: 'status',
        summary: `The latest active status report is ${reportAgeDays} day(s) old, so current delivery pressure may be ahead of the recorded narrative.`,
      });
    }
  }

  if (openTasks.overdueTaskCount > 0) {
    changeItems.push({
      category: 'task',
      summary: `${openTasks.overdueTaskCount} open task(s) are currently overdue, led by ${openTasks.tasks.filter((task) => task.dueState === 'overdue').slice(0, 2).map((task) => task.taskName).join(', ')}.`,
    });
  } else if (openTasks.dueSoonTaskCount > 0) {
    changeItems.push({
      category: 'task',
      summary: `${openTasks.dueSoonTaskCount} open task(s) are due within the next 7 days.`,
    });
  }

  if (openTasks.unassignedTaskCount > 0) {
    changeItems.push({
      category: 'task',
      summary: `${openTasks.unassignedTaskCount} open task(s) currently have no active assignment.`,
    });
  }

  if (changeItems.length === 0) {
    changeItems.push({
      category: 'status',
      summary: 'No new risks or issues were logged after the last status report, and no overdue or unassigned open-task pressure is currently visible.',
    });
  }

  const sourceStatus = mergeSourceStatus(projectContext.sourceStatus, statusContext.sourceStatus, openTasks.sourceStatus);
  const summary = baseline
    ? `Compared to the last active status report from ${baseline.toLocaleDateString()}, Mira found ${changeItems.length} structured change signal(s).`
    : 'Mira returned the current structured project delta view, but a previous active status report was not available for comparison.';

  return {
    topicId: 'what-changed-since-last-status-report',
    mode: 'advisory',
    projectId: projectContext.project.msdyn_projectid,
    projectName: projectContext.project.msdyn_subject,
    baselineDate: baseline?.toISOString(),
    summary,
    changeItems,
    sourceStatus,
    confidence: confidenceFromSourceStatus(sourceStatus, Boolean(baseline)),
    generatedAt: new Date().toISOString(),
  };
}