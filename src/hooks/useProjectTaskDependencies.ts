import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectTaskDependencies } from '../api/projectTaskDependencies.api';
import { listCustomTaskDependencies } from '../api/customTaskDependencies.api';
import { useTaskSource } from '../lib/taskSource';
import { applyDependencyStagingOverlay, useStagingRows, type RawTaskDependency } from '../lib/stagingOverlay';

// Query key includes the source dimension so a flag flip forces a
// refetch instead of serving cached data from the other side.
export const DEPENDENCY_KEYS = {
  forProject: (projectId: string, source: string = 'pss') =>
    ['projectTaskDependencies', projectId, source] as const,
};

export function useProjectTaskDependencies(projectId: string | undefined) {
  const source = useTaskSource();
  const customSource = source !== 'pss';
  const query = useQuery({
    queryKey: DEPENDENCY_KEYS.forProject(projectId ?? '', source),
    queryFn: () => (customSource
      ? listCustomTaskDependencies(projectId!)
      : listProjectTaskDependencies(projectId!)),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
  const stagingRows = useStagingRows(projectId);
  return {
    ...query,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    data: useMemo(
      () => (query.data ? applyDependencyStagingOverlay(query.data as unknown as RawTaskDependency[], stagingRows) : query.data),
      [query.data, stagingRows],
    ),
  };
}
