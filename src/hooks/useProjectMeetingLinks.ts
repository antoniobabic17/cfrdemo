import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import { listProjectMeetingLinks, createProjectMeetingLink, updateProjectMeetingLink, deactivateProjectMeetingLink } from '../api/projectMeetingLinks.api';
import type { ProjectMeetingLinkCreate, ProjectMeetingLinkUpdate } from '../models/projectMeetingLink.model';

const QK = (projectId: string) => ['projectMeetingLinks', projectId] as const;

export function useProjectMeetingLinks(projectId: string | undefined) {
  return useQuery({
    queryKey: QK(projectId ?? ''),
    queryFn: () => listProjectMeetingLinks(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProjectMeetingLink(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create project meeting link',
    mutationFn: (payload: ProjectMeetingLinkCreate) => {
      const { [PSS_PROJECT_BIND]: _a, [CUSTOM_PROJECT_BIND]: _b, ...rest } = payload as Record<string, unknown>;
      return createProjectMeetingLink({ ...(rest as ProjectMeetingLinkCreate), ...projectBind(projectId, dataSource) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useUpdateProjectMeetingLink(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update project meeting link',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectMeetingLinkUpdate }) =>
      updateProjectMeetingLink(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}

export function useDeactivateProjectMeetingLink(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate project meeting link',
    mutationFn: (id: string) => deactivateProjectMeetingLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(projectId) }),
  });
}
