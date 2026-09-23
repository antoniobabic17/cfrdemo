/**
 * Project task mutation hooks.
 *
 * Scheduling actions (CreateOperationSetV1 → PssCreateV1/UpdateV1/DeleteV1 → ExecuteOperationSetV1)
 * are asynchronous — Dataverse lags behind the scheduling service after ExecuteOperationSet returns.
 * The async save pattern here:
 *   1. Optimistic cache update (immediate, user sees the change)
 *   2. Call scheduling action (flight)
 *   3. Wait SCHEDULING_PERSIST_DELAY_MS (calibrated in Phase 0 spike)
 *   4. Invalidate query → re-fetch true server state
 *   5. On error: rollback optimistic state, surface error for toast
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  type ScheduleTaskCreate,
  type ScheduleTaskUpdate,
} from '../lib/schedulingClient';
import {
  stageTaskCreate,
  stageTaskUpdate,
  stageTaskDelete,
  waitForStagingSync,
} from '../lib/stagingClient';
import { refreshStagingRows } from '../lib/stagingOverlay';
import { markPendingExtras, markExtrasDone } from '../lib/pendingExtrasStore';
import { markRetryInFlight, clearRetryInFlight, updateRetryInFlight } from '../lib/retryInFlightRegistry';
import { logAppError } from '../lib/errorLog';
import { isRetryableError } from '../lib/retryPolicy';
import { toast } from './useToast';
import { toFriendlyError, serializeError } from '../lib/utils';
import { enqueueTaskUpdate } from '../lib/taskMutationQueue';
import type { ProjectTask } from '../models/projectTask.model';
import { updateTaskCustomFields } from '../api/projectTasks.api';
import { useCanEditProject, assertCanEditProject } from './useProjectPermissions';
import { useStagingEnabled } from './useStagingEnabled';
import { useTaskSource, usesCustomTables } from '../lib/taskSource';
import { TASK_QUERY_KEYS } from './useProjectTasks';
import {
  createCustomTask,
  updateCustomTask,
  updateCustomTaskEffort,
  deleteCustomTask,
} from '../api/customTasks.api';
import { listCustomTaskDependencies } from '../api/customTaskDependencies.api';
import { persistProjectSchedule } from '../api/customProjects.api';
import { computeFsShifts, FS_CASCADE_SETTING_KEY, type CascadeTask, type CascadeDep } from '../lib/scheduling/finishToStartCascade';
import { useAppSetting } from './useAppSettings';

/** Calendar-day delta between two date-ish values (new - old), noon-UTC cursor
 *  so DST / local-midnight never causes an off-by-one. undefined if unparseable. */
function calendarDayDelta(oldISO: string | null | undefined, newISO: string | null | undefined): number | undefined {
  const o = oldISO?.slice(0, 10);
  const n = newISO?.slice(0, 10);
  if (!o || !n || !/^\d{4}-\d{2}-\d{2}$/.test(o) || !/^\d{4}-\d{2}-\d{2}$/.test(n)) return undefined;
  const [oy, om, od] = o.split('-').map(Number);
  const [ny, nm, nd] = n.split('-').map(Number);
  const oMs = Date.UTC(oy, om - 1, od, 12);
  const nMs = Date.UTC(ny, nm - 1, nd, 12);
  return Math.round((nMs - oMs) / 86_400_000);
}

/**
 * Run the FS scheduling cascade after a custom-source date edit: shift every
 * downstream FS successor by the same calendar-day delta the moved task's START
 * changed by, then PATCH each via updateCustomTask. Best-effort — a cascade
 * failure is logged but never fails the user's own (already-committed) edit.
 * No-op when the flag is off, the start didn't move, or there are no deps.
 */
