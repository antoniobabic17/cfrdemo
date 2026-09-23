/**
 * Session-scoped snapshot store for the "checkbox complete/reopen"
 * flow on task tiles.
 *
 * When the user clicks the empty circle on a tile to mark it Done,
 * `TaskCompletionCheckbox` calls `captureCompletionSnapshot` to freeze
 * the current effort / hoursdone / progress tuple. When they later
 * click the X to reopen the task, the checkbox calls
 * `popCompletionSnapshot` and re-applies those exact values -- so a
 * task that was 42% / 4h done before completion goes back to 42% / 4h
 * done after reopen (NOT a hardcoded 50%). If it was 0% / 0h before,
 * it goes back to 0% / 0h.
 *
 * Session-scoped intentionally. A page refresh drops the map. If the
 * user then clicks X on a task they completed in a prior session, the
 * reopen falls back to Not Started (0h effort, 0 progress) because
 * that's the safest default when we have no history -- operator
 * explicitly accepted that trade-off.
 *
 * Follows the same in-memory + subscribe/notify shape as
 * `taskDateOverrides.ts`; reads via `useSyncExternalStore` in the
 * checkbox component so React re-renders when the map mutates.
 */
import type { ProjectTask } from '../models/projectTask.model';
import { getTaskEffort, getTaskHoursDone } from '../models/projectTask.model';

export interface CompletionSnapshot {
  /** pmo_taskeffort at moment of complete (preferred), else msdyn_effort. */
  effort?: number;
  /** pmo_taskhoursdone at moment of complete (preferred), else msdyn_effortcompleted. */
  effortCompleted?: number;
  /** msdyn_progress at moment of complete (0-100). Included for
   *  completeness; the reopen path only strictly needs effort +
   *  effortCompleted because PSS re-derives progress from those. */
  progress?: number;
  /** ISO timestamp for debugging / future TTL if we ever want it. */
  capturedAt: string;
}

const snapshots = new Map<string, CompletionSnapshot>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

/**
 * Freeze the current effort/hoursdone/progress for a task just before
 * we mutate it to 100%. Called from `TaskCompletionCheckbox` in the
 * mark-complete flow BEFORE the mutations fire so the values captured
 * are the pre-completion server state.
 */
export function captureCompletionSnapshot(taskId: string, task: ProjectTask): void {
  snapshots.set(taskId, {
    effort: getTaskEffort(task),
    effortCompleted: getTaskHoursDone(task),
    progress: task.msdyn_progress,
    capturedAt: new Date().toISOString(),
  });
  notify();
}

/**
 * Retrieve and REMOVE the snapshot for a task. Called from the reopen
 * flow -- one-shot consumption so a second reopen click can't
 * accidentally restore stale values from a completion that already
 * cycled. Returns undefined if no snapshot exists (e.g. refresh dropped
 * it), in which case the caller falls back to Not Started defaults.
 */
export function popCompletionSnapshot(taskId: string): CompletionSnapshot | undefined {
  const snap = snapshots.get(taskId);
  if (snap === undefined) return undefined;
  snapshots.delete(taskId);
  notify();
  return snap;
}

/**
 * Non-destructive check. Used by the checkbox to decide whether the
 * icon should show its X hover state (Done + we can reopen with
 * fidelity) vs. just the plain checkmark (Done, no snapshot -- reopen
 * will fall back to Not Started).
 */
export function hasSnapshot(taskId: string): boolean {
  return snapshots.has(taskId);
}

export function subscribeSnapshots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshotVersion(): number {
  return version;
}

/** Test-only: wipe everything. Not exported from index; call via
 *  named import from tests. */
export function _resetSnapshotStore(): void {
  snapshots.clear();
  version = 0;
  listeners.forEach((l) => l());
}
