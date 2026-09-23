import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listSettings, upsertSetting, deleteSetting, type AppSetting } from '../api/appSettings.api';
import { useWriteGuard, WriteForbiddenError } from './useWriteGuard';
import { resolveRequiredRole } from '../lib/settingKeyRoles';
import { SETTING_STANDARD_CAPACITY_HOURS } from '../lib/constants';

const QK = ['appSettings'] as const;

export function useAppSettings() {
  return useQuery({
    queryKey: QK,
    queryFn: listSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
    // See the matching options on ConfigurationProvider's own ['appSettings']
    // observer: that query gates its provider's top-level render, so a NEW
    // observer subscribing here (e.g. Sidebar mounting) re-triggers a fetch
    // of this same errored, never-succeeded query (TanStack Query retries
    // on every new subscriber unless retryOnMount is false too) -- a
    // self-sustaining mount/refetch/unmount loop. Explicit invalidateQueries
    // (useUpsertSetting below, AdminSettingsPage.tsx) already covers every
    // real refresh path.
    refetchOnMount: false,
    retryOnMount: false,
  });
}

export function useAppSetting(key: string): string | undefined {
  const { data } = useAppSettings();
  return data?.find((s) => s.pmo_key === key)?.pmo_value ?? undefined;
}

/** Returns the configured standard monthly capacity hours
 *  (pmo.standard_capacity_hours), falling back to 160 when unset or invalid.
 *  Used by the New Resource Model capacity views on both the project Resources
 *  sub-tab and the portfolio Capacity page. */
export function useStandardCapacityHours(): number {
  const raw = useAppSetting(SETTING_STANDARD_CAPACITY_HOURS);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 160;
}

export function useUpsertSetting() {
  const qc = useQueryClient();
  const guard = useWriteGuard();

  return useAppMutation({
    action: 'upsert setting',
    mutationFn: ({ key, value }: { key: string; value: string }) => {
      // Client-side write authorization -- see hooks/useWriteGuard.ts.
      // Fails fast BEFORE the Dataverse round-trip so non-admins get a
      // clean 403-in-UI (WriteForbiddenError -> toast) instead of a raw
      // Dataverse permission error, and no noisy telemetry row lands.
      // Dataverse row-level security remains the authoritative gate.
      const { role, teamId } = resolveRequiredRole(key);
      const verdict = guard(role, { teamId });
      if (!verdict.allow) {
        throw new WriteForbiddenError(
          verdict.reason ?? 'Write denied by client-side guard.',
          verdict.requiredRole,
          { settingKey: key, teamId },
        );
      }
      // Read the live cache at call time (not a stale closure) so that rows
      // written by earlier mutations in the same async loop are visible. This
      // prevents the chunked catalog writer from creating duplicate rows when
      // the first chunk is new and subsequent chunks are also new in the same
      // re-pull run.
      const settings = qc.getQueryData<AppSetting[]>(QK);
      const kl = key.toLowerCase();
      const existing = settings?.find((s) => (s.pmo_key ?? '').toLowerCase() === kl);
      return upsertSetting(key, value, existing);
    },
    onSuccess: async (_data, { key, value }) => {
      // Two-step cache refresh so consumers see the new value immediately.
      //   (a) Optimistically patch the current cache with the new row so
      //       Sidebar / TeamsPage / TeamDetail re-render RIGHT NOW without
      //       waiting for the server round-trip. Empty value deletes the
      //       entry (matches resolveSidebarTeamName's "fall back to raw
      //       name" semantics).
      //   (b) Kick off a background refetch so any drift between our
      //       optimistic patch and the server truth reconciles on the next
      //       tick.
      qc.setQueryData<AppSetting[] | undefined>(QK, (old) => {
        if (!old) return old;
        const kl = key.toLowerCase();
        const idx = old.findIndex((s) => (s.pmo_key ?? '').toLowerCase() === kl);
        if (idx >= 0) {
          const next = old.slice();
          next[idx] = { ...next[idx], pmo_value: value };
          return next;
        }
        // New row -- no id yet from the server, but the sidebar only reads
        // pmo_key + pmo_value so a synthetic id is safe.
        return [...old, {
          pmo_appsettingid: `optimistic-${Date.now()}`,
          pmo_key: key,
          pmo_value: value,
          pmo_description: null,
        }];
      });
      await qc.invalidateQueries({ queryKey: QK });
    },
  });
}

/**
 * Delete a settings row by key. Used by the column-catalog writer to prune
 * stale overflow chunks after a re-pull that produced fewer chunks than the
 * previous one.
 */
export function useDeleteSetting() {
  const qc = useQueryClient();
  const guard = useWriteGuard();

  return useAppMutation({
    action: 'delete setting',
    mutationFn: ({ key }: { key: string }) => {
      const { role, teamId } = resolveRequiredRole(key);
      const verdict = guard(role, { teamId });
      if (!verdict.allow) {
        throw new WriteForbiddenError(
          verdict.reason ?? 'Write denied by client-side guard.',
          verdict.requiredRole,
          { settingKey: key, teamId },
        );
      }
      // Read live cache at call time — same reasoning as useUpsertSetting.
      const settings = qc.getQueryData<AppSetting[]>(QK);
      const kl = key.toLowerCase();
      const existing = settings?.find((s) => (s.pmo_key ?? '').toLowerCase() === kl);
      if (!existing) return Promise.resolve(); // already gone — no-op
      return deleteSetting(existing);
    },
    onSuccess: async (_data, { key }) => {
      qc.setQueryData<AppSetting[] | undefined>(QK, (old) => {
        if (!old) return old;
        const kl = key.toLowerCase();
        return old.filter((s) => (s.pmo_key ?? '').toLowerCase() !== kl);
      });
      await qc.invalidateQueries({ queryKey: QK });
    },
  });
}

export type { AppSetting };
