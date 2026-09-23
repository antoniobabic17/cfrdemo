import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore, useMemo } from 'react';
import { listProjectBuckets } from '../api/projectBuckets.api';
import { listCustomBuckets } from '../api/customBuckets.api';
import { useTaskSource } from '../lib/taskSource';
import {
  getPendingBucketCount,
  subscribeToBucketQueue,
} from '../lib/bucketCreationQueue';
import { applyBucketStagingOverlay, useStagingRows } from '../lib/stagingOverlay';
import type { ProjectBucket } from '../models/projectBucket.model';

// Query key includes the source so a flag flip (pss <-> custom) forces
// a refetch instead of serving the cached response from the other side.
const KEYS = {
  forProject: (projectId: string, source: string) =>
    ['projectBuckets', projectId, source] as const,
};

/**
 * Bucket query. Three pieces of glue keep optimistic buckets from flickering
 * out while a PSS create is mid-flight:
 *
 *  1. `staleTime` is held while there are pending PSS bucket creates so a
 *     sibling re-render or window-focus event doesn't refetch and overwrite
 *     the optimistic. Once PSS persists the real bucket the queue's
 *     post-drain invalidate kicks the refetch normally.
 *  2. `refetchOnWindowFocus` is disabled while there are pending creates.
 *     Window-focus refetching the server before PSS has persisted would
 *     replace the cache with no bucket and wipe the optimistic spinner for
 *     ~10s.
 *  3. Defensive merge in queryFn: if a refetch slips through anyway, splice
 *     any optimistic-* rows still in the cached value onto the server
 *     response so the spinner stays visible until the queue's invalidate
 *     fires.
 */
export function useProjectBuckets(projectId: string | undefined) {
  const qc = useQueryClient();
  const pending = useSyncExternalStore(subscribeToBucketQueue, getPendingBucketCount);
  const stagingRows = useStagingRows(projectId);
  const source = useTaskSource();
  const customSource = source !== 'pss';

  const query = useQuery({
    queryKey: KEYS.forProject(projectId ?? '', source),
    queryFn: async () => {
      const server = customSource
        ? await listCustomBuckets(projectId!)
        : await listProjectBuckets(projectId!);
      const cached = qc.getQueryData<ProjectBucket[]>(KEYS.forProject(projectId!, source));
      if (!cached) return server;
      // Match optimistic-vs-persisted by NAME, not by msdyn_projectbucketid.
      // The optimistic uses a synthetic `optimistic-<ts>` id that the server
      // never returns, so the previous id-based check kept every optimistic
      // alive forever — produced ghost "loading" cards next to the real
      // bucket. Names are unique-per-project (handleAddBucket dedupes by
      // intentKey before enqueuing), so name match is safe here.
      const serverNames = new Set(
        server.map((b) => (b.msdyn_name ?? '').trim().toLowerCase()),
      );
      const survivingOptimistics = cached.filter(
        (b) =>
          b.msdyn_projectbucketid.startsWith('optimistic-') &&
          !serverNames.has((b.msdyn_name ?? '').trim().toLowerCase()),
      );
      if (survivingOptimistics.length === 0) return server;
      return [...server, ...survivingOptimistics];
    },
    enabled: !!projectId,
    // Hold the cache fresh while creates are in flight so background
    // refetches can't race the PSS persist window and wipe optimistic rows.
    staleTime: pending > 0 ? 30_000 : 0,
    refetchOnWindowFocus: pending === 0,
  });

  // Staging overlay (see useProjectTasks for rationale).
  return {
    ...query,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    data: useMemo(
      () => (query.data ? applyBucketStagingOverlay(query.data, stagingRows) : query.data),
      [query.data, stagingRows],
    ),
  };
}
