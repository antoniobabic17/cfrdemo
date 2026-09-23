import { useMutation, useQuery } from '@tanstack/react-query';
import { createTelemetryEvent, listAppErrorEvents } from '../api/telemetryEvents.api';
import type { TelemetryEventCreate, TelemetryEvent } from '../models/telemetryEvent.model';

/** Hook for the Error Log page — reads AppError rows, newest first. */
export function useAppErrorLog() {
  return useQuery({
    queryKey: ['appErrorLog'] as const,
    queryFn: listAppErrorEvents,
    staleTime: 30 * 1000, // refresh every 30s when active
  });
}

/**
 * Fire-and-forget telemetry writer.
 *
 * Every user action worth logging (audit-history rows, admin actions, intake
 * events, etc.) is captured by writing a pmo_telemetryevent row. These writes
 * are STRICTLY best-effort — they must NEVER surface as a user-facing error,
 * because:
 *
 *   1. The primary mutation (project update, PM reassignment, task create)
 *      has already succeeded by the time the audit fires. Telling the user
 *      "you don't have permission" after a successful save is a lie.
 *   2. Not every user role has Create privilege on pmo_telemetryevent
 *      (Team members may not; only admins are guaranteed to). If the audit
 *      throws, the global MutationCache toast in App.tsx would show a spurious
 *      "you don't have permission" toast even though the real operation worked.
 *
 * The fix: swallow the error inside mutationFn so React Query treats it as a
 * successful mutation (that happens to have returned null). The MutationCache
 * error handler never fires. Callers receive `null` on failure and can decide
 * whether to skip their `.onSuccess` follow-up.
 *
 * Caveat: this means audit rows silently fail to write for users without the
 * privilege. That is a Dataverse role gap (grant Create on pmo_telemetryevent
 * to CFR PMO Team + CFR PMO Team Lead), not something the app can fix — but
 * it's a much better failure mode than falsely accusing the user of a
 * permission failure on their actual save.
 */
export function useCreateTelemetryEvent() {
  return useMutation<TelemetryEvent | null, Error, TelemetryEventCreate>({
    mutationFn: async (payload) => {
      try {
        return await createTelemetryEvent(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[telemetry] write failed (best-effort; audit history may be incomplete)', err);
        return null;
      }
    },
  });
}
