import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listSprintsForProject } from '../api/projectSprints.api';
import { setTaskSprint } from '../lib/schedulingClient';
import { updateCustomTaskSprint } from '../api/customTasks.api';
import type { ProjectTask } from '../models/projectTask.model';
import { PSS_DELAY } from './useProjectTaskMutations';
import { TASK_QUERY_KEYS } from './useProjectTasks';
import { useTaskSource, usesCustomTables } from '../lib/taskSource';

const SPRINT_KEYS = {
  forProject: (pid: string) => ['projectSprints', pid] as const,
};
// Source-versioned task-list key (single source of truth in useProjectTasks)
// so optimistic sprint writes hit the same cache entry the board observes.
const TASK_KEYS = TASK_QUERY_KEYS;

export function useProjectSprints(projectId: string | null) {
  return useQuery({
    queryKey: SPRINT_KEYS.forProject(projectId ?? ''),
    queryFn: () => listSprintsForProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}

export function useSetTaskSprint(projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  return useAppMutation({
    action: 'set task sprint',
    mutationFn: (params: { taskId: string; sprintId: string | null }) =>
      // Custom source: PATCH pmo_Sprint on pmo_task directly (PSS would AV-0006
      // since the task lives in pmo_task). PSS source: route through PssUpdateV1.
      usesCustomTables(source)
        ? updateCustomTaskSprint(params.taskId, params.sprintId)
        : setTaskSprint(params.taskId, projectId, params.sprintId),
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source));
      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old?.map((t) =>
          t.msdyn_projecttaskid === params.taskId
            ? { ...t, '_msdyn_projectsprint_value': params.sprintId ?? undefined, _saving: true }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(TASK_KEYS.forProject(projectId, source), ctx.prev);
    },
    onSuccess: async () => {
      // Custom path PATCH lands synchronously — no PSS commit lag to wait out.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.TASK_UPDATE));
      qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
    },
  });
}
