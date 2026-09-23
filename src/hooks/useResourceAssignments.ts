import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listResourceAssignments } from '../api/resourceAssignments.api';
import { listCustomAssignments } from '../api/customTaskAssignments.api';
import { useTaskSource } from '../lib/taskSource';
import { applyAssignmentStagingOverlay, useStagingRows, type RawResourceAssignment } from '../lib/stagingOverlay';

// Query key includes the source so a flag flip (pss <-> custom) forces a
// refetch instead of serving the other side's cached response.
export const RESOURCE_ASSIGNMENT_KEY = (projectId: string, source: string = 'pss') =>
  ['resourceAssignments', projectId, source] as const;

export function useResourceAssignments(projectId: string | undefined) {
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const query = useQuery({
    queryKey: RESOURCE_ASSIGNMENT_KEY(projectId ?? '', source),
    queryFn: () => (customSource ? listCustomAssignments(projectId!) : listResourceAssignments(projectId!)),
    enabled: !!projectId,
    staleTime: 0,
  });
  const stagingRows = useStagingRows(projectId);
  return {
    ...query,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    data: useMemo(
      // Staging overlay only applies on the PSS path; on the custom path there
      // is no staging so the server rows pass through unchanged.
      () => (query.data && !customSource
        ? applyAssignmentStagingOverlay(query.data as unknown as RawResourceAssignment[], stagingRows)
        : query.data),
      [query.data, stagingRows, customSource],
    ),
  };
}
