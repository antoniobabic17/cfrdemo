import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import {
  listProjectCloseouts, createProjectCloseout, updateProjectCloseout, deactivateProjectCloseout,
} from '../api/projectCloseouts.api';
import type { ProjectCloseoutCreate, ProjectCloseoutUpdate } from '../models/projectCloseout.model';

const QK = (projectId: string) => ['projectCloseouts', projectId] as const;

export function useProjectCloseouts(projectId: string | undefined) {
  return useQuery({
    queryKey: QK(projectId ?? ''),
    queryFn: () => listProjectCloseouts(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProjectCloseout(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create project closeout',
    mutationFn: (payload: ProjectCloseoutCreate) => {
      const { [PSS_PROJECT_BIND]: _a, [CUSTOM_PROJECT_BIND]: _b, ...rest } = payload as Record<string, unknown>;
      return createProjectCloseout({ ...(rest as ProjectCloseoutCreate), ...projectBind(projectId, dataSource) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useUpdateProjectCloseout(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update project closeout',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectCloseoutUpdate }) =>
      updateProjectCloseout(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useDeactivateProjectCloseout(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate project closeout',
    mutationFn: (id: string) => deactivateProjectCloseout(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useCloseoutReadiness(projectId: string | undefined) {
  const { data: items = [] } = useProjectCloseouts(projectId);
  const total = items.length;
  const done = items.filter((i) => i.pmo_iscomplete).length;
  return { total, done, isReady: total > 0 && done >= total, items };
}
