import { useQuery } from '@tanstack/react-query';
import { listProjectRequests } from '../api/projectRequests.api';
import type { ProjectRequest } from '../models/projectRequest.model';

export function useProjectSourceRequest(projectId: string | undefined) {
  return useQuery<ProjectRequest | null>({
    queryKey: ['projectSourceRequest', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const results = await listProjectRequests({
        // Custom projects link via _pmo_convertedprojectref_value; pss via the
        // legacy _pmo_convertedproject_value. Match either so the source request
        // resolves in both modes.
        $filter: `(_pmo_convertedprojectref_value eq '${projectId}' or _pmo_convertedproject_value eq '${projectId}') and statecode eq 0`,
      });
      return results.length > 0 ? results[0] : null;
    },
    enabled: !!projectId,
    staleTime: 10 * 60 * 1000,
  });
}
