/**
 * Shared retry policy for transient Dataverse / PSS failures.
 *
 * Historically each mutation hook (useProjectTaskMutations,
 * useProjectChecklists) redeclared its own signature list + backoff.
 * Extracted here 2026-07-17 so every mutation retries the same set of
 * transient errors the same way, without drift.
 *
 * Signatures cover:
 *   - `NOTEDITABLE` / `readonly`         PSS post-materialization window
 *   - `CorrelationId` / `Entity Key`     PSS's own error-log alt-key mask
 *   - `E_BATCHFAILED`                    PSS batch failure
 *   - `Timeout after`                    our own withTimeout rejection
 *
 * Backoff is 3s / 6s / 10s (3 retries + initial attempt = 4 total).
 * That's long enough for a PSS materialization window (~5-20s) to
 * elapse but short enough that the user doesn't wait a full minute
 * on a genuinely stuck request.
 */

export const RETRY_TRIGGER_SIGNATURES = [
  'NOTEDITABLE',
  'readonly',
  'CorrelationId',
  'Entity Key',
  'E_BATCHFAILED',
  'Timeout after',
  // 2026-07-22: Tracey's mark-complete + reopen sat Pending, attempts=0 for
  // over an hour on PROD. Root cause was waitForStagingSync() throwing on
  // the initial invokeFlushTaskStaging call (network blip / sandbox
  // timeout), then its fallback getStagingRow read saw Pending, so it
  // returned this exact message and the retry loop treated it as
  // non-retryable and gave up. Adding this signature lets the outer retry
  // loop retry the whole stage-then-flush sequence and unblock the row.
  'Your save could not complete',
  // Same class of failure: flush succeeded but our specific row was pruned
  // by an internal debounce inside the drain. Retry so the next attempt
  // creates a fresh staging row + fires the plugin again.
  'Save completed but this change was not applied',
] as const;

export const RETRY_BACKOFFS_MS = [3_000, 6_000, 10_000] as const;

/** Total attempts = 1 (initial) + backoffs.length (retries). */
export const RETRY_MAX_ATTEMPTS = RETRY_BACKOFFS_MS.length + 1;

/** True iff the given error message signals a transient failure that
 *  is worth retrying. Non-transient errors (permission denied, malformed
 *  payload, missing entity) should surface immediately -- retries just
 *  waste the user's time. */
export function isRetryableError(msg: string | undefined): boolean {
  if (!msg) return false;
  return RETRY_TRIGGER_SIGNATURES.some((sig) => msg.includes(sig));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn`; if it throws a transient error, sleep + retry per the
 * backoff schedule. Throws the last error if all retries fail. If a
 * non-transient error is thrown, gives up immediately.
 *
 * Callers that need per-attempt logging (like the staging path) should
 * NOT use this helper -- they own their own logging loop. This is for
 * simple one-shot retries.
 */
export async function runWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = undefined;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetryableError(msg)) throw err;
      if (attempt < RETRY_MAX_ATTEMPTS) {
        await delay(RETRY_BACKOFFS_MS[attempt - 1]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