async function runFsCascade(
  projectId: string,
  movedTaskId: string,
  oldTasks: ProjectTask[] | undefined,
  newStartISO: string | undefined,
): Promise<void> {
  if (!oldTasks || newStartISO === undefined) return;
  const moved = oldTasks.find((t) => t.msdyn_projecttaskid === movedTaskId);
  const delta = calendarDayDelta(moved?.msdyn_scheduledstart, newStartISO);
  if (!delta) return; // undefined or 0 -> nothing to cascade

  const deps = await listCustomTaskDependencies(projectId);
  if (deps.length === 0) return;

  const cascadeTasks: CascadeTask[] = oldTasks.map((t) => ({
    id: t.msdyn_projecttaskid,
    start: t.msdyn_scheduledstart,
    end: t.msdyn_scheduledend ?? t.msdyn_finish,
    isManual: t.msdyn_ismanual ?? undefined,
  }));
  const cascadeDeps: CascadeDep[] = deps.map((d) => ({
    predecessorId: d._msdyn_predecessortask_value ?? '',
    successorId: d._msdyn_successortask_value ?? '',
    linkType: d.msdyn_linktype,
  }));

  const { shifts, cycleDetected } = computeFsShifts(cascadeTasks, cascadeDeps, movedTaskId, delta);
  if (cycleDetected) {
    // eslint-disable-next-line no-console
    console.warn('[fsCascade] dependency cycle detected — skipping cascade for project', projectId);
    return;
  }
  for (const s of shifts) {
    try {
      await updateCustomTask(s.taskId, { scheduledStart: s.newStart, scheduledEnd: s.newEnd });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[fsCascade] failed to shift successor', s.taskId, err);
    }
  }
}

/**
 * Tiered persistence delays based on official Microsoft API performance benchmarks.
 * Source: https://learn.microsoft.com/en-us/dynamics365/project-operations/project-management/project-schedule-api-performance
 *
 * "Total Duration" = Schedule API duration + Project Save Service time + time to sync to Dataverse.
 * Values below are P90 total durations + a small buffer rounded up.
 *
 * | Operation        | P90 (required) | P90 (all fields) | Our delay |
 * |------------------|----------------|------------------|-----------|
 * | Create Task      | 7.86s          | 12.63s           | 14s       |
 * | Update Task      | 7.79s          | 18.72s           | 20s       |
 * | Delete Task      | 7.92s          | 9.68s            | 11s       |
 * | Create Assign    | 10.86s         | 12.81s           | 14s       |
 * | Create Dep       | 9.07s          | 10.35s           | 11s       |
 * | Checklist/Label   | not benchmarked (simpler entities) | 8s  |
 */
export const PSS_DELAY = {
  TASK_CREATE:      14_000, // P90 12.63s + buffer
  TASK_UPDATE:      20_000, // P90 18.72s (worst case: update with all fields)
  TASK_DELETE:      11_000, // P90 9.68s + buffer
  ASSIGNMENT:       14_000, // P90 12.81s + buffer
  DEPENDENCY:       11_000, // P90 10.35s + buffer
  BUCKET:           11_000, // similar to dependency (simple entity)
  METADATA:          8_000, // checklists, labels, sprints — simpler entities, not in benchmarks
  TEMPLATE:         50_000, // bulk create (P90 for 100 tasks: 47.55s)
} as const;

/** @deprecated Use PSS_DELAY tier constants instead. Kept for backward compat. */
export const SCHEDULING_PERSIST_DELAY_MS = PSS_DELAY.TASK_UPDATE;

// -- Retry policy for transient PSS failures --------------------------------
//
// PSS holds task fields read-only for a short window after the record is
// created/hydrated (materialization). Update writes that land inside that
// window come back with E_NOTEDITABLE / E_BATCHFAILED, or as a masking
// duplicate-key error on Microsoft's own msdyn_psserrorlog when PSS logs
// the same failure signature twice for one correlation id. Both classes
// recover on their own if we simply wait and try again with a fresh
// staging row so the plugin drains it in its own OperationSet.
//
// The transient-signature list lives in lib/retryPolicy.ts and is
// shared across every mutation hook (extracted 2026-07-17). We keep a
// LOCAL backoff schedule here because the staging path uses a longer
// 5-attempt tail (15s max) than the generic 4-attempt / 10s max, and
// its per-attempt logging fires bespoke logAppError rows with attempt/
// stagingRowId/outcome fields the generic runWithRetry doesn't emit.
const RETRY_BACKOFFS_MS = [3_000, 6_000, 10_000, 15_000] as const;
const RETRY_MAX_ATTEMPTS = RETRY_BACKOFFS_MS.length + 1; // 5: initial + 4 retries
const isRetryableStagingError = isRetryableError;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single source of truth for the task-list cache key lives in useProjectTasks.
// It is source-versioned (['projectTasks', projectId, source]); optimistic
// writes MUST target the same key the read hook observes, otherwise the
// optimistic row lands in a phantom cache entry and the tile only appears
// after the post-write refetch. `source` is threaded in from each hook's
// useTaskSource() call.
const TASK_KEYS = {
  forProject: (projectId: string, source: string) => TASK_QUERY_KEYS.forProject(projectId, source),
};

