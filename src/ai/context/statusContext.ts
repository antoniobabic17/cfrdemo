/**
 * load-status-context — fetches recent status reports for a project,
 * used to seed draft status report generation with prior-period context.
 */

import { listStatusReports } from '../../api/statusReports.api';
import type { StatusReport } from '../../models/statusReport.model';
import type { SourceStatus } from '../contracts';

export interface StatusContext {
  reports: StatusReport[];
  mostRecent: StatusReport | undefined;
  sourceStatus: SourceStatus[];
}

export async function loadStatusContext(projectId: string): Promise<StatusContext> {
  try {
    const reports = await listStatusReports(projectId);
    return {
      reports,
      mostRecent: reports[0],
      sourceStatus: [
        {
          source: 'status-reports',
          state: reports.length === 0 ? 'missing' : 'ok',
          detail: reports.length === 0 ? 'No prior reports found.' : undefined,
        },
      ],
    };
  } catch (error) {
    return {
      reports: [],
      mostRecent: undefined,
      sourceStatus: [
        {
          source: 'status-reports',
          state: 'failed',
          detail: error instanceof Error ? error.message : 'Failed to load status reports.',
        },
      ],
    };
  }
}
