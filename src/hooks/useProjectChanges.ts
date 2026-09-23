import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectChanges,
  createProjectChange,
  updateProjectChange,
  deleteProjectChange,
  type ProjectChangeCreate,
  type ProjectChangePayload,
} from '../api/projectChanges.api';
import type { ProjectChange } from '../models/projectChange.model';
import { useDataSource, usesCustomTables } from '../lib/taskSource';
import { listCustomChanges, createCustomChange, updateCustomChange, deleteCustomChange } from '../api/customProjectChanges.api';
import { toast } from './useToast';

const KEYS = {
  forProject: (projectId: string) => ['projectChanges', projectId] as const,
};

export function useProjectChanges(projectId: string | undefined) {
  const source = useDataSource();
  return useQuery({
    queryKey: [...KEYS.forProject(projectId ?? ''), source],
    queryFn: () => (usesCustomTables(source) ? listCustomChanges(projectId!) : listProjectChanges(projectId!)),
    enabled: !!projectId,
  });
}

export function useCreateProjectChange(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'create project change',
    mutationFn: (payload: ProjectChangeCreate) =>
      usesCustomTables(source) ? createCustomChange(projectId, payload) : createProjectChange(payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: KEYS.forProject(projectId) });
      const previous = qc.getQueryData<ProjectChange[]>(KEYS.forProject(projectId));
      const optimistic = {
        msdyn_projectchangeid: `optimistic-${Date.now()}`,
        msdyn_name: payload.msdyn_name,
        msdyn_description: payload.msdyn_description,
        statecode: 0,
        createdon: new Date().toISOString(),
        _msdyn_project_value: projectId,
        _saving: true,
      } as unknown as ProjectChange;
      qc.setQueryData<ProjectChange[]>(KEYS.forProject(projectId), (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<ProjectChange[]>(KEYS.forProject(projectId), ctx.previous);
      toast.error('Failed to save change request. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
  });
}

export function useUpdateProjectChange(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'update project change',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectChangePayload }) =>
      usesCustomTables(source) ? updateCustomChange(id, payload) : updateProjectChange(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to update change request. Please try again.'),
  });
}

export function useDeleteProjectChange(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'delete project change',
    mutationFn: (id: string) => (usesCustomTables(source) ? deleteCustomChange(id) : deleteProjectChange(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to delete change request. Please try again.'),
  });
}