// ── Create ────────────────────────────────────────────────────────────────────

export function useCreateProjectTask(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProject(projectId);
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();

  return useMutation({
    mutationFn: async (params: ScheduleTaskCreate): Promise<{ taskId?: string }> => {
      assertCanEditProject(permission, 'create a task on this project');
      // Option-C custom path: direct OData create on pmo_task (no PSS/staging).
      // dv.create returns the real GUID synchronously; the onMutate optimistic
      // row is reconciled by the onSettled invalidate refetch.
      if (usesCustomTables(source)) {
        const { taskId, taskNumber } = await createCustomTask({
          projectId: params.projectId,
          subject: params.subject,
          bucketId: params.bucketId,
          parentTaskId: params.parentTaskId,
          scheduledStart: params.scheduledStart,
          scheduledEnd: params.scheduledEnd,
          isMilestone: params.isMilestone,
          priority: params.priority,
          description: params.description,
        });
        // Swap the onMutate optimistic row's fake id for the real GUID and
        // stamp the friendly TASK-##### number so the tile shows it instantly
        // (before the onSettled refetch). Match the newest optimistic row with
        // the same subject + bucket + parent, mirroring the staging path.
        qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) => {
          if (!old) return old;
          for (let i = old.length - 1; i >= 0; i--) {
            const t = old[i];
            if (!t.msdyn_projecttaskid.startsWith('optimistic-')) continue;
            if (t.msdyn_subject !== params.subject) continue;
            if (t['_msdyn_projectbucket_value'] !== params.bucketId) continue;
            if (t['_msdyn_parenttask_value'] !== params.parentTaskId) continue;
            const next = [...old];
            next[i] = { ...t, msdyn_projecttaskid: taskId, pmo_taskid: taskNumber };
            return next;
          }
          return old;
        });
        return { taskId };
      }
      if (stagingEnabled) {
        // Staging path. stageTaskCreate returns the client-generated future
        // msdyn_projecttaskid so we can anchor the pendingExtras spinner
        // BEFORE the drain even completes.
        const { stagingId, taskId } = await stageTaskCreate(params);
        // Set pending immediately -- keeps TaskRow.isSaving true from now
        // through the extras phase. handleAfterCreateTask calls
        // markExtrasDone in its finally block after every extra has been
        // attempted (success OR fail).
        markPendingExtras(taskId);
        // Swap the onMutate optimistic row's fake id for the real taskId
        // so the staging overlay's seenIds guard prevents duplicate
        // synth rows. Match the newest optimistic-* row with the same
        // subject + bucket + parent so concurrent creates don't collide.
        qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) => {
          if (!old) return old;
          // Find newest matching optimistic. Walk in reverse (recently
          // added lands at the end via [...old, optimisticTask]).
          for (let i = old.length - 1; i >= 0; i--) {
            const t = old[i];
            if (!t.msdyn_projecttaskid.startsWith('optimistic-')) continue;
            if (t.msdyn_subject !== params.subject) continue;
            if (t['_msdyn_projectbucket_value'] !== params.bucketId) continue;
            if (t['_msdyn_parenttask_value'] !== params.parentTaskId) continue;
            const next = [...old];
            next[i] = { ...t, msdyn_projecttaskid: taskId };
            return next;
          }
          return old;
        });
        try {
          await refreshStagingRows(params.projectId);
          const result = await waitForStagingSync(stagingId, params.projectId);
          if (!result.synced) {
          // Any non-Synced result (Failed or in-flight timeout) surfaces as an
          // error so onError -> onSettled clears the spinner, the toast fires
          // (which writes to logAppError -> pmo_telemetryevent -> visible in
          // Admin > Error Log), and the failed staging row remains in Stuck
          // rows for the operator to Retry when they want. handleAfterCreateTask
          // will not run (mutation rejected) so the pendingExtras flag will
          // never be cleared by the finally block; onSettled below force-clears.
            // Failure path: clear pendingExtras so the spinner/lock releases
            // for the (now-failed) overlay/OData row. Then throw so the
            // mutation's .catch chain fires the toast + error-log write.
            markExtrasDone(taskId);
            throw new Error(result.error ?? 'Save failed.');
          }
          // Sync complete. Invalidate + refetch the tasks query BEFORE we
          // return so the OData response contains the new task before the
          // overlay drops the Synced staging row.
          await qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
          await qc.refetchQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
          return { taskId };
        } catch (err) {
          // Any other throw (network, refresh failure, etc.). Same rule --
          // release the spinner so the user is not locked forever.
          markExtrasDone(taskId);
          throw err;
        }
      }
      await createProjectTask(params);
      return {};
    },

    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });

      // Unique per-mutation id so onSettled can find *this* optimistic row
      // among any concurrent creates and clear only its _saving flag.
      const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticTask: ProjectTask = {
        msdyn_projecttaskid: optimisticId,
        msdyn_subject: params.subject,
        msdyn_scheduledstart: params.scheduledStart,
        msdyn_scheduledend: params.scheduledEnd,
        msdyn_duration: params.duration,
        msdyn_ismilestone: params.isMilestone,
        msdyn_progress: 0,
        msdyn_outlinelevel: 1,
        statecode: 0,
        '_msdyn_project_value': params.projectId,
        '_msdyn_projectbucket_value': params.bucketId,
        '_msdyn_parenttask_value': params.parentTaskId,
        _saving: true,
      };

      // Insert the optimistic row unconditionally. In staging mode we used
      // to skip this and rely on refreshStagingRows() in mutationFn to
      // synthesize a spinner-bearing row -- but there's a window between
      // the user's click and stageTaskCreate() returning where nothing is
      // in the cache and the tile visibly disappears (Chandra's 2026-07-17
      // report). Now we insert with the fake optimistic- id in onMutate,
      // then swap in the real taskId later once stageTaskCreate resolves
      // (see mutationFn below). The stagingOverlay's seenIds guard means
      // once the id is real, no synth row is added on top -- no duplicate.
      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old ? [...old, optimisticTask] : [optimisticTask],
      );

      // Return via mutation context so onSettled can identify our row among
      // any concurrent create-mutation optimistic rows (legacy path only;
      // in staging mode there is no cache row for onSettled to reconcile).
      return { optimisticId };
    },

    // Do NOT roll back the optimistic record on error. The PSS executeOperationSet
    // call frequently throws (timeout / transient gateway error) AFTER PSS has
    // already queued and applied the create server-side -- rolling back makes the
    // user's freshly-created task vanish for ~20s, then reappear when some other
    // refetch fires. They click again, and now there are two of the same task.
    // Instead, leave the optimistic in place. The post-PSS_DELAY invalidate in
    // onSettled refetches the real list -- if PSS did persist, the real task
    // replaces the optimistic; if it truly did not, the optimistic is dropped.
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.warn('[useCreateProjectTask] mutation error (keeping optimistic, will reconcile on refetch):', err);
    },

    // Keep the optimistic record in a "_saving=true" state through the full
    // PSS_DELAY.TASK_CREATE window so the user sees a spinner / greyed-out
    // tile for the *entire* lifetime of the create — not just the brief
    // OperationSet promise. Previously _saving was cleared the moment the
    // promise settled, which made the tile look "done" while PSS was still
    // committing; if a sibling refetch fired in that gap the optimistic
    // disappeared until PSS_DELAY completed and the invalidate refetched.
    //
    // Concurrency: the tasks query key is project-scoped, so when a user creates
    // Task A (bucket 2) then Task B (bucket 1) in quick succession, both live as
    // optimistic rows in the same cache array. When Task A's onSettled fires its
    // invalidateQueries, the refetched server list does NOT yet contain Task B
    // (still in flight in PSS) — React Query replaces the cache and Task B's
    // optimistic row is evicted, so its spinner disappears. To prevent that, we
    // snapshot sibling optimistic rows before the invalidate and re-attach any
    // the refetch didn't yet include. Each create is responsible for clearing
    // its OWN _saving flag (scoped by optimisticId) rather than blanket-clearing
    // every _saving row in the cache — the previous safety net cleared sibling
    // spinners early too.
    onSettled: async (_data, _err, _vars, context) => {
      const optimisticId = (context as { optimisticId?: string } | undefined)?.optimisticId;

      // Custom (Option-C) path is a synchronous direct-OData create: dv.create
      // already returned the real GUID and mutationFn swapped it onto the tile.
      // There is no PSS commit lag to wait out, so reconcile immediately instead
      // of parking the spinner for the full PSS_DELAY window (the ~14s "why is
      // create still slow" report). Only the PSS path needs the settle wait.
      if (source !== 'custom') {
        await new Promise((r) => setTimeout(r, PSS_DELAY.TASK_CREATE));
      } else {
        // Persist the project's task-derived finish (pmo_finish) — PSS keeps
        // msdyn_finish current on create; mirror that. Fire-and-forget so the
        // tile reconcile isn't blocked.
        void persistProjectSchedule(projectId);
      }

      // Snapshot other in-flight optimistic rows before we invalidate.
      // Exclude our own — its fate is decided by the refetch (present ⇒
      // persisted; absent ⇒ we drop the spinner via the safety net below).
      const before = qc.getQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source)) ?? [];
      const siblingOptimistics = before.filter(
        (t) =>
          t._saving &&
          t.msdyn_projecttaskid.startsWith('optimistic-') &&
          t.msdyn_projecttaskid !== optimisticId,
      );

      await qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });

      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) => {
        if (!old) return old;

        // Safety net: if our OWN optimistic row survived the refetch (PSS
        // truly hasn't persisted our create yet), drop *its* spinner only.
        // Never blanket-clear _saving across the whole list — that would
        // freeze sibling creates' spinners before their PSS_DELAY elapsed.
        const withOwnSpinnerCleared = optimisticId
          ? old.map((t) =>
              t.msdyn_projecttaskid === optimisticId && t._saving
                ? { ...t, _saving: false }
                : t,
            )
          : old;

        // Re-attach sibling optimistics the refetch didn't yet include.
        // Their own onSettled owns clearing their _saving flag; we do not
        // touch it here.
        const knownIds = new Set(withOwnSpinnerCleared.map((t) => t.msdyn_projecttaskid));
        const missingSiblings = siblingOptimistics.filter(
          (s) => !knownIds.has(s.msdyn_projecttaskid),
        );

        return missingSiblings.length > 0
          ? [...withOwnSpinnerCleared, ...missingSiblings]
          : withOwnSpinnerCleared;
      });
    },
  });
}

