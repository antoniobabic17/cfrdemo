/**
 * Client-side "task X is still applying create-time extras" store.
 *
 * When a user creates a task with dates / priority / assignee, the staging
 * drain commits the base task (making it visible in the OData query and
 * clearing the overlay row), but the follow-up mutations for extras
 * (assignee always; dates + priority when staging is disabled) fire AFTER
 * the create resolves. Without this store, the card looks "done" as soon
 * as the create commits -- the spinner disappears before the follow-ups
 * even start. The operator needs the spinner to persist for the whole
 * lifecycle: create + every extras attempt.
 *
 * The store also carries an OPTIONAL optimistic patch so the card can
 * display the user's picked dates / priority WHILE those extras are still
 * being pushed. If an extra ultimately fails, its optimistic value is
 * cleared (via markExtrasDone) and the card snaps back to whatever the
 * server has (PSS default = start+1 for dates when none supplied).
 *
 * Contract:
 *   markPendingExtras(taskId, patch?)  — call BEFORE firing any create-time
 *                                        extras. Optional patch carries the
 *                                        user-picked values for optimistic
 *                                        display.
 *   markExtrasDone(taskId)             — call in a finally after ALL extras
 *                                        have resolved (success OR fail).
 *                                        Removes the task from the pending
 *                                        set AND clears its optimistic patch.
 *   useIsPendingExtras(taskId)         — React hook. Returns true when the
 *                                        task is still in the pending set.
 *   useOptimisticExtras(taskId)        — React hook. Returns the optimistic
 *                                        patch (or undefined) so TaskRow
 *                                        can layer it onto the displayed
 *                                        task.
 *
 * Store lives only in memory. Cleared on page navigation. If a mutation
 * hook is orphaned (component unmount mid-flight) the entry sticks until
 * next reload -- acceptable because the tab is already gone.
 */
import { useSyncExternalStore } from 'react';

export interface OptimisticExtras {
  scheduledStart?: string; // ISO date string
  scheduledEnd?: string;   // ISO date string
  priority?: number;
}

const pending = new Map<string, OptimisticExtras>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function markPendingExtras(taskId: string, patch: OptimisticExtras = {}): void {
  if (!taskId) return;
  pending.set(taskId, patch);
  emit();
}

export function markExtrasDone(taskId: string): void {
  if (!taskId) return;
  if (pending.delete(taskId)) emit();
}

/** Hook: subscribe to this task's pending-extras flag. */
export function useIsPendingExtras(taskId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (taskId ? pending.has(taskId) : false),
    () => false,
  );
}

const EMPTY: OptimisticExtras = Object.freeze({});

/** Hook: subscribe to this task's optimistic-extras patch. */
export function useOptimisticExtras(taskId: string | undefined): OptimisticExtras {
  return useSyncExternalStore(
    subscribe,
    () => (taskId ? pending.get(taskId) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
}
