import { useMemo } from 'react';
import type { Project } from '../models/project.model';

export interface CrossProjectDependency {
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  overlapDays: number;
  risk: 'low' | 'medium' | 'high';
}

export function useCrossProjectDependencies(projects: Project[]): CrossProjectDependency[] {
  return useMemo(() => {
    const active = projects.filter((p) => p.statecode === 0 && p.msdyn_scheduledstart && p.msdyn_finish);
    const deps: CrossProjectDependency[] = [];

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a._msdyn_program_value && a._msdyn_program_value === b._msdyn_program_value) {
          const aStart = new Date(a.msdyn_scheduledstart!).getTime();
          const aEnd = new Date(a.msdyn_finish!).getTime();
          const bStart = new Date(b.msdyn_scheduledstart!).getTime();
          const bEnd = new Date(b.msdyn_finish!).getTime();
          const overlapStart = Math.max(aStart, bStart);
          const overlapEnd = Math.min(aEnd, bEnd);
          if (overlapStart < overlapEnd) {
            const overlapDays = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
            deps.push({
              fromProjectId: a.msdyn_projectid,
              fromProjectName: a.msdyn_subject,
              toProjectId: b.msdyn_projectid,
              toProjectName: b.msdyn_subject,
              overlapDays,
              risk: overlapDays > 30 ? 'high' : overlapDays > 14 ? 'medium' : 'low',
            });
          }
        }
      }
    }

    return deps.sort((a, b) => b.overlapDays - a.overlapDays);
  }, [projects]);
}