// ── Update ────────────────────────────────────────────────────────────────────

export function useUpdateProjectTask(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProject(projectId);
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();
  // FS cascade is opt-in via pmo.fs_cascade_enabled. Read it here so the flag
  // subscribes the hook to settings; the cascade only runs on the custom source.
  const fsCascadeEnabled = useAppSetting(FS_CASCADE_SETTING_KEY) === 'true';

  return useMutation({
    // Stage 3: route through per-task queue so concurrent edits to the same
    // task are coalesced into a single in-flight PSS OperationSet rather than
    // spawning parallel ones that race + burn the user's 10-opSet quota.
    //
    // Staging mode: the queue's runner writes to pmo_taskstaging instead of
    // firing PSS directly. Per-task coalescing still applies so N rapid field
    // edits merge into ONE staging row before the plugin picks it up.
    mutationFn: async (params: ScheduleTaskUpdate) => {
      assertCanEditProject(permission, 'update this task');
      // Option-C custom path: direct OData PATCH on pmo_task (no PSS/staging).
      if (usesCustomTables(source)) {
        await updateCustomTask(params.taskId, {
          subject: params.subject,
          progress: params.progress,
          effortCompleted: params.effortCompleted,
          effort: params.effort,
          scheduledStart: params.scheduledStart,
          scheduledEnd: params.scheduledEnd,
          isMilestone: params.isMilestone,
          priority: params.priority,
          description: params.description,
          bucketId: params.bucketId,
        });
        return { stagingId: '' };
      }
      if (stagingEnabled) {
        // Auto-retry loop for transient PSS materialization failures. Each
        // attempt creates a FRESH pmo_taskstaging row so the plugin drains
        // it in its own OperationSet -- that is what makes the retry work.
        // While this loop runs the target task is marked in the retry
        // registry so StagingFailureWatcher suppresses per-attempt toasts;
        // the loop owns all outcome logging (succeeded / gave-up).
        markRetryInFlight(params.taskId, {
          action: 'staging update task retry',
          entityType: 'task',
          entityId: params.taskId,
          parentProjectId: projectId,
        });
        let firstStagingId: string | undefined;
        try {
          return await enqueueTaskUpdate(params, async (m) => {
            // Guard against empty-payload updates. If the coalesced
            // params contain nothing except the taskId, staging + PSS
            // will fail with "OperationSet is empty" (seen 2026-07-21).
            // Short-circuit so the mutation reports success without
            // writing a pmo_taskstaging row.
            const changeKeys = Object.keys(m).filter((k) => k !== 'taskId' && (m as unknown as Record<string, unknown>)[k] !== undefined);
            if (changeKeys.length === 0) {
              markExtrasDone(params.taskId);
              return { stagingId: '' };
            }
            let lastErr: unknown = undefined;
            for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
              try {
                const { stagingId } = await stageTaskUpdate(m, projectId);
                if (!firstStagingId) {
                  firstStagingId = stagingId;
                  updateRetryInFlight(params.taskId, { firstStagingId });
                }
                updateRetryInFlight(params.taskId, { attemptSoFar: attempt });
                await refreshStagingRows(projectId);
                const r = await waitForStagingSync(stagingId, projectId);
                if (r.synced) {
                  if (attempt > 1) {
                    try {
                      logAppError({
                        message: `Task update succeeded on attempt ${attempt}.`,
                        action: 'staging update task retry',
                        entityType: 'task',
                        entityId: m.taskId,
                        parentProjectId: projectId,
                        attempt,
                        outcome: 'succeeded',
                        stagingRowId: firstStagingId,
                      });
                    } catch { /* logging is best-effort */ }
                  }
                  return { stagingId };
                }
                lastErr = new Error(r.error ?? 'Save failed.');
                try {
                  logAppError({
                    message: `Task update attempt ${attempt} failed.`,
                    rawError: r.error,
                    action: 'staging update task retry',
                    entityType: 'task',
                    entityId: m.taskId,
                    parentProjectId: projectId,
                    attempt,
                    stagingRowId: firstStagingId,
                  });
                } catch { /* logging is best-effort */ }
                if (!isRetryableStagingError(r.error)) throw lastErr;
                if (attempt < RETRY_MAX_ATTEMPTS) {
                  await delay(RETRY_BACKOFFS_MS[attempt - 1]);
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                lastErr = err;
                try {
                  logAppError({
                    message: `Task update attempt ${attempt} failed.`,
                    rawError: msg,
                    action: 'staging update task retry',
                    entityType: 'task',
                    entityId: m.taskId,
                    parentProjectId: projectId,
                    attempt,
                    stagingRowId: firstStagingId,
                  });
                } catch { /* logging is best-effort */ }
                if (!isRetryableStagingError(msg)) throw err;
                if (attempt < RETRY_MAX_ATTEMPTS) {
                  await delay(RETRY_BACKOFFS_MS[attempt - 1]);
                }
              }
            }
            try {
              logAppError({
                message: `Task update gave up after ${RETRY_MAX_ATTEMPTS} attempts.`,
                rawError: lastErr instanceof Error ? lastErr.message : String(lastErr),
                action: 'staging update task retry',
                entityType: 'task',
                entityId: m.taskId,
                parentProjectId: projectId,
                attempt: RETRY_MAX_ATTEMPTS,
                outcome: 'gave-up-auto-retry',
                stagingRowId: firstStagingId,
              });
            } catch { /* logging is best-effort */ }
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
          });
        } finally {
          clearRetryInFlight(params.taskId);
        }
      }
      return enqueueTaskUpdate(params, (m) => updateProjectTask(m, projectId));
    },

    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source));

      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old?.map((t) => {
          if (t.msdyn_projecttaskid !== params.taskId) return t;
          // Stage 7: when the user changes Hours done (effortCompleted), the
          // card's % bar reads msdyn_progress directly. PSS recomputes it
          // server-side but that's ~20s out. Compute it optimistically here
          // so the card refreshes the same instant the panel preview does.
          const nextEffortCompleted = params.effortCompleted !== undefined
            ? params.effortCompleted
            : t.msdyn_effortcompleted;
          const nextEffort = params.effort !== undefined ? params.effort : t.msdyn_effort;
          const optimisticProgress =
            nextEffort !== undefined && nextEffort > 0 && nextEffortCompleted !== undefined
              ? Math.min(1, nextEffortCompleted / nextEffort)
              : t.msdyn_progress;
          return {
                ...t,
                ...(params.subject !== undefined ? { msdyn_subject: params.subject } : {}),
                ...(params.progress !== undefined ? { msdyn_progress: params.progress } : {}),
                ...(params.effortCompleted !== undefined ? { msdyn_effortcompleted: params.effortCompleted, msdyn_progress: optimisticProgress } : {}),
                ...(params.effort !== undefined ? { msdyn_effort: params.effort, msdyn_progress: optimisticProgress } : {}),
                ...(params.scheduledStart !== undefined ? { msdyn_scheduledstart: params.scheduledStart } : {}),
                ...(params.scheduledEnd !== undefined ? { msdyn_scheduledend: params.scheduledEnd } : {}),
                ...(params.duration !== undefined ? { msdyn_duration: params.duration } : {}),
                ...(params.isMilestone !== undefined ? { msdyn_ismilestone: params.isMilestone } : {}),
                ...(params.priority !== undefined ? { msdyn_priority: params.priority } : {}),
                ...(params.description !== undefined ? { msdyn_description: params.description } : {}),
                ...(params.bucketId !== undefined ? { '_msdyn_projectbucket_value': params.bucketId } : {}),
                _saving: true,
              };
        }),
      );

      return { prev };
    },

    onError: (err, vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(TASK_KEYS.forProject(projectId, source), context.prev);
      }
      // Fix F3 (2026-07-16): surface every task-update failure via toast +
      // errorLog. Previously errors were caught and rolled back but never
      // shown -- users would click Save, see the bar flash, and have no
      // idea their write bounced. This restores the "robust error path"
      // the operator called out.
      const friendly = toFriendlyError(err);
      toast.error(`Task update failed: ${friendly}`);
      try {
        logAppError({
          message: `Task update failed: ${friendly}`,
          rawError: serializeError(err),
          action: 'task update',
          entityType: 'task',
          entityId: (vars as { taskId?: string })?.taskId,
          parentProjectId: projectId,
        });
      } catch { /* logging is best-effort */ }
    },

    onSuccess: async (_data, vars, context) => {
      // Custom path writes land synchronously — no PSS commit lag to wait out.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.TASK_UPDATE));
      // FS scheduling cascade (custom source only, flag-gated): if the user
      // moved this task's start date, shift its downstream FS successors by the
      // same delta. Uses the PRE-EDIT list from onMutate's context so we can
      // compute the delta against the old start. Best-effort — never blocks the
      // (already-committed) user edit; runs before the invalidate so the refetch
      // picks up the shifted successors in one pass.
      if (usesCustomTables(source) && fsCascadeEnabled) {
        const prev = (context as { prev?: ProjectTask[] } | undefined)?.prev;
        const params = vars as ScheduleTaskUpdate;
        await runFsCascade(projectId, params.taskId, prev, params.scheduledStart);
      }
      // Persist the project's task-derived finish (a date edit can move it).
      if (usesCustomTables(source)) void persistProjectSchedule(projectId);
      qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
    },

    // Clear _saving the moment the update promise settles, so a slow or
    // dropped post-PSS invalidate can't leave the card permanently locked.
    onSettled: () => {
      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old?.map((t) => (t._saving ? { ...t, _saving: false } : t)),
      );
    },
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function useDeleteProjectTask(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProject(projectId);
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();

  return useMutation({
    mutationFn: async (taskId: string) => {
      assertCanEditProject(permission, 'delete this task');
      if (usesCustomTables(source)) {
        await deleteCustomTask(taskId);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageTaskDelete(taskId, projectId);
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return deleteProjectTask(taskId, projectId);
    },

    onMutate: async (taskId) => {
      await qc.cancelQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source));

      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old?.filter((t) => t.msdyn_projecttaskid !== taskId),
      );

      return { prev };
    },

    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(TASK_KEYS.forProject(projectId, source), context.prev);
      }
    },

    onSuccess: async () => {
      // Custom path deletes land synchronously — no PSS commit lag to wait out.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.TASK_DELETE));
      // Re-derive + persist the project finish (deleting the latest task moves it,
      // or clears it if that was the last dated task).
      if (usesCustomTables(source)) void persistProjectSchedule(projectId);
      qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
    },
  });
}

