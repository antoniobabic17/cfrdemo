import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listLabelsForProject, listTaskLabels } from '../api/projectLabels.api';
import { listCustomTaskLabels, assignCustomLabel, removeCustomLabel } from '../api/customTaskLabels.api';
import { assignLabelToTask, removeLabelFromTask, renameLabel } from '../lib/schedulingClient';
import type { ProjectLabel, ProjectTaskToLabel } from '../models/projectLabel.model';
import { PSS_DELAY } from './useProjectTaskMutations';
import { useTaskSource } from '../lib/taskSource';

// Label DEFINITIONS stay in msdyn_projectlabel on both sources (project-scoped,
// unchanged). Only the task<->label ASSOCIATION is source-dependent, so the
// taskLabels key carries the source to force a refetch on flag flip.
const LABEL_KEYS = {
  forProject: (pid: string) => ['projectLabels', pid] as const,
  taskLabels: (pid: string, source: string = 'pss') => ['projectTaskLabels', pid, source] as const,
};

export function useProjectLabels(projectId: string | null) {
  return useQuery({
    queryKey: LABEL_KEYS.forProject(projectId ?? ''),
    queryFn: () => listLabelsForProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}

export function useProjectTaskLabels(projectId: string | null) {
  const source = useTaskSource();
  const customSource = source !== 'pss';
  return useQuery({
    queryKey: LABEL_KEYS.taskLabels(projectId ?? '', source),
    queryFn: () => (customSource ? listCustomTaskLabels(projectId!) : listTaskLabels(projectId!)),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useRenameLabel(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'rename label',
    mutationFn: (params: { labelId: string; name: string }) =>
      renameLabel(projectId, params.labelId, params.name),
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: LABEL_KEYS.forProject(projectId) });
      const prev = qc.getQueryData<ProjectLabel[]>(LABEL_KEYS.forProject(projectId));
      qc.setQueryData<ProjectLabel[]>(LABEL_KEYS.forProject(projectId), (old) =>
        old?.map((l) =>
          l.msdyn_projectlabelid === params.labelId
            ? { ...l, msdyn_projectlabeltext: params.name }
            : l,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(LABEL_KEYS.forProject(projectId), ctx.prev);
    },
    // Label rename is a PSS OperationSet (msdyn_projectlabel is PSS-gated; a
    // direct PATCH throws 0x80040265), and PSS commit lag on this entity is
    // ~12s -- LONGER than a fixed PSS_DELAY.METADATA (8s) wait. A plain
    // "sleep then invalidate" refetched the OLD label text before PSS had
    // materialized the rename, clobbering the optimistic name so it "never
    // stuck" (operator report 2026-07-30). Instead, POLL the server label
    // read until it reflects the new name (bounded), and only then let the
    // cache settle to the server value. Until it catches up the optimistic
    // name stays on screen.
    onSuccess: async (_data, vars) => {
      const deadline = Date.now() + PSS_DELAY.METADATA + 20_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2_500));
        try {
          const fresh = await qc.fetchQuery({
            queryKey: LABEL_KEYS.forProject(projectId),
            queryFn: () => listLabelsForProject(projectId),
          });
          const row = fresh.find((l) => l.msdyn_projectlabelid === vars.labelId);
          if (row && row.msdyn_projectlabeltext === vars.name) return; // server caught up
        } catch { /* transient — keep polling */ }
        // Server not yet reflecting the rename: re-apply the optimistic name so
        // the just-fetched (stale) list doesn't revert the chip mid-flight.
        qc.setQueryData<ProjectLabel[]>(LABEL_KEYS.forProject(projectId), (old) =>
          old?.map((l) =>
            l.msdyn_projectlabelid === vars.labelId
              ? { ...l, msdyn_projectlabeltext: vars.name }
              : l,
          ),
        );
      }
      // Deadline hit — leave the optimistic name in place; a later natural
      // refetch (staleTime) will reconcile once PSS has committed.
    },
  });
}

export function useAssignLabel(projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const key = LABEL_KEYS.taskLabels(projectId, source);
  return useAppMutation({
    action: 'assign label',
    mutationFn: (params: { taskId: string; labelId: string }) =>
      customSource
        ? assignCustomLabel(params.taskId, params.labelId).then(() => undefined)
        : assignLabelToTask(projectId, params.taskId, params.labelId),
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectTaskToLabel[]>(key);
      const optimistic: ProjectTaskToLabel = {
        msdyn_projecttasktolabelid: `optimistic-${Date.now()}`,
        '_msdyn_projectlabelid_value': params.labelId,
        '_msdyn_projecttaskid_value': params.taskId,
        statecode: 0,
      };
      qc.setQueryData<ProjectTaskToLabel[]>(key, (old) => (old ? [...old, optimistic] : [optimistic]));
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

export function useRemoveLabel(projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const key = LABEL_KEYS.taskLabels(projectId, source);
  return useAppMutation({
    action: 'remove label',
    mutationFn: (taskToLabelId: string) =>
      customSource ? removeCustomLabel(taskToLabelId) : removeLabelFromTask(projectId, taskToLabelId),
    onMutate: async (taskToLabelId) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectTaskToLabel[]>(key);
      qc.setQueryData<ProjectTaskToLabel[]>(key, (old) =>
        old?.filter((tl) => tl.msdyn_projecttasktolabelid !== taskToLabelId),
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
