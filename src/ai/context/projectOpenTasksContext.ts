/**
 * load-project-open-tasks-context — fetches project record, project tasks,
 * and task assignments needed for the first-class what-are-my-open-tasks topic.
 */

import { getProject } from '../../api/projects.api';
import { listProjectTasks } from '../../api/projectTasks.api';
import { listResourceAssignments } from '../../api/resourceAssignments.api';
import type { Project } from '../../models/project.model';
import type { ProjectTask } from '../../models/projectTask.model';
import type { ResourceAssignment } from '../../models/resourceAssignment.model';
import type { SourceStatus } from '../contracts';

async function safeList<T>(
  source: string,
  loader: () => Promise<T[]>,
): Promise<{ data: T[]; status: SourceStatus }> {
  try {
    const data = await loader();
    return {
      data,
      status: {
        source,
        state: data.length === 0 ? 'missing' : 'ok',
        detail: data.length === 0 ? 'No records returned.' : undefined,
      },
    };
  } catch (error) {
    return {
      data: [],
      status: {
        source,
        state: 'failed',
        detail: error instanceof Error ? error.message : 'Fetch failed.',
      },
    };
  }
}

export interface ProjectOpenTasksContext {
  project: Project;
  tasks: ProjectTask[];
  assignments: ResourceAssignment[];
  sourceStatus: SourceStatus[];
}

export async function loadProjectOpenTasksContext(projectId: string): Promise<ProjectOpenTasksContext> {
  const project = await getProject(projectId);

  const [tasksResult, assignmentsResult] = await Promise.all([
    safeList('project-tasks', () => listProjectTasks(projectId)),
    safeList('resource-assignments', () => listResourceAssignments(projectId)),
  ]);

  return {
    project,
    tasks: tasksResult.data,
    assignments: assignmentsResult.data,
    sourceStatus: [
      { source: 'project-record', state: 'ok' },
      tasksResult.status,
      assignmentsResult.status,
    ],
  };
}