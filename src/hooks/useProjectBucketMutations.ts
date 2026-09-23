import { useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  createProjectBucket,
  renameProjectBucket,
  deleteProjectBucket,
  setProjectBucketOrder,
} from '../api/projectBuckets.api';
import {
  createCustomBucket,
  renameCustomBucket,
  deleteCustomBucket,
  setCustomBucketOrder,
} from '../api/customBuckets.api';
import {
  stageBucketCreate,
  stageBucketUpdate,
  stageBucketDelete,
  waitForStagingSync,
} from '../lib/stagingClient';
import { refreshStagingRows } from '../lib/stagingOverlay';
import { useStagingEnabled } from './useStagingEnabled';
import { useTaskSource, usesCustomTables } from '../lib/taskSource';
import { PSS_DELAY } from './useProjectTaskMutations';
import type { ProjectBucket } from '../models/projectBucket.model';
import { serializeError } from '../lib/utils';
import { friendlyPermissionError } from '../lib/utils';

/**
 * Bucket query key. MUST match the shape used by `useProjectBuckets`
 * (which appends the current task-source from `useTaskSource()`) or
 * every mutation's optimistic setQueryData lands in a phantom cache
 * slot the reader never consults -- and the user has to wait for the
 * network round-trip before seeing the reorder / rename / delete.
 * That was the 2026-07-27 "bucket drag feels laggy on DEV" report.
 *
 * Default `source = 'pss'` matches the app's shipped default
 * (`pmo.task_source` in `pmo_appsetting`) so callers that haven't
 * threaded the source through yet still hit the correct cache.
 */
export const BUCKET_KEYS = {
  forProject: (projectId: string, source: string = 'pss') =>
    ['projectBuckets', projectId, source] as const,
};

/**
 * Drop client-only optimistic placeholder ids before a reorder PATCH.
 *
 * A bucket that is still mid-create carries a placeholder id like
 * `optimistic-1700000000000` (see `useCreateProjectBucket.onMutate`). It has
 * no server row yet, so PATCHing `pmo_bucketorder` on it would put that
 * string into the OData key -- `pmo_projectbuckets(optimistic-...)` -- and
 * Dataverse's URL parser throws `')' or ',' expected at position 11`, which
 * rejected the ENTIRE reorder. That blocked reordering ANY buckets while one
 * was being created (2026-07-28 report). Filtering here keeps the real
 * buckets reorderable; the in-flight bucket gets its slot from the create's
 * own displayOrder plus the post-create invalidate refetch.
 */
export function realBucketIds(orderedIds: string[]): string[] {
  return orderedIds.filter((id) => !id.startsWith('optimistic-'));
}

/**
 * Resolve a reorder that was deferred because the DRAGGED bucket was still
 * being created (its id was a client `optimistic-<ts>` placeholder with no
 * server row -- see `handleReorderBucket` in TaskWorkspace).
 *
 * A PSS bucket create does not return the new GUID (`createScheduledBucket`
 * resolves void); the real row only appears after the post-create invalidate
 * refetch. So we stash the drop intent and re-evaluate it every time the
 * bucket list changes:
 *
 *  - `wait`    -- the optimistic id is still in the list; the create hasn't
 *                 settled. Keep waiting.
 *  - `abandon` -- the optimistic id is gone but no NEW real bucket appeared
 *                 (create failed or was cancelled). Drop the intent.
 *  - `ready`   -- the optimistic id is gone and exactly one bucket is present
 *                 that was not known at drop time; that is the freshly
 *                 created row. Swap the optimistic slot in `orderedIds` for
 *                 its real id and hand back a fully-real ordered list.
 *
 * Correlation is by "id not previously known" (`knownRealIds` captured at
 * drop time), NOT by name -- so a concurrent rename or a duplicate 'Bucket N'
 * name can't misroute it. If more than one unknown id shows up (two creates
 * settling together) we can't safely pick, so we abandon rather than guess.
 */
