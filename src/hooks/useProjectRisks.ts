import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectRisks,
  createProjectRisk,
  updateProjectRisk,
  deleteProjectRisk,
  type ProjectRiskCreate,
  type ProjectRiskPayload,
} from '../api/projectRisks.api';
import type { ProjectRisk } from '../models/projectRisk.model';
import { useDataSource, usesCustomTables } from '../lib/taskSource';
import { listCustomRisks, createCustomRisk, updateCustomRisk, deleteCustomRisk } from '../api/customProjectRisks.api';
import { toast } from './useToast';

const KEYS = {
  forProject: (projectId: string) => ['projectRisks', projectId] as const,
};

export function useProjectRisks(projectId: string | undefined) {
  const source = useDataSource();
  return useQuery({
    queryKey: [...KEYS.forProject(projectId ?? ''), source],
    queryFn: () => (usesCustomTables(source) ? listCustomRisks(projectId!) : listProjectRisks(projectId!)),
    enabled: !!projectId,
  });
}

export function useCreateProjectRisk(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'create project risk',
    mutationFn: (payload: ProjectRiskCreate) =>
      usesCustomTables(source) ? createCustomRisk(projectId, payload) : createProjectRisk(payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: KEYS.forProject(projectId) });
      const previous = qc.getQueryData<ProjectRisk[]>(KEYS.forProject(projectId));
      const optimistic = {
        msdyn_projectriskid: `optimistic-${Date.now()}`,
        msdyn_name: 'saving...',
        msdyn_subject: payload.msdyn_subject,
        msdyn_description: payload.msdyn_description,
        statecode: 0,
        createdon: new Date().toISOString(),
        _msdyn_project_value: projectId,
        _saving: true,
      } as unknown as ProjectRisk;
      qc.setQueryData<ProjectRisk[]>(KEYS.forProject(projectId), (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<ProjectRisk[]>(KEYS.forProject(projectId), ctx.previous);
      toast.error('Failed to save risk. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
  });
}

export function useUpdateProjectRisk(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'update project risk',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectRiskPayload }) =>
      usesCustomTables(source) ? updateCustomRisk(id, payload) : updateProjectRisk(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to update risk. Please try again.'),
  });
}

export function useDeleteProjectRisk(projectId: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'delete project risk',
    mutationFn: (id: string) => (usesCustomTables(source) ? deleteCustomRisk(id) : deleteProjectRisk(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) }),
    onError: () => toast.error('Failed to delete risk. Please try again.'),
  });
}
