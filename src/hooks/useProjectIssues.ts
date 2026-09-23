import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectIssues,
  createProjectIssue,
  updateProjectIssue,
  deleteProjectIssue,
  type ProjectIssueCreate,
  type ProjectIssuePayload,
} from '../api/projectIssues.api';
import type { ProjectIssue } from '../models/projectIssue.model';
import { useDataSource, usesCustomTables } from '../lib/taskSource';
import { listCustomIssues, createCustomIssue, updateCustomIssue, deleteCustomIssue } from '../api/customProjectIssues.api';
import { toast } from './useToast';

const KEYS = {
  forProject: (projectId: string) => ['projectIssues', projectId] as const,
};

export function useProjectIssues(projectId: string | undefined) {
  const source = useDataSource();
  return useQuery({
    queryKey: [...KEYS.forProject(projectId ?? ''), source],
    queryFn: () => (usesCustomTables(source) ? listCustomIssues(projectId!) : listProjectIssues(projectId!)),
    enabled: !!projectId,
  });
}

export function useCreateProjectIssue(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'create project issue',
    mutationFn: (payload: ProjectIssueCreate) =>
      usesCustomTables(source) ? createCustomIssue(projectId, payload) : createProjectIssue(payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: KEYS.forProject(projectId) });
      const previous = qc.getQueryData<ProjectIssue[]>(KEYS.forProject(projectId));
      const optimistic = {
        msdyn_projectissueid: `optimistic-${Date.now()}`,
        msdyn_name: payload.msdyn_name,
        msdyn_description: payload.msdyn_description,
        statecode: 0,
        createdon: new Date().toISOString(),
        _msdyn_project_value: projectId,
        _saving: true,
      } as unknown as ProjectIssue;
      qc.setQueryData<ProjectIssue[]>(KEYS.forProject(projectId), (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<ProjectIssue[]>(KEYS.forProject(projectId), ctx.previous);
      toast.error('Failed to save issue. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
  });
}

export function useUpdateProjectIssue(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'update project issue',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectIssuePayload }) =>
      usesCustomTables(source) ? updateCustomIssue(id, payload) : updateProjectIssue(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to update issue. Please try again.'),
  });
}

export function useDeleteProjectIssue(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'delete project issue',
    mutationFn: (id: string) => (usesCustomTables(source) ? deleteCustomIssue(id) : deleteProjectIssue(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to delete issue. Please try again.'),
  });
}
