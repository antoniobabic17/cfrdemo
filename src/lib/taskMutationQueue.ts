/**
 * Per-task PSS update queue with coalescing.
 *
 * Stage 3 of the task-write reliability work. Solves the parallel-OperationSet
 * problem introduced when Stage 2 made every field commit fire its own update.
 *
 * Without this queue, rapid edits like `title -> priority -> date` on a single
 * task spawn three independent PSS OperationSets in parallel. Each one burns a
 * slot from the user's 10-opSet quota, and PSS does not guarantee execute-order
 * matches enqueue-order, so a slow flight can clobber a faster newer one.
 *
 * With this queue:
 *   - Each `taskId` has at most ONE PSS update in flight at any time.
 *   - Subsequent updates that arrive while a flight is active are merged into
 *     a single pending patch (`{...pending, ...newPatch}` — last value wins per
 *     field), and fired as ONE call once the in-flight Promise settles.
 *   - The drain loop runs until the pending patch is empty.
 *
 * The queue is transparent to callers. They still `await` a Promise — it just
 * resolves either when their patch lands directly OR when it has been merged
 * into a later coalesced flight that lands successfully.
 *
 * Optimistic cache updates and global error toasts are unaffected — they live
 * in the React Query layer above this module.
 *
 * Stage 4 layer (subscribe + useTaskQueueState):
 *   The queue is the source of truth for "what is being saved right now". A
 *   pub/sub layer exposes a stable per-task snapshot so React components can
 *   subscribe via useSyncExternalStore and render save indicators without
 *   threading boolean state through every prop chain.
 */
import { useSyncExternalStore } from 'react';
import type { ScheduleTaskUpdate } from './schedulingClient';
import { recordFailedSave } from './failedSavesStore';
import { friendlyTaskError, isQuotaError, serializeError } from './utils';

/** Patch payload minus the taskId (identity is the queue key). */
type TaskPatch = Omit<ScheduleTaskUpdate, 'taskId'>;

/** Caller's runner — typically `(p) => updateProjectTask(p, projectId)`. */
type Runner = (params: ScheduleTaskUpdate) => Promise<unknown>;

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/** Public per-task save state surfaced to React. */
export interface TaskQueueSnapshot {
  /** True while a PSS update for this task is in flight. */
  inFlight: boolean;
  /**
   * Union of fields currently being persisted (in-flight) and fields queued
   * for the next flight (pending). Deduped, sorted for stable equality.
   */
  fields: readonly string[];
}

const IDLE_SNAPSHOT: TaskQueueSnapshot = Object.freeze({ inFlight: false, fields: Object.freeze([]) as readonly string[] });

interface QueueState {
  /** Promise of the currently in-flight PSS update for this task. */
  inFlight: Promise<unknown> | null;
  /** Snapshot of the patch keys currently in flight (for UI). */
  inFlightFields: readonly string[];
  /** Coalesced patch waiting to be fired after `inFlight` settles. */
  pending: TaskPatch | null;
  /** Callers awaiting the pending patch. Resolved/rejected together when it lands. */
  waiters: Waiter[];
  /** Runner to use when draining the pending patch. */
  runner: Runner | null;
  /** React subscribers; while > 0 the queue entry is pinned (not garbage-collected when idle). */
  subscribers: Set<() => void>;
  /** Cached immutable snapshot for useSyncExternalStore — only rebuilt when state changes. */
  snapshot: TaskQueueSnapshot;
}

const queues = new Map<string, QueueState>();

function getQueue(taskId: string): QueueState {
  let q = queues.get(taskId);
  if (!q) {
    q = {
      inFlight: null,
      inFlightFields: [],
      pending: null,
      waiters: [],
      runner: null,
      subscribers: new Set(),
      snapshot: IDLE_SNAPSHOT,
    };
    queues.set(taskId, q);
  }
  return q;
}

/** Build a fresh public snapshot from internal state. */
function buildSnapshot(q: QueueState): TaskQueueSnapshot {
  const inFlight = q.inFlight !== null;
  const pendingKeys = q.pending ? Object.keys(q.pending) : [];
  if (!inFlight && pendingKeys.length === 0) return IDLE_SNAPSHOT;
  // Union of in-flight + pending field names, deduped, sorted for stable identity.
  const set = new Set<string>(q.inFlightFields);
  pendingKeys.forEach((k) => set.add(k));
  const fields = Array.from(set).sort();
  return { inFlight, fields };
}

/** Recompute the cached snapshot; if it changed, notify subscribers. */
function notify(q: QueueState): void {
  const next = buildSnapshot(q);
  const prev = q.snapshot;
  // Cheap structural comparison — same inFlight + same field list.
  if (
    prev.inFlight === next.inFlight &&
    prev.fields.length === next.fields.length &&
    prev.fields.every((f, i) => f === next.fields[i])
  ) {
    return;
  }
  q.snapshot = next;
  q.subscribers.forEach((listener) => listener());
}

/**
 * Drain the pending patch for `taskId` — fire it as one PSS update, settle all
 * waiters, then recurse if more patches accumulated during that flight.
 */