/**
 * Core correlation shared by every deferred bucket action. Answers: has the
 * still-creating bucket (`optimisticId`) settled into a real server row yet,
 * and if so which GUID is it?
 *
 *  - `wait`     -- placeholder still present; create in flight.
 *  - `abandon`  -- placeholder gone, but zero or >1 previously-unknown real
 *                  buckets appeared, so we can't safely identify ours
 *                  (create failed/cancelled, or two creates settled at once).
 *  - `resolved` -- placeholder gone and exactly one new real bucket appeared;
 *                  `realId` is it.
 *
 * Correlation is by "id not known at intent time" (`knownRealIds`), NOT by
 * name, so a concurrent rename or duplicate 'Bucket N' name can't misroute.
 */
export type NewBucketIdResult =
  | { status: 'wait' }
  | { status: 'abandon' }
  | { status: 'resolved'; realId: string };

export function resolveNewBucketId(
  buckets: ProjectBucket[],
  optimisticId: string,
  knownRealIds: Set<string>,
): NewBucketIdResult {
  const currentIds = buckets.map((b) => b.msdyn_projectbucketid);
  if (currentIds.includes(optimisticId)) return { status: 'wait' };
  const newlyReal = currentIds.filter(
    (id) => !id.startsWith('optimistic-') && !knownRealIds.has(id),
  );
  if (newlyReal.length !== 1) return { status: 'abandon' };
  return { status: 'resolved', realId: newlyReal[0] };
}

/**
 * Resolve a reorder that was deferred because the DRAGGED bucket was still
 * being created. Once its real GUID lands, swap the optimistic slot in
 * `orderedIds` for it and hand back a fully-real ordered list.
 */
export interface DeferredReorderInput {
  orderedIds: string[];
  optimisticId: string;
  buckets: ProjectBucket[];
  knownRealIds: Set<string>;
}
export type DeferredReorderResult =
  | { status: 'wait' }
  | { status: 'abandon' }
  | { status: 'ready'; orderedIds: string[] };

export function resolveDeferredReorder(input: DeferredReorderInput): DeferredReorderResult {
  const { orderedIds, optimisticId, buckets, knownRealIds } = input;
  const r = resolveNewBucketId(buckets, optimisticId, knownRealIds);
  if (r.status !== 'resolved') return r;
  const mapped = orderedIds.map((id) => (id === optimisticId ? r.realId : id));
  const resolved = mapped.filter((id) => !id.startsWith('optimistic-'));
  return { status: 'ready', orderedIds: resolved };
}

/**
 * Resolve a DELETE that was requested while the bucket was still being
 * created. `cancelBucketCreate` only stops a create that hasn't started its
 * PSS round-trip yet; a create already in flight (the common case, since PSS
 * takes ~15s) completes server-side regardless, and the post-create refetch
 * brings the row back. So we ALSO stash a delete intent and, once the real
 * GUID lands, issue a real delete against it (2026-07-28 report).
 *
 *  - `wait`   -- create still in flight; keep waiting.
 *  - `noop`   -- placeholder gone and no new row appeared -> cancel won the
 *                race, nothing to delete.
 *  - `delete` -- new real row landed; delete `realId`.
 */
export type DeferredDeleteResult =
  | { status: 'wait' }
  | { status: 'noop' }
  | { status: 'delete'; realId: string };

export function resolveDeferredDelete(
  buckets: ProjectBucket[],
  optimisticId: string,
  knownRealIds: Set<string>,
): DeferredDeleteResult {
  const r = resolveNewBucketId(buckets, optimisticId, knownRealIds);
  if (r.status === 'wait') return { status: 'wait' };
  if (r.status === 'abandon') return { status: 'noop' };
  return { status: 'delete', realId: r.realId };
}

