/**
 * Tracking Labels hooks — thin React Query wrappers over trackingLabels.api.ts.
 *
 * These hooks are deliberately NOT gated by useCanEditProject. pmo_tracking has
 * Global CRUD for all CFR PMO roles, meaning any authenticated user can read and
 * write these rows regardless of team membership — that is the whole point of the
 * feature (cross-team users need to be able to tag projects they observe, not just
 * projects they belong to).
 *
 * The only guard is a `!!recordId` enabled check so we don't fire queries before
 * the parent record id is resolved.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listTrackingLabels,
  listAllTrackingLabelsForType,
  groupByRecord,
  addTrackingLabel,
  removeTrackingLabel,
} from '../api/trackingLabels.api';
import type { TrackingLabel } from '../api/trackingLabels.api';

export type { TrackingLabel };

// ── Per-record list ───────────────────────────────────────────────────────────

/** List tracking labels for a single record. */
export function useTrackingLabels(recordType: string, recordId: string | undefined) {
  return useQuery({
    queryKey: ['trackingLabels', recordType, recordId] as const,
    queryFn: () => listTrackingLabels(recordType, recordId!),
    enabled: !!recordId,
    staleTime: 30_000,
    retry: false,
  });
}

// ── Bulk list for gallery filter ──────────────────────────────────────────────

/**
 * Load ALL tracking rows for a record type (e.g. 'Project') and group them by
 * record id. Used by the Projects gallery filter so one query covers the whole list.
 * Returns an empty Map until data loads.
 */
export function useAllTrackingLabelsForType(recordType: string) {
  return useQuery({
    queryKey: ['trackingLabels', 'all', recordType] as const,
    queryFn: async () => {
      const rows = await listAllTrackingLabelsForType(recordType);
      return groupByRecord(rows);
    },
    staleTime: 30_000,
    retry: false,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Add a tracking label to a record. Invalidates both the per-record list and the
 *  bulk gallery query so the gallery filter stays in sync immediately. */
export function useAddTrackingLabel(recordType: string, recordId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'addTrackingLabel',
    mutationFn: (label: string) => addTrackingLabel(recordType, recordId, label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trackingLabels', recordType, recordId] });
      qc.invalidateQueries({ queryKey: ['trackingLabels', 'all', recordType] });
    },
  });
}

/** Remove a tracking label by its row id. Same dual invalidation as add. */
export function useRemoveTrackingLabel(recordType: string, recordId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'removeTrackingLabel',
    mutationFn: (trackingId: string) => removeTrackingLabel(trackingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trackingLabels', recordType, recordId] });
      qc.invalidateQueries({ queryKey: ['trackingLabels', 'all', recordType] });
    },
  });
}
