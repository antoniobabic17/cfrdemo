import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import { listProjectBaselines, createProjectBaseline } from '../api/projectBaselines.api';
import type { ProjectBaselineCreate } from '../models/projectBaseline.model';

const QK = (projectId: string) => ['projectBaselines', projectId] as const;

export function useProjectBaselines(projectId: string | undefined) {
  return useQuery({
    queryKey: QK(projectId ?? ''),
    queryFn: () => listProjectBaselines(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProjectBaseline(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create project baseline',
    mutationFn: (payload: ProjectBaselineCreate) => {
      const { [PSS_PROJECT_BIND]: _a, [CUSTOM_PROJECT_BIND]: _b, ...rest } = payload as Record<string, unknown>;
      return createProjectBaseline({ ...(rest as ProjectBaselineCreate), ...projectBind(projectId, dataSource) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}