export function useCreateProjectBucket(projectId: string) {
  const qc = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();

  return useAppMutation({
    action: 'create project bucket',
    mutationFn: async ({ name, displayOrder }: { name: string; displayOrder?: number }) => {
      // Option-C custom path: direct OData create on pmo_bucket (no PSS).
      if (usesCustomTables(source)) {
        await createCustomBucket(projectId, name, displayOrder);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageBucketCreate({ projectId, name, displayOrder });
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return createProjectBucket(projectId, name, displayOrder);
    },

    onMutate: async ({ name }) => {
      await qc.cancelQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });

      const optimistic: ProjectBucket = {
        msdyn_projectbucketid: `optimistic-${Date.now()}`,
        msdyn_name: name,
        statecode: 0,
        '_msdyn_project_value': projectId,
      };

      qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
        old ? [...old, optimistic] : [optimistic],
      );

      return { optimisticId: optimistic.msdyn_projectbucketid };
    },

    // PERMISSION errors — roll back the optimistic immediately. The server
    // rejected the create outright; no reconciliation will replace the ghost,
    // so leaving it in place produces a bucket that spins forever with a
    // permission-denied banner above it.
    //
    // TRANSIENT / PSS errors — keep the optimistic in place. The PSS
    // executeOperationSet call often throws (timeout / gateway) AFTER PSS has
    // queued the create server-side; rolling back makes the freshly-created
    // bucket vanish for ~20s then reappear when some later refetch fires. The
    // user clicks again and now there are two "Bucket 1"s. The post-PSS_DELAY
    // invalidate in onSettled refetches the real list — if PSS did persist,
    // the real bucket replaces the optimistic; if it truly didn't, the
    // optimistic is dropped.
    onError: (err, _vars, context) => {
      const raw = serializeError(err);
      const isPermError = friendlyPermissionError(raw) !== null;
      if (isPermError && context?.optimisticId) {
        qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
          old ? old.filter((b) => b.msdyn_projectbucketid !== context.optimisticId) : old,
        );
        // eslint-disable-next-line no-console
        console.warn('[useCreateProjectBucket] permission denied — rolling back optimistic bucket');
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '[useCreateProjectBucket] transient error (keeping optimistic, will reconcile on refetch):',
          err,
        );
      }
    },

    onSettled: async () => {
      // Custom path writes land synchronously (real GUID) — no PSS commit lag.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.BUCKET));
      qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
    },
  });
}

export function useRenameProjectBucket(projectId: string) {
  const qc = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();

  return useAppMutation({
    action: 'rename project bucket',
    mutationFn: async ({ bucketId, name }: { bucketId: string; name: string }) => {
      if (usesCustomTables(source)) {
        await renameCustomBucket(bucketId, name);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageBucketUpdate({ bucketId, name }, projectId);
        await refreshStagingRows(projectId);
        const rr = await waitForStagingSync(stagingId, projectId);
        if (!rr.synced && rr.error) throw new Error(rr.error);
        return;
      }
      return renameProjectBucket(projectId, bucketId, name);
    },

    onMutate: async ({ bucketId, name }) => {
      await qc.cancelQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source));

      qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
        old?.map((b) =>
          b.msdyn_projectbucketid === bucketId ? { ...b, msdyn_name: name } : b,
        ),
      );

      return { prev };
    },

    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(BUCKET_KEYS.forProject(projectId, source), context.prev);
      }
    },

    onSuccess: async () => {
      // Custom path writes land synchronously (real GUID) — no PSS commit lag.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.BUCKET));
      qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
    },
  });
}

export function useDeleteProjectBucket(projectId: string) {
  const qc = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();

  return useAppMutation({
    action: 'delete project bucket',
    mutationFn: async (bucketId: string) => {
      if (usesCustomTables(source)) {
        await deleteCustomBucket(bucketId);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageBucketDelete(bucketId, projectId);
        await refreshStagingRows(projectId);
        const rr = await waitForStagingSync(stagingId, projectId);
        if (!rr.synced && rr.error) throw new Error(rr.error);
        return;
      }
      return deleteProjectBucket(projectId, bucketId);
    },

    onMutate: async (bucketId) => {
      await qc.cancelQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source));

      qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
        old?.filter((b) => b.msdyn_projectbucketid !== bucketId),
      );

      return { prev };
    },

    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(BUCKET_KEYS.forProject(projectId, source), context.prev);
      }
    },

    onSuccess: async () => {
      // Custom path writes land synchronously (real GUID) — no PSS commit lag.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.BUCKET));
      qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
    },
  });
}


/**
 * Reorder buckets on the Kanban board via drag-and-drop.
 *
 * Takes the full ordered list of bucket ids in their NEW positions and
 * PATCHes pmo_bucketorder on each row so a plain ascending sort renders
 * them in that order. Uses direct OData PATCH -- PSS blocks writes to
 * msdyn_displayorder on both the scheduling API and direct PATCH, so
 * we track our own order via the pmo_bucketorder custom column.
 *
 * Only rows whose position actually changed get a PATCH; unchanged rows
 * are skipped to keep the request count minimal on drags that only move
 * one bucket.
 *
 * Optimistic cache update: reorder the client cache immediately so the
 * board re-lays-out on drop without waiting for the round-trip. On any
 * failure the cache is rolled back to the pre-drag snapshot.
 */
