// Portfolio-wide task rollup. Routes through pmo.task_source like the
// per-project hooks. When source='custom' we call listCustomTasksForProjects
// which derives msdyn_summary client-side (a task is a summary iff any
// other task has it as pmo_summarytask -- pmo doesn't carry a
// dedicated summary boolean column).
// See docs/pss-decoupling-c-design.md (Phase 3.6).
import { useQuery } from '@tanstack/react-query';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import { listCustomTasksForProjects } from '../api/customTasks.api';
import { useTaskSource } from '../lib/taskSource';

interface LightTask {
  msdyn_projecttaskid: string;
  '_msdyn_project_value': string | null;
  msdyn_summary: boolean | null;
  msdyn_outlinelevel: number | null;
  msdyn_scheduledstart: string | null;
  msdyn_scheduledend: string | null;
  msdyn_finish: string | null;
  msdyn_progress: number | null;
  statecode: number;
}

async function fetchAllTasksMsdyn(): Promise<LightTask[]> {
  return dv.list<LightTask>(ENTITY_SETS.projectTask, {
    $select: [
      'msdyn_projecttaskid',
      '_msdyn_project_value',
      'msdyn_summary',
      'msdyn_outlinelevel',
      'msdyn_scheduledstart',
      'msdyn_scheduledend',
      'msdyn_finish',
      'msdyn_progress',
      'statecode',
    ],
    $filter: 'statecode eq 0 and msdyn_outlinelevel gt 0 and msdyn_summary eq false',
    $top: 5000,
  });
}

/**
 * Custom-source fetcher. Discovers project IDs first (all active projects
 * in the org), then calls listCustomTasksForProjects which applies the
 * same outline-level + non-summary filter client-side on pmo_task rows.
 */
async function fetchAllTasksCustom(): Promise<LightTask[]> {
  const projects = await dv.list<{ msdyn_projectid: string }>(
    ENTITY_SETS.project,
    { $select: ['msdyn_projectid'], $filter: 'statecode eq 0', $top: 5000 },
  );
  const ids = projects.map((p) => p.msdyn_projectid);
  const rows = await listCustomTasksForProjects(ids);
  return rows.map((r) => ({
    msdyn_projecttaskid: r.msdyn_projecttaskid,
    _msdyn_project_value: r._msdyn_project_value ?? null,
    msdyn_summary: r.msdyn_summary ?? false,
    msdyn_outlinelevel: r.msdyn_outlinelevel ?? null,
    msdyn_scheduledstart: r.msdyn_scheduledstart ?? null,
    msdyn_scheduledend: r.msdyn_scheduledend ?? null,
    msdyn_finish: r.msdyn_finish ?? null,
    msdyn_progress: r.msdyn_progress ?? null,
    statecode: r.statecode ?? 0,
  }));
}

export function useAllProjectTasks() {
  const source = useTaskSource();
  return useQuery({
    queryKey: ['allProjectTasks', source],
    queryFn: source === 'pss' ? fetchAllTasksMsdyn : fetchAllTasksCustom,
    // Analytics tabs must reflect task writes as soon as you navigate to them.
    // staleTime 0 + refetchOnMount refetches on every mount while the cached
    // rows stay on screen, so there is no loading flash and no 5-min lag.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
