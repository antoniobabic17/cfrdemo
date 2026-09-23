/**
 * Persistent per-user announcement acks (Single-Time Ack mode).
 *
 * Loads the current user's acked `${scope}:${version}` keys from Dataverse once
 * and caches them. The recordAck mutation writes a new ack row and optimistically
 * adds the key so the popup closes immediately without a refetch race.
 *
 * Every-Load Ack mode does NOT use this — it relies on the in-memory session
 * ack stores (globalAnnouncementAcks / teamAnnouncementAcks).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUserId } from './useCurrentUserId';
import { isDemoModeActive } from '../lib/demoMode';
import {
  listMyAnnouncementAcks,
  createAnnouncementAck,
  ackScope,
  type AnnouncementScope,
} from '../api/announcementAcks.api';

const QK = (userId: string) => ['announcementAcks', userId] as const;

/**
 * The current user's persisted acks as a Set of `${scope}:${version}` keys.
 * Returns an empty set while loading / in demo mode so callers never block the
 * popup on a pending fetch (Every-Load mode is unaffected either way).
 */
export function useMyAnnouncementAcks(): Set<string> | undefined {
  const userId = useCurrentUserId();
  const { data, isPending } = useQuery({
    queryKey: userId ? QK(userId) : ['announcementAcks', 'pending'],
    enabled: !!userId && !isDemoModeActive(),
    staleTime: 5 * 60 * 1000,
    queryFn: () => listMyAnnouncementAcks(userId!),
  });
  // Return undefined while the query is loading so callers can distinguish
  // "user HAS no acks" (empty Set) from "acks not yet fetched" (undefined).
  // This prevents the announcement popup from flashing briefly on load before
  // the ack query confirms the user already acknowledged the announcement.
  if (isPending && !isDemoModeActive() && !!userId) return undefined;
  return data ?? new Set<string>();
}

/** Record a persistent ack for the current user, then update the cache. */
export function useRecordAnnouncementAck() {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, version }: { scope: AnnouncementScope; version: number }) => {
      if (isDemoModeActive()) return;
      await createAnnouncementAck(scope, version);
    },
    onSuccess: (_data, { scope, version }) => {
      if (!userId) return;
      const key = `${scope}:${version}`;
      qc.setQueryData<Set<string>>(QK(userId), (prev) => {
        const next = new Set(prev ?? []);
        next.add(key);
        return next;
      });
    },
  });
}

export { ackScope };
