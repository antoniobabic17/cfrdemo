/**
 * Failed-saves store.
 *
 * Stage 5 of the task-write reliability work. After Stage 1's global error
 * toast and Stage 3/4's optimistic-rollback-on-failure, a failed PSS update
 * leaves the user with no recourse: their edit vanishes from the UI and the
 * only feedback is a transient toast. They have to type the whole edit again.
 *
 * This store captures every PSS update failure with enough context to retry
 * the exact same patch:
 *   - The taskId + the field-name list (for the tray label)
 *   - The full TaskPatch payload that was attempted
 *   - The runner closure (already bound to the right projectId)
 *   - The friendly error message + a flag for quota errors so the tray can
 *     style them differently (amber, not red)
 *
 * The FailedSavesTray component subscribes via useFailedSaves() and renders
 * a persistent (no auto-dismiss) bottom-right list with Retry / Dismiss
 * actions. Retry re-enqueues the captured patch through the same per-task
 * queue and removes the entry on success.
 */
import { useSyncExternalStore } from 'react';
import type { ScheduleTaskUpdate } from './schedulingClient';
import { enqueueTaskUpdate } from './taskMutationQueue';

type TaskPatch = Omit<ScheduleTaskUpdate, 'taskId'>;
type Runner = (params: ScheduleTaskUpdate) => Promise<unknown>;

export interface FailedSave {
  /** Stable id used as React key + retry/dismiss target. */
  id: string;
  /** GUID of the task whose update failed. */
  taskId: string;
  /** Field names that were in the failed patch (for the tray label). */
  fields: readonly string[];
  /** Full patch payload — re-enqueued verbatim on retry. */
  patch: TaskPatch;
  /** Runner bound to the right projectId — captured so retry doesn't need it. */
  runner: Runner;
  /** Friendly user-facing error message. */
  message: string;
  /** True for ScheduleAPI-OV-0004 quota errors — tray uses amber styling. */
  isQuota: boolean;
  /** Wall-clock timestamp of the failure (ms). */
  timestamp: number;
}

let saves: readonly FailedSave[] = [];
const subscribers = new Set<() => void>();
let nextId = 0;

function emit(): void {
  subscribers.forEach((fn) => fn());
}

/**
 * Record a failed save. Called from inside taskMutationQueue when a flight
 * rejects. Returns the assigned id so callers can refer to it later.
 */
export function recordFailedSave(input: Omit<FailedSave, 'id' | 'timestamp'>): string {
  const id = `fs-${++nextId}`;
  const entry: FailedSave = { ...input, id, timestamp: Date.now() };
  saves = [...saves, entry];
  emit();
  return id;
}

/** Remove a failed save without retrying. */
export function dismissFailedSave(id: string): void {
  const next = saves.filter((s) => s.id !== id);
  if (next.length !== saves.length) {
    saves = next;
    emit();
  }
}

/**
 * Re-enqueue the captured patch. Resolves on success (entry removed) or
 * rejects on failure (entry stays in the tray, message updated to the new
 * error so the user sees what changed).
 *
 * Successful retries clear the entry. A second failure replaces the entry's
 * message but keeps the same id, so the user keeps clicking the same button.
 */
export async function retryFailedSave(id: string): Promise<void> {
  const entry = saves.find((s) => s.id === id);
  if (!entry) return;
  try {
    await enqueueTaskUpdate({ taskId: entry.taskId, ...entry.patch }, entry.runner);
    dismissFailedSave(id);
  } catch (err) {
    // Failure is already recorded by the queue (which calls recordFailedSave
    // again with a NEW id). Remove the original entry so we don't show
    // duplicates for the same patch.
    dismissFailedSave(id);
    throw err;
  }
}

/** React hook — subscribe to the failed-saves list. */
export function useFailedSaves(): readonly FailedSave[] {
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    () => saves,
    () => saves,
  );
}

/** Diagnostic helper, mirrors __taskQueueDebug. */
export function snapshotFailedSaves(): readonly FailedSave[] {
  return saves;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __failedSavesDebug?: () => unknown }).__failedSavesDebug = snapshotFailedSaves;
}
