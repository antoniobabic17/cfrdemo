import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listChecklistsForTask } from '../api/projectChecklists.api';
import {
  listCustomChecklistsForTask,
  createCustomChecklistItem,
  updateCustomChecklistItem,
  deleteCustomChecklistItem,
  reorderCustomChecklistItems,
} from '../api/customChecklists.api';
import {
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  type ScheduleChecklistCreate,
  type ScheduleChecklistUpdate,
} from '../lib/schedulingClient';
import type { ProjectChecklist } from '../models/projectChecklist.model';
import { PSS_DELAY } from './useProjectTaskMutations';
import { runWithRetry } from '../lib/retryPolicy';
import { useTaskSource } from '../lib/taskSource';

// Query key includes the source so a flag flip forces a refetch instead of
// serving the other side's cache.
const CHECKLIST_KEYS = {
  forTask: (taskId: string, source: string = 'pss') => ['projectChecklists', taskId, source] as const,
};

export function useProjectChecklists(taskId: string | null) {
  const source = useTaskSource();
  const customSource = source !== 'pss';
  return useQuery({
    queryKey: CHECKLIST_KEYS.forTask(taskId ?? '', source),
    queryFn: () => (customSource ? listCustomChecklistsForTask(taskId!) : listChecklistsForTask(taskId!)),
    enabled: !!taskId,
    staleTime: 30_000,
  });
}

export function useCreateChecklistItem(taskId: string, _projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const key = CHECKLIST_KEYS.forTask(taskId, source);
  return useMutation({
    mutationFn: (params: ScheduleChecklistCreate) =>
      customSource
        ? createCustomChecklistItem(taskId, params.name, params.order, params.completed, params.dueDate).then(() => undefined)
        : runWithRetry(() => createChecklistItem(params)),
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectChecklist[]>(key);
      const optimistic: ProjectChecklist = {
        msdyn_projectchecklistid: `optimistic-${Date.now()}`,
        msdyn_name: params.name,
        msdyn_projectchecklistcompleted: params.completed ?? false,
        msdyn_projectchecklistorder: params.order ?? 999,
        '_msdyn_projecttaskid_value': taskId,
        statecode: 0,
      };
      qc.setQueryData<ProjectChecklist[]>(key, (old) => (old ? [...old, optimistic] : [optimistic]));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: async () => {
      // Custom path is synchronous; only PSS needs the settle delay.
      if (!customSource) await new Promise((r) => setTimeout(r, PSS_DELAY.METADATA));
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateChecklistItem(taskId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const key = CHECKLIST_KEYS.forTask(taskId, source);
  return useMutation({
    mutationFn: (params: ScheduleChecklistUpdate) =>
      customSource
        ? updateCustomChecklistItem(params.checklistId, { name: params.name, completed: params.completed, dueDate: params.dueDate, order: params.order })
        : runWithRetry(() => updateChecklistItem(params)),
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectChecklist[]>(key);
      qc.setQueryData<ProjectChecklist[]>(key, (old) =>
        old?.map((item) =>
          item.msdyn_projectchecklistid === params.checklistId
            ? {
                ...item,
                ...(params.name !== undefined ? { msdyn_name: params.name } : {}),
                ...(params.completed !== undefined ? { msdyn_projectchecklistcompleted: params.completed } : {}),
                ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
                ...(params.order !== undefined ? { msdyn_projectchecklistorder: params.order } : {}),
              }
            : item,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: async () => {
      if (!customSource) await new Promise((r) => setTimeout(r, PSS_DELAY.METADATA));
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useDeleteChecklistItem(taskId: string, projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const key = CHECKLIST_KEYS.forTask(taskId, source);
  return useMutation({
    mutationFn: (checklistId: string) =>
      customSource
        ? deleteCustomChecklistItem(checklistId)
        : runWithRetry(() => deleteChecklistItem(projectId, checklistId)),
    onMutate: async (checklistId) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectChecklist[]>(key);
      qc.setQueryData<ProjectChecklist[]>(key, (old) =>
        old?.filter((item) => item.msdyn_projectchecklistid !== checklistId),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: async () => {
      if (!customSource) await new Promise((r) => setTimeout(r, PSS_DELAY.METADATA));
      qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Reorder checklist items (custom source only). Persists new pmo_order values.
 *  PSS reorder is not supported here — the drag UI is gated on the custom source. */
export function useReorderChecklist(taskId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const key = CHECKLIST_KEYS.forTask(taskId, source);
  return useMutation({
    mutationFn: (items: Array<{ id: string; order: number }>) => reorderCustomChecklistItems(items),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); },
  });
}
