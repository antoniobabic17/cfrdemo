/**
 * Client-side timeout wrapper for any Promise.
 *
 * Rejects with a friendly, actionable error if the wrapped promise
 * hasn't settled after `timeoutMs`. Used everywhere we call a remote
 * service (Dataverse Web API, PSS scheduling actions, staging plugin
 * drains) so a hung server response can't spin the caller forever.
 *
 * Originally lived inside schedulingClient.ts (PSS-specific). Extracted
 * here 2026-07-17 so useAppMutation + dataverseClient CRUD ops can
 * share the same guard.
 */

/** Default budget for any single remote round-trip. Long enough to
 *  swallow a slow-but-alive response, tight enough that a truly stuck
 *  request rejects before the user gives up on their own. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `Timeout after ${Math.round(timeoutMs / 1000)}s: ${label}. ` +
        `The service did not respond. Retry, or check Admin > Error Log ` +
        `for related activity. If the problem persists, other users may ` +
        `be hitting the same slowdown.`,
      ));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
