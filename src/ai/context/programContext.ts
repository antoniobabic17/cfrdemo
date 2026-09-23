/**
 * load-program-context-enriched — uses record-level getProgram() (full field set including
 * rollups) plus a related-projects list filtered to the program ID.
 * Uses record-level fetch rather than list rollups, per plan.
 */

import { getProgram } from '../../api/programs.api';
import { getCustomProgram } from '../../api/customPrograms.api';
import { listProjects } from '../../api/projects.api';
import { listCustomProjects } from '../../api/customProjects.api';
import type { DataSource } from '../../lib/taskSource';
import { listStatusReportsByProjects } from '../../api/statusReports.api';
import type { Program } from '../../models/program.model';
import type { Project } from '../../models/project.model';
import type { StatusReport } from '../../models/statusReport.model';
import type { SourceStatus } from '../contracts';
import { usesCustomTables } from '../../lib/taskSource';

export interface ProgramStatusFreshness {
  projectId: string;
  lastReportedOn?: string;
  ageDays?: number;
  state: 'fresh' | 'stale' | 'missing';
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

export interface ProgramContext {
  program: Program;
  projects: Project[];
  relatedStatusReports: StatusReport[];
  statusFreshness: ProgramStatusFreshness[];
  sourceStatus: SourceStatus[];
}

export async function loadProgramContextEnriched(
  programId: string,
  source: DataSource = 'pss',
): Promise<ProgramContext> {
  const custom = usesCustomTables(source);
  // On custom, program attributes live on pmo_program and a project's program
  // bind lives on pmo_project (_pmo_program_value); the msdyn shells are empty
  // until the reverse-sync runs. Read source-aware so Mira's program context
  // isn't blank on the custom source.
  const program = custom ? await getCustomProgram(programId) : await getProgram(programId);

  const projectsResult = await safeList('program-projects', () =>
    custom
      ? listCustomProjects().then((all) =>
          all.filter((p) => p['_msdyn_program_value'] === programId))
      : listProjects({
          $filter: `_msdyn_program_value eq '${programId}' and statecode eq 0`,
        }),
  );

  const projectIds = projectsResult.data.map((p) => p.msdyn_projectid);
  const reportsResult = await safeList('program-status-reports', () =>
    listStatusReportsByProjects(projectIds),
  );

  const latestByProject = new Map<string, StatusReport>();
  for (const report of reportsResult.data) {
    const projectId = report._msdyn_project_value;
    if (!projectId) continue;
    if (!latestByProject.has(projectId)) {
      latestByProject.set(projectId, report);
    }
  }

  const now = Date.now();
  const freshness: ProgramStatusFreshness[] = projectsResult.data.map((project) => {
    const report = latestByProject.get(project.msdyn_projectid);
    if (!report) {
      return {
        projectId: project.msdyn_projectid,
        state: 'missing',
      };
    }

    const lastDateRaw = report.proj_reportingdate ?? report.createdon;
    const lastDate = lastDateRaw ? new Date(lastDateRaw) : undefined;
    const ageDays = lastDate
      ? Math.max(0, Math.floor((now - lastDate.getTime()) / (1000 * 60 * 60 * 24)))
      : undefined;

    return {
      projectId: project.msdyn_projectid,
      lastReportedOn: lastDate?.toISOString(),
      ageDays,
      state: ageDays == null ? 'missing' : ageDays > 14 ? 'stale' : 'fresh',
    };
  });

  return {
    program,
    projects: projectsResult.data,
    relatedStatusReports: reportsResult.data,
    statusFreshness: freshness,
    sourceStatus: [
      { source: 'program-record', state: 'ok' },
      projectsResult.status,
      reportsResult.status,
    ],
  };
}