// ---- Custom-field effort tracking (bypasses PSS) --------------------------

/**
 * Update a task's CVS-owned effort columns (pmo_taskeffort +
 * pmo_taskhoursdone). Direct OData PATCH -- no staging, no PSS.
 *
 * These columns are decoupled from PSS's scheduling triangle, so date
 * writes never fight with effort writes. The mutation is fast (single
 * HTTP round-trip) and cannot fail with E_NOTEDITABLE / AV-0044 /
 * CorrelationId dup-key masking.
 */
export interface TaskCustomFieldsPatch {
  pmo_taskeffort?: number | null;
  pmo_taskhoursdone?: number | null;
}

export function useUpdateTaskCustomFields(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProject(projectId);
  const source = useTaskSource();

  return useMutation({
    mutationFn: async (params: { taskId: string; patch: TaskCustomFieldsPatch }) => {
      assertCanEditProject(permission, 'update this task effort');
      // Custom path writes the unified pmo_task effort columns; PSS path
      // writes pmo_taskeffort/pmo_taskhoursdone on msdyn_projecttask.
      if (usesCustomTables(source)) {
        await updateCustomTaskEffort(params.taskId, {
          effort: params.patch.pmo_taskeffort,
          effortCompleted: params.patch.pmo_taskhoursdone,
        });
        return;
      }
      await updateTaskCustomFields(params.taskId, params.patch);
    },
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
      const prev = qc.getQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source));
      qc.setQueryData<ProjectTask[]>(TASK_KEYS.forProject(projectId, source), (old) =>
        old?.map((t) => {
          if (t.msdyn_projecttaskid !== taskId) return t;
          const nextEffort =
            patch.pmo_taskeffort !== undefined
              ? (patch.pmo_taskeffort ?? undefined)
              : t.pmo_taskeffort;
          const nextHoursDone =
            patch.pmo_taskhoursdone !== undefined
              ? (patch.pmo_taskhoursdone ?? undefined)
              : t.pmo_taskhoursdone;
          // Recompute msdyn_progress optimistically so downstream
          // consumers (BucketSection Completed split, TaskListView
          // progress bar, deriveTaskStatus) update the same tick the
          // user commits the edit -- rather than lagging until PSS
          // re-invalidates ~20s later. Fixes operator report:
          // Done tile drops hours 20 -> 10, task stayed under the
          // Completed collapsable until refresh.
          const optimisticProgress =
            nextEffort !== undefined && nextEffort > 0 && nextHoursDone !== undefined
              ? Math.min(100, Math.max(0, (nextHoursDone / nextEffort) * 100))
              : t.msdyn_progress;
          return {
            ...t,
            ...(patch.pmo_taskeffort    !== undefined ? { pmo_taskeffort:    patch.pmo_taskeffort    ?? undefined } : {}),
            ...(patch.pmo_taskhoursdone !== undefined ? { pmo_taskhoursdone: patch.pmo_taskhoursdone ?? undefined } : {}),
            msdyn_progress: optimisticProgress,
          };
        }),
      );
      return { prev };
    },
    onError: (err, vars, context) => {
      if (context?.prev !== undefined) {
        qc.setQueryData(TASK_KEYS.forProject(projectId, source), context.prev);
      }
      // Fix F4 (2026-07-16): surface direct-OData effort-column failures.
      // Same pattern as F3 -- no more silent no-ops when a PATCH bounces.
      const friendly = toFriendlyError(err);
      toast.error(`Effort update failed: ${friendly}`);
      try {
        logAppError({
          message: `Effort update failed: ${friendly}`,
          rawError: serializeError(err),
          action: 'task effort update',
          entityType: 'task',
          entityId: (vars as { taskId?: string })?.taskId,
          parentProjectId: projectId,
        });
      } catch { /* logging is best-effort */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_KEYS.forProject(projectId, source) });
    },
  });
}
