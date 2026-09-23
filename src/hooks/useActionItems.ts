/**
 * useActionItems — the single hook behind the Intake Queue and every
 * "requires action" count in the app.
 *
 * It fetches the three underlying sources (project/program requests, user
 * feedback, and per-user notifications), then runs them through the pure
 * `selectActionItems` selector with the current user's identity, team
 * membership, and admin status.
 *
 * Every consumer (Intake gallery, sidebar `/intake` badge, the list's
 * "Requires action" pill) reads `actionableCount` from HERE, so the numbers
 * can never drift apart again — that drift was the recurring mismatch bug.
 */
import { useMemo } from 'react';
import { useProjectRequests } from './useProjectRequests';
import { useUserFeedback } from './useUserFeedback';
import { useNotifications } from './useNotifications';
import { useCurrentUserId } from './useCurrentUserId';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { useEffectiveAdminRole } from '../providers/ConfigurationProvider';
import { selectActionItems, type ActionItemSelection } from '../lib/actionItems';

export interface UseActionItemsResult extends ActionItemSelection {
  isLoading: boolean;
  error: Error | null;
}

export function useActionItems(): UseActionItemsResult {
  const { data: requests = [], isLoading: reqLoading, error: reqError } = useProjectRequests();
  const { data: feedback = [], isLoading: fbLoading, error: fbError } = useUserFeedback();
  const { data: notifications = [], isLoading: nLoading, error: nError } = useNotifications();

  const userId = useCurrentUserId();
  const teams = useCurrentUserTeams();
  const adminRole = useEffectiveAdminRole();
  const isAdmin = adminRole !== 'none';

  const selection = useMemo(
    () => selectActionItems({
      requests,
      feedback,
      notifications,
      userId,
      teamIds: teams,
      isAdmin,
    }),
    [requests, feedback, notifications, userId, teams, isAdmin],
  );

  return {
    ...selection,
    isLoading: reqLoading || fbLoading || nLoading,
    error: (reqError ?? fbError ?? nError) as Error | null,
  };
}

/**
 * Thin count-only wrapper for the sidebar badge — avoids importing the whole
 * selection shape at the call site. Reads the SAME unified count.
 */
export function useActionableCount(): number {
  return useActionItems().actionableCount;
}
