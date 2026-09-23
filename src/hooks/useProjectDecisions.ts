import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listProjectDecisions, createProjectDecision, updateProjectDecision, deactivateProjectDecision } from '../api/projectDecisions.api';
import type { ProjectDecision, ProjectDecisionCreate, ProjectDecisionUpdate } from '../models/projectDecision.model';
import { toast } from './useToast';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';

const QK = (projectId: string) => ['projectDecisions', projectId] as const;

export function useProjectDecisions(projectId: string | undefined) {
  return useQuery({
    queryKey: QK(projectId ?? ''),
    queryFn: () => listProjectDecisions(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProjectDecision(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create project decision',
    mutationFn: (payload: ProjectDecisionCreate) => {
      const { [PSS_PROJECT_BIND]: _a, [CUSTOM_PROJECT_BIND]: _b, ...rest } = payload as Record<string, unknown>;
      return createProjectDecision({ ...(rest as ProjectDecisionCreate), ...projectBind(projectId, dataSource) });
    },
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: QK(projectId) });
      const previous = qc.getQueryData<ProjectDecision[]>(QK(projectId));
      const optimistic = {
        pmo_projectdecisionid: `optimistic-${Date.now()}`,
        pmo_name: payload.pmo_name,
        pmo_description: payload.pmo_description,
        pmo_status: payload.pmo_status,
        pmo_decisiondate: payload.pmo_decisiondate,
        statecode: 0,
        createdon: new Date().toISOString(),
        _pmo_project_value: projectId,
        _saving: true,
      } as unknown as ProjectDecision;
      qc.setQueryData<ProjectDecision[]>(QK(projectId), (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData<ProjectDecision[]>(QK(projectId), ctx.previous);
      toast.error('Failed to save decision. Please try again.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useUpdateProjectDecision(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update project decision',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectDecisionUpdate }) =>
      updateProjectDecision(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
    onError: () => toast.error('Failed to update decision. Please try again.'),
  });
}

export function useDeactivateProjectDecision(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate project decision',
    mutationFn: (id: string) => deactivateProjectDecision(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
    onError: () => toast.error('Failed to delete decision. Please try again.'),
  });
}
