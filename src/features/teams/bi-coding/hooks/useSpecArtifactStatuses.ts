/**
 * Hook: fetch SpecLifecycle artifact status rows for a project.
 *
 * Only fetches when projectId is defined and the calling component is rendered
 * (i.e., the Coding tab is visible for a BI-team project). The query is
 * lazy-initialized and does not run for non-BI projects because the Coding tab
 * component is never mounted.
 */
import { useQuery } from '@tanstack/react-query';
import { listSpecArtifactStatuses } from '../api/specArtifactStatus.api';
import type { SpecArtifactStatusRow } from '../api/specArtifactStatus.api';

export type { SpecArtifactStatusRow };

export function useSpecArtifactStatuses(projectId: string | undefined) {
  return useQuery<SpecArtifactStatusRow[]>({
    queryKey: ['specArtifactStatuses', projectId],
    queryFn: () => listSpecArtifactStatuses(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}
