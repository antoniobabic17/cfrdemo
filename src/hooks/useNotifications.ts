import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listNotifications, listAllNotifications, createNotification, markAsRead, dismissNotification } from '../api/notifications.api';
import type { NotificationCreate } from '../models/notification.model';
import { useConfig, useEffectiveAdminRole } from '../providers/ConfigurationProvider';
import { useCurrentUserId } from './useCurrentUserId';
import { useSyncExternalStore } from 'react';
import { isSeeAllNotifications, subscribeToSeeAllNotifications } from '../lib/adminAllNotifications';

const QK = ['notifications'] as const;

export function useNotifications() {
  // MUST use the async-resolved id. The synchronous getCurrentUserId()
  // returns the literal 'anonymous' in Power Apps Code Apps (no window.Xrm),
  // which produced a filter `_pmo_targetuser_value eq anonymous` — Dataverse
  // parses the bareword as a property name and 400s ("no property named
  // 'anonymous'"). useCurrentUserId resolves the real systemuserid via the
  // Power Apps SDK context.
  const userId = useCurrentUserId();
  const { config: { notificationDisplay } } = useConfig();
  const pollMs = notificationDisplay.pollIntervalMs;
  // Admin "see all" mode: session-only flag (default off), gated to admins. When
  // on, read EVERY notification regardless of target user/category.
  const isAdmin = useEffectiveAdminRole() !== 'none';
  const seeAll = useSyncExternalStore(subscribeToSeeAllNotifications, isSeeAllNotifications);
  const allMode = isAdmin && seeAll;
  return useQuery({
    // Key includes the mode so toggling flips the cache cleanly.
    queryKey: [...QK, allMode ? 'ALL' : (userId ?? null)],
    enabled: allMode || !!userId,
    queryFn: () => (allMode ? listAllNotifications() : listNotifications(userId as string)),
    staleTime: pollMs,
    refetchInterval: pollMs,
  });
}

export function useUnreadCount() {
  const { data = [] } = useNotifications();
  return data.filter((n) => !n.pmo_isread).length;
}

export function useCreateNotification() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create notification',
    mutationFn: (payload: NotificationCreate) => createNotification(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'mark as read',
    mutationFn: (id: string) => markAsRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}

export function useDismissNotification() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'dismiss notification',
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });
}
