import { useQuery } from '@tanstack/react-query';
import { listProjectTeamMembers } from '../api/projectTeamMembers.api';

const KEYS = {
  forProject: (projectId: string) => ['projectTeamMembers', projectId] as const,
};

export function useProjectTeamMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: KEYS.forProject(projectId ?? ''),
    queryFn: () => listProjectTeamMembers(projectId!),
    enabled: !!projectId,
  });
}