function drain(taskId: string): void {
  const q = queues.get(taskId);
  if (!q || !q.pending || !q.runner) {
    if (q && !q.pending) {
      q.inFlight = null;
      q.inFlightFields = [];
      notify(q);
    }
    return;
  }

  const patch = q.pending;
  const waiters = q.waiters;
  const runner = q.runner;
  q.pending = null;
  q.waiters = [];
  q.inFlightFields = Object.keys(patch);

  const flight = runner({ taskId, ...patch });
  q.inFlight = flight;
  notify(q);

  flight.then(
    (value) => {
      waiters.forEach((w) => w.resolve(value));
      if (q.pending) {
        // Drain again — notify happens inside the recursive call.
        drain(taskId);
      } else {
        q.inFlight = null;
        q.inFlightFields = [];
        notify(q);
        // Cleanup: drop the queue entry only if no React subscribers are
        // pinning it. Otherwise keep it so the cached snapshot stays stable.
        if (q.waiters.length === 0 && q.subscribers.size === 0) {
          queues.delete(taskId);
        }
      }
    },
    (err) => {
      // Stage 5: capture the failure so the FailedSavesTray can offer Retry.
      // Mark the err so the global MutationCache toast in App.tsx skips it,
      // since the tray is now the primary surface for task-update failures.
      const raw = serializeError(err);
      recordFailedSave({
        taskId,
        fields: Object.keys(patch),
        patch,
        runner,
        message: friendlyTaskError(raw),
        isQuota: isQuotaError(raw),
      });
      try { (err as { __handledByTray?: boolean }).__handledByTray = true; } catch { /* primitives */ }
      waiters.forEach((w) => w.reject(err));
      if (q.pending) {
        drain(taskId);
      } else {
        q.inFlight = null;
        q.inFlightFields = [];
        notify(q);
        if (q.waiters.length === 0 && q.subscribers.size === 0) {
          queues.delete(taskId);
        }
      }
    },
  );
}

/**
 * Enqueue a task update. Returns a Promise that resolves when this update
 * (possibly merged with later ones) lands successfully, or rejects with the
 * PSS error from the flight that carried it.
 */
export function enqueueTaskUpdate(
  params: ScheduleTaskUpdate,
  runner: Runner,
): Promise<unknown> {
  const { taskId, ...patch } = params;
  const q = getQueue(taskId);
  q.runner = runner;

  return new Promise((resolve, reject) => {
    q.pending = q.pending ? { ...q.pending, ...patch } : { ...patch };
    q.waiters.push({ resolve, reject });
    notify(q);

    // If nothing is in flight, kick the drain immediately. Otherwise the
    // current flight's settle handler will drain us next.
    if (!q.inFlight) drain(taskId);
  });
}

// ── React subscription layer (Stage 4) ────────────────────────────────────────

/**
 * Subscribe to save-state changes for a task. Returns an unsubscribe function.
 * The listener fires whenever the public snapshot changes (in-flight transitions
 * or field-set changes).
 */
function subscribeTaskQueue(taskId: string, listener: () => void): () => void {
  const q = getQueue(taskId);
  q.subscribers.add(listener);
  return () => {
    q.subscribers.delete(listener);
    // If the queue is idle and has no other holders, free the entry.
    if (
      q.subscribers.size === 0 &&
      q.inFlight === null &&
      q.pending === null &&
      q.waiters.length === 0
    ) {
      queues.delete(taskId);
    }
  };
}

/** Read the current snapshot for a task without subscribing. */
function getTaskQueueSnapshot(taskId: string): TaskQueueSnapshot {
  const q = queues.get(taskId);
  return q ? q.snapshot : IDLE_SNAPSHOT;
}

/**
 * React hook: returns the live save-state snapshot for a task. Re-renders the
 * caller whenever a queued update for `taskId` starts or finishes.
 *
 * Pass an empty string (or any falsy id) to disable — the hook returns the
 * frozen idle snapshot and never subscribes, useful when the task isn't loaded
 * yet but the component still mounts.
 */
export function useTaskQueueState(taskId: string | undefined | null): TaskQueueSnapshot {
  const id = taskId || '';
  return useSyncExternalStore(
    (listener) => (id ? subscribeTaskQueue(id, listener) : () => {}),
    () => (id ? getTaskQueueSnapshot(id) : IDLE_SNAPSHOT),
    () => IDLE_SNAPSHOT, // SSR fallback (unused in this app, but required by the API)
  );
}

/**
 * Test/diagnostic helper: snapshot of queue depths per taskId.
 * Exposed on `window.__taskQueueDebug` in development for live inspection.
 */
export function snapshotTaskQueues(): Record<string, { inFlight: boolean; pendingFields: string[]; waiters: number; subscribers: number }> {
  const out: Record<string, { inFlight: boolean; pendingFields: string[]; waiters: number; subscribers: number }> = {};
  queues.forEach((q, taskId) => {
    out[taskId] = {
      inFlight: q.inFlight !== null,
      pendingFields: q.pending ? Object.keys(q.pending) : [],
      waiters: q.waiters.length,
      subscribers: q.subscribers.size,
    };
  });
  return out;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __taskQueueDebug?: () => unknown }).__taskQueueDebug = snapshotTaskQueues;
}
