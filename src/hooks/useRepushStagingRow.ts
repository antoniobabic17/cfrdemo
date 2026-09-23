/**
 * Shared "repush a staging row" hook.
 *
 * Used by:
 *   - Admin > Error Log > System Jobs > Currently stuck rows (Retry column)
 *   - Admin > Error Log > Errors (Repush button in the details modal for
 *     any row whose payload.stagingRowId points at a non-terminal row)
 *
 * Extracted from the inlined retryMut in StagingSystemJobsPanel so both
 * call sites share one implementation. Defense-in-depth: this hook
 * re-reads the target row's current pmo_syncstatus before flipping,
 * because a Confirm modal can sit open while the plugin drains the row
 * independently.
 */
import { useAppMutation } from './useAppMutation';
import { useWriteGuard, WriteForbiddenError } from './useWriteGuard';
import { STAGING_SYNC_STATUS } from '../lib/constants';
import {
  getStagingRow,
  invokeFlushTaskStaging,
  updateStagingRow,
} from '../api/taskStaging.api';
import type { TaskStagingRow } from '../models/taskStaging.model';

export interface RepushOutcome {
  row: TaskStagingRow;
  skipped?: 'terminal' | 'in-flight';
}

/**
 * Returns a React Query mutation that, given a TaskStagingRow, re-drains it.
 * Semantics:
 *   - If the row is Synced or Abandoned  -> throws "Cannot repush a
 *     Synced/Abandoned row."
 *   - If the row is InFlight             -> returns { skipped: 'in-flight' }
 *     (no-op; caller should show info toast)
 *   - Failed / Pending                   -> calls pmo_FlushTaskStaging with
 *     ForceRetry=true; on any custom-API error falls back to a direct PATCH
 *     that flips syncstatus back to Pending (the Update step will fire
 *     and drain it).
 *
 * Non-admins are blocked by useWriteGuard('pmo_admin') -> WriteForbiddenError.
 */
export function useRepushStagingRow() {
  const guard = useWriteGuard();

  return useAppMutation({
    action: 'staging repush',
    entityType: 'taskStaging',
    entityId: (row: TaskStagingRow) => row.pmo_taskstagingid,
    parentProjectId: (row: TaskStagingRow) => row['_pmo_project_value'],
    errorMessage: (_row, err) => `Repush failed: ${(err as Error).message}`,
    mutationFn: async (row: TaskStagingRow): Promise<RepushOutcome> => {
      // 1. Client-side admin gate (Dataverse remains authoritative).
      const v = guard('pmo_admin');
      if (!v.allow) throw new WriteForbiddenError(v.reason ?? 'Not allowed.', v.requiredRole);

      // 2. Re-read the current status. The passed-in row may be stale
      //    (Confirm modal opened seconds ago; plugin has since drained it).
      let latest: TaskStagingRow;
      try {
        latest = await getStagingRow(row.pmo_taskstagingid);
      } catch {
        // 404 -- retention job cleaned it up. Treat as already-Synced.
        throw new Error('Cannot repush — the row is no longer available (already processed or retention-deleted).');
      }

      if (latest.pmo_syncstatus === STAGING_SYNC_STATUS.Synced ||
          latest.pmo_syncstatus === STAGING_SYNC_STATUS.Abandoned) {
        throw new Error('Cannot repush a Synced/Abandoned row.');
      }
      if (latest.pmo_syncstatus === STAGING_SYNC_STATUS.InFlight) {
        return { row: latest, skipped: 'in-flight' };
      }

      // 3. Preferred path: sync CustomAPI with ForceRetry=true. Works even
      //    when the async trigger is stuck (which is exactly the scenario
      //    that fills the Error Log in the first place).
      const projectId = latest['_pmo_project_value'];
      if (!projectId) throw new Error('No project reference on staging row.');

      try {
        await invokeFlushTaskStaging({
          projectId,
          stagingIds: [latest.pmo_taskstagingid],
          forceRetry: true,
        });
      } catch (customApiErr) {
        // Fallback: direct PATCH to flip Failed -> Pending. If the async
        // trigger is fixed, the plugin's Update step will fire and drain.
        // (Note: this fallback is a no-op if InvocationSource is still
        // misregistered on the step -- but we already patched that.)
        await updateStagingRow(latest.pmo_taskstagingid, {
          pmo_syncstatus: STAGING_SYNC_STATUS.Pending,
        });
        // eslint-disable-next-line no-console
        console.warn('[repushStagingRow] Custom API unavailable, used direct status flip', customApiErr);
      }

      return { row: latest };
    },
  });
}