export function useReorderProjectBuckets(projectId: string) {
  const qc = useQueryClient();
  const source = useTaskSource();

  return useAppMutation({
    action: 'reorder project buckets',
    entityType: 'projectBucket',
    parentProjectId: projectId,
    mutationFn: async ({ orderedIds }: { orderedIds: string[] }) => {
      // Always PATCH every bucket in the new order. We used to skip rows
      // whose current pmo_bucketorder happened to match the target, but
      // that broke drag: onMutate below has ALREADY rewritten the cache
      // to match target before mutationFn runs, so every bucket looks
      // "unchanged" from mutationFn's perspective and zero PATCHes fire.
      // Then onSuccess invalidates -> refetch returns the ACTUAL stored
      // order (still stale server-side) -> cache reverts to the original.
      // Direct PATCH on pmo_bucketorder is a cheap direct-OData write
      // (no PSS involvement) -- always write every bucket in orderedIds
      // and let Dataverse ignore no-op writes on its own.
      // Never PATCH an optimistic placeholder id. A bucket still mid-create
      // holds a client id like `optimistic-1700000000000`; it has no server
      // row, and dropping that string into the OData key
      // (`pmo_projectbuckets(optimistic-...)`) makes Dataverse's URL parser
      // throw `')' or ',' expected at position 11`. That single bad PATCH
      // rejected the whole reorder -- so users couldn't reorder ANY buckets
      // while one was being created (2026-07-28 report). Filter placeholders
      // out and index the survivors contiguously; the in-flight bucket picks
      // up its order from the create's own displayOrder + the post-create
      // invalidate.
      const realIds = realBucketIds(orderedIds);
      // Custom path writes pmo_orderinproject on pmo_bucket; PSS path writes
      // pmo_bucketorder on msdyn_projectbucket. Both are direct OData PATCHes.
      const writeOrder = usesCustomTables(source) ? setCustomBucketOrder : setProjectBucketOrder;
      const patches: Array<Promise<void>> = [];
      for (let i = 0; i < realIds.length; i++) {
        patches.push(writeOrder(realIds[i], i + 1));
      }
      await Promise.all(patches);
    },

    onMutate: async ({ orderedIds }) => {
      await qc.cancelQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source));
      // Rewrite pmo_bucketorder on the cache to match the new order,
      // then re-sort. deriveTaskStatus-style optimistic: consumers that
      // read via listProjectBuckets already sort by getBucketOrder so
      // this shows the new layout the next render.
      qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) => {
        if (!old) return old;
        const byId = new Map(old.map((b) => [b.msdyn_projectbucketid, b]));
        const next: ProjectBucket[] = [];
        orderedIds.forEach((id, i) => {
          const b = byId.get(id);
          if (!b) return;
          const newOrder = i + 1;
          // Mark _saving=true for every bucket whose position changed
          // (Bug 5 fix, 2026-07-17). BucketSection shows a spinner in
          // the header while _saving is true so the tile visibly
          // spins in its new position until success or rollback.
          const moved = b.pmo_bucketorder !== newOrder;
          next.push({ ...b, pmo_bucketorder: newOrder, ...(moved ? { _saving: true } : {}) });
        });
        for (const b of old) {
          if (!orderedIds.includes(b.msdyn_projectbucketid)) next.push(b);
        }
        return next;
      });
      return { prev };
    },

    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(BUCKET_KEYS.forProject(projectId, source), context.prev);
      }
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
    },
    // Belt-and-suspenders: clear _saving on every cached bucket so a
    // rollback (onError restores prev, which was already _saving-free)
    // OR a delayed invalidate that doesn't yet see server's new order
    // still ends up in a clean state without stuck spinners.
    onSettled: () => {
      qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
        old?.map((b) => (b._saving ? { ...b, _saving: false } : b)),
      );
    },
  });
}
