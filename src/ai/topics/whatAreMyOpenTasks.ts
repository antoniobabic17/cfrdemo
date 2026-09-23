/**
 * what-are-my-open-tasks topic — first-class project task advisory.
 * Lists active leaf tasks using real task state and assignment data.
 */

import type { ProjectTask } from '../../models/projectTask.model';
import type { ResourceAssignment } from '../../models/resourceAssignment.model';
import type { OpenTaskItem, OpenTasksAdvisory } from '../contracts';
import type { ProjectOpenTasksContext } from '../context/projectOpenTasksContext';

const DUE_SOON_DAYS = 7;

function normalizeProgress(task: ProjectTask): number {
  const raw = task.msdyn_progress ?? 0;
  const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function resolveDueDate(task: ProjectTask): string | undefined {
  return task.msdyn_scheduledend ?? task.msdyn_finish;
}

function resolveDueState(task: ProjectTask, today: Date): OpenTaskItem['dueState'] {
  const dueDate = resolveDueDate(task);
  if (!dueDate) return 'unscheduled';

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  if (due.getTime() < today.getTime()) return 'overdue';

  const dueSoonThreshold = new Date(today);
  dueSoonThreshold.setDate(today.getDate() + DUE_SOON_DAYS);
  if (due.getTime() <= dueSoonThreshold.getTime()) return 'due-soon';

  return 'on-track';
}

function isOpenLeafTask(task: ProjectTask): boolean {
  if (task.msdyn_summary) return false;
  if (task.msdyn_projecttaskid.startsWith('optimistic-')) return false;

  const progress = normalizeProgress(task);
  return task.statecode !== 1 && progress < 100;
}

function buildAssignmentMap(assignments: ResourceAssignment[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const assignment of assignments) {
    const taskId = assignment['_msdyn_taskid_value'];
    if (!taskId) continue;

    const existing = map.get(taskId) ?? [];
    const name =
      assignment.msdyn_name?.trim() ||
      assignment['_msdyn_projectteamid_value@OData.Community.Display.V1.FormattedValue']?.trim();

    if (name) {
      existing.push(name);
      map.set(taskId, existing);
    }
  }

  return map;
}

function dueStateRank(dueState: OpenTaskItem['dueState']): number {
  switch (dueState) {
    case 'overdue':
      return 0;
    case 'due-soon':
      return 1;
    case 'unscheduled':
      return 2;
    default:
      return 3;
  }
}

function compareTasks(left: OpenTaskItem, right: OpenTaskItem): number {
  const dueRank = dueStateRank(left.dueState) - dueStateRank(right.dueState);
  if (dueRank !== 0) return dueRank;

  if (left.ownershipState !== right.ownershipState) {
    return left.ownershipState === 'unassigned' ? -1 : 1;
  }

  if (left.dueDate && right.dueDate) {
    const dueComparison = new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
    if (dueComparison !== 0) return dueComparison;
  } else if (left.dueDate || right.dueDate) {
    return left.dueDate ? -1 : 1;
  }

  return left.taskName.localeCompare(right.taskName);
}

export function whatAreMyOpenTasks(ctx: ProjectOpenTasksContext): OpenTasksAdvisory {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const assignmentMap = buildAssignmentMap(ctx.assignments);

  const tasks = ctx.tasks
    .filter(isOpenLeafTask)
    .map<OpenTaskItem>((task) => {
      const assignees = assignmentMap.get(task.msdyn_projecttaskid) ?? [];
      return {
        taskId: task.msdyn_projecttaskid,
        taskName: task.msdyn_subject,
        progressPercent: normalizeProgress(task),
        dueDate: resolveDueDate(task),
        dueState: resolveDueState(task, today),
        ownershipState: assignees.length > 0 ? 'assigned' : 'unassigned',
        assignees,
        isMilestone: Boolean(task.msdyn_ismilestone),
      };
    })
    .sort(compareTasks);

  const overdueTaskCount = tasks.filter((task) => task.dueState === 'overdue').length;
  const dueSoonTaskCount = tasks.filter((task) => task.dueState === 'due-soon').length;
  const unassignedTaskCount = tasks.filter((task) => task.ownershipState === 'unassigned').length;

  let summary = 'No open leaf tasks are currently active for this project.';
  if (tasks.length > 0) {
    const summaryParts: string[] = [];
    if (overdueTaskCount > 0) summaryParts.push(`${overdueTaskCount} overdue`);
    if (dueSoonTaskCount > 0) summaryParts.push(`${dueSoonTaskCount} due in the next ${DUE_SOON_DAYS} days`);
    if (unassignedTaskCount > 0) summaryParts.push(`${unassignedTaskCount} unassigned`);

    summary = `Found ${tasks.length} open task(s) for ${ctx.project.msdyn_subject}.`;
    if (summaryParts.length > 0) {
      summary += ` Priority signals: ${summaryParts.join(', ')}.`;
    } else {
      summary += ' No immediate overdue or ownership gaps were detected.';
    }
  }

  const failedSources = ctx.sourceStatus.filter((source) => source.state === 'failed').length;
  const missingSources = ctx.sourceStatus.filter((source) => source.state === 'missing').length;

  return {
    topicId: 'what-are-my-open-tasks',
    mode: 'advisory',
    projectId: ctx.project.msdyn_projectid,
    projectName: ctx.project.msdyn_subject,
    summary,
    openTaskCount: tasks.length,
    overdueTaskCount,
    dueSoonTaskCount,
    unassignedTaskCount,
    tasks,
    sourceStatus: ctx.sourceStatus,
    confidence: failedSources > 0 ? 'low' : missingSources > 0 ? 'medium' : 'high',
    generatedAt: new Date().toISOString(),
  };
}