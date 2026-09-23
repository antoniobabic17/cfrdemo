import { useMemo } from 'react';
import type { Project } from '../models/project.model';
import type { ProjectBaseline } from '../models/projectBaseline.model';

export interface VarianceEntry {
  projectId: string;
  projectName: string;
  baselineName: string;
  capturedDate: string;
  scheduleVarianceDays: number | null;
  budgetVariance: number | null;
  effortVarianceHours: number | null;
}

function daysBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
}

export function useVarianceData(
  projects: Project[],
  baselines: Map<string, ProjectBaseline[]>,
): VarianceEntry[] {
  return useMemo(() => {
    const entries: VarianceEntry[] = [];
    for (const project of projects) {
      const pBaselines = baselines.get(project.msdyn_projectid) ?? [];
      if (pBaselines.length === 0) continue;
      const latest = pBaselines[0];
      entries.push({
        projectId: project.msdyn_projectid,
        projectName: project.msdyn_subject,
        baselineName: latest.pmo_name,
        capturedDate: latest.pmo_captureddate,
        scheduleVarianceDays: daysBetween(project.msdyn_finish, latest.pmo_finish),
        budgetVariance: (project.proj_budget != null && latest.pmo_budget != null)
          ? project.proj_budget - latest.pmo_budget : null,
        effortVarianceHours: (project.msdyn_effort != null && latest.pmo_baselineeffort != null)
          ? project.msdyn_effort - latest.pmo_baselineeffort : null,
      });
    }
    return entries.sort((a, b) => {
      const aAbs = Math.abs(a.scheduleVarianceDays ?? 0) + Math.abs(a.budgetVariance ?? 0);
      const bAbs = Math.abs(b.scheduleVarianceDays ?? 0) + Math.abs(b.budgetVariance ?? 0);
      return bAbs - aAbs;
    });
  }, [projects, baselines]);
}
