/**
 * load-project-context — fetches project record, active risks, active issues,
 * and recent status reports needed to answer Wave 1 project-scoped topics.
 */

import { getProject } from '../../api/projects.api';
import { getCustomProject } from '../../api/customProjects.api';
import type { DataSource } from '../../lib/taskSource';
import { listProjectRisks } from '../../api/projectRisks.api';
import { listProjectIssues } from '../../api/projectIssues.api';
import { listStatusReports } from '../../api/statusReports.api';
import type { Project } from '../../models/project.model';
import type { ProjectRisk } from '../../models/projectRisk.model';
import type { ProjectIssue } from '../../models/projectIssue.model';
import type { StatusReport } from '../../models/statusReport.model';
import type { SourceStatus } from '../contracts';
import { usesCustomTables } from '../../lib/taskSource';

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

export interface ProjectContext {
  project: Project;
  risks: ProjectRisk[];
  issues: ProjectIssue[];
  recentStatusReports: StatusReport[];
  sourceStatus: SourceStatus[];
}

export async function loadProjectContext(
  projectId: string,
  source: DataSource = 'pss',
): Promise<ProjectContext> {
  // Custom source: project attributes live on pmo_project, not the shell.
  const project = usesCustomTables(source) ? await getCustomProject(projectId) : await getProject(projectId);

  const [risksResult, issuesResult, reportsResult] = await Promise.all([
    safeList('project-risks', () => listProjectRisks(projectId)),
    safeList('project-issues', () => listProjectIssues(projectId)),
    safeList('project-status-reports', () => listStatusReports(projectId)),
  ]);

  return {
    project,
    risks: risksResult.data,
    issues: issuesResult.data,
    recentStatusReports: reportsResult.data,
    sourceStatus: [
      { source: 'project-record', state: 'ok' },
      risksResult.status,
      issuesResult.status,
      reportsResult.status,
    ],
  };
}
