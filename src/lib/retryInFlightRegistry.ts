/**
 * In-memory registry of tasks whose staging mutation is currently in an
 * auto-retry loop.
 *
 * While a task id is marked in-flight, StagingFailureWatcher suppresses its
 * per-attempt friendly toast + auto-log for that target -- the retry loop
 * owns all logging and will emit either a terminal `succeeded` outcome or a
 * single `gave-up-auto-retry` toast at the end. Without this suppression the
 * user would see one red toast per attempt (up to 5).
 *
 * Not persisted -- retry loops are always in-process. If the tab reloads
 * mid-retry the loop is gone anyway; the underlying pmo_taskstaging row will
 * still be Failed and can be retried from Admin > Error Log > System Jobs.
 */

/** Metadata associated with an in-flight retry so a page unload can flush
 *  a terminal `abandoned` outcome to the error log. */
export interface RetryContext {
  action: string;
  entityType?: string;
  entityId?: string;
  parentProjectId?: string;
  firstStagingId?: string;
  attemptSoFar?: number;
}

const inFlight: Map<string, RetryContext> = new Map();

/** Mark this task as mid-retry so the failure watcher skips its per-attempt toast. */
export function markRetryInFlight(taskId: string, ctx: RetryContext = { action: 'unknown retry' }): void {
  if (!taskId) return;
  inFlight.set(taskId, ctx);
}

/** Update the recorded context for an in-flight retry (attempt bump etc). */
export function updateRetryInFlight(taskId: string, patch: Partial<RetryContext>): void {
  if (!taskId) return;
  const prev = inFlight.get(taskId);
  if (!prev) return;
  inFlight.set(taskId, { ...prev, ...patch });
}

/** Clear the in-flight mark. Callers MUST invoke this in a finally block. */
export function clearRetryInFlight(taskId: string): void {
  if (!taskId) return;
  inFlight.delete(taskId);
}

/** True iff a mutation retry loop is currently owning failure logging for this task. */
export function isRetryInFlight(taskId: string): boolean {
  if (!taskId) return false;
  return inFlight.has(taskId);
}

/** Snapshot of everything in-flight for the beforeunload flush handler. */
export function snapshotRetryInFlight(): Array<{ taskId: string } & RetryContext> {
  return [...inFlight.entries()].map(([taskId, ctx]) => ({ taskId, ...ctx }));
}

/** Test helper — clears the whole registry. Not used in production code. */
export function _resetRetryInFlight_forTests(): void {
  inFlight.clear();
}
