/**
 * Custom-source task labels (freeform, stored on pmo_task.pmo_tasklabel as
 * "name:#color;name:#color"). Only used when pmo.task_source === 'custom'.
 *
 * Unlike the PSS label path (shared msdyn_projectlabel + msdyn_projecttasktolabel
 * junctions), these are per-task, user-created, and written with a plain direct
 * OData PATCH — no PSS, no shared definition. The write is synchronous so the
 * chip updates immediately; we optimistically patch the task-list cache too so
 * the board reflects it without waiting on a refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateCustomTaskLabels } from '../api/customTasks.api';
import { TASK_QUERY_KEYS } from './useProjectTasks';
import { useTaskSource } from '../lib/taskSource';
import type { ProjectTask } from '../models/projectTask.model';

export function useSetCustomTaskLabels(projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const key = TASK_QUERY_KEYS.forProject(projectId, source);
  return useMutation({
    mutationFn: ({ taskId, labelText }: { taskId: string; labelText: string }) =>
      updateCustomTaskLabels(taskId, labelText),
    onMutate: async ({ taskId, labelText }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectTask[]>(key);
      qc.setQueryData<ProjectTask[]>(key, (old) =>
        old?.map((t) =>
          t.msdyn_projecttaskid === taskId ? { ...t, pmo_tasklabel: labelText } : t,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
