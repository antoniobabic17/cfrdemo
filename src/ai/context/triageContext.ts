/**
 * load-portfolio-triage-context — Wave 1 triage grounding.
 * Provides portfolio/program/project-level attention signals using active projects,
 * program list, and most recent project status reports.
 */

import { listPrograms } from '../../api/programs.api';
import { listActiveProjects } from '../../api/projects.api';
import { listStatusReportsByProjects } from '../../api/statusReports.api';
import type { Program } from '../../models/program.model';
import type { Project } from '../../models/project.model';
import type { StatusReport } from '../../models/statusReport.model';
import type { SourceStatus } from '../contracts';

export interface TriageContext {
  scope: 'project' | 'program' | 'portfolio';
  scopeId?: string;
  projects: Project[];
  programs: Program[];
  latestStatusReports: StatusReport[];
  sourceStatus: SourceStatus[];
}

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

export async function loadTriageContext(
  scope: 'project' | 'program' | 'portfolio',
  scopeId?: string,
): Promise<TriageContext> {
  const [programsResult, projectsResult] = await Promise.all([
    safeList('triage-programs', listPrograms),
    safeList('triage-active-projects', listActiveProjects),
  ]);

  const filteredProjects =
    scope === 'project' && scopeId
      ? projectsResult.data.filter((p) => p.msdyn_projectid === scopeId)
      : scope === 'program' && scopeId
        ? projectsResult.data.filter((p) => p._msdyn_program_value === scopeId)
        : projectsResult.data;

  const projectIds = filteredProjects.map((p) => p.msdyn_projectid);
  const statusResult = await safeList('triage-status-reports', () =>
    listStatusReportsByProjects(projectIds),
  );

  const latestByProject = new Map<string, StatusReport>();
  for (const report of statusResult.data) {
    const projectId = report._msdyn_project_value;
    if (!projectId) continue;
    if (!latestByProject.has(projectId)) {
      latestByProject.set(projectId, report);
    }
  }

  return {
    scope,
    scopeId,
    projects: filteredProjects,
    programs: programsResult.data,
    latestStatusReports: Array.from(latestByProject.values()),
    sourceStatus: [programsResult.status, projectsResult.status, statusResult.status],
  };
}
