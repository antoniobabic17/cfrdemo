import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectTasks } from '../api/projectTasks.api';
import { listCustomTasks } from '../api/customTasks.api';
import { useTaskSource } from '../lib/taskSource';
import { applyTaskDateOverrides, subscribeToOverrides, getOverrideVersion } from '../lib/taskDateOverrides';
import { applyTaskStagingOverlay, useStagingRows } from '../lib/stagingOverlay';

// Query keys are versioned by source so a flag flip (pss <-> custom)
// doesn't accidentally serve a cached response from the other side.
//
// EXPORTED as the single source of truth for the task-list cache key.
// Mutation hooks (useProjectTaskMutations, useProjectSprints) MUST write
// optimistic rows through this same key -- an exact-match setQueryData
// against a source-less key lands in a phantom cache entry that no
// observer reads, so the optimistic tile never renders until the
// post-write refetch (the "tile takes ~5s to appear" bug). See
// docs/pss-decoupling-c-design.md.
export const TASK_QUERY_KEYS = {
  forProject: (projectId: string, source: string) =>
    ['projectTasks', projectId, source] as const,
};
const KEYS = TASK_QUERY_KEYS;

/**
 * Task-list query hook.
 *
 * Reads from either msdyn_projecttask (default, source='pss') or from our
 * custom pmo_task shadow table (source='hybrid' or 'custom'). Downstream
 * consumers see the same `ProjectTask` shape either way -- custom-side
 * rows are normalized by `normalizeCustomTask` in api/customTasks.api.ts.
 *
 * Rollback: flip `pmo.task_source` back to `pss` in Admin > Settings and
 * every screen reverts to the msdyn_projecttask read path within seconds
 * (query key changes force a refetch).
 *
 * See docs/pss-decoupling-c-design.md for the Phase-3 migration plan.
 */
export function useProjectTasks(projectId: string | undefined) {
  const source = useTaskSource();
  const customSource = source !== 'pss';

  const query = useQuery({
    queryKey: KEYS.forProject(projectId ?? '', source),
    queryFn: () => (customSource
      ? listCustomTasks(projectId!)
      : listProjectTasks(projectId!)),
    enabled: !!projectId,
  });

  // Re-run whenever the override store changes so date edits survive
  // cache invalidations.
  const overrideVersion = useSyncExternalStore(subscribeToOverrides, getOverrideVersion);

  // Staging overlay: overlay Pending/InFlight rows from pmo_taskstaging
  // onto the upstream response so users see their edits immediately.
  //
  // Kept ACTIVE during Phase 3 (reads flip to custom, writes still go
  // through PSS + staging). Retired in Phase 5 alongside the staging
  // plugin. When source='custom' AND writes have also flipped (Phase 4),
  // the staging overlay is a no-op because no staging rows exist for
  // that project any more.
  const stagingRows = useStagingRows(projectId);

  return {
    ...query,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    data: useMemo(
      () => {
        if (!query.data) return query.data;
        const overlaid = applyTaskStagingOverlay(query.data, stagingRows);
        return applyTaskDateOverrides(overlaid);
      },
      [query.data, overrideVersion, stagingRows],
    ),
  };
}
