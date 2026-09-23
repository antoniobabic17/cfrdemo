/**
 * pmo_taskstaging OData wrappers.
 *
 * Writes are shaped in `lib/stagingClient.ts` (this module just exposes the
 * plain create/read/update). The plugin owns the transitions Pending →
 * InFlight → Synced/Failed; the app only ever writes Pending rows and, in the
 * admin System Jobs surface, flips Failed back to Pending via the Custom API.
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, STAGING_SYNC_STATUS } from '../lib/constants';
import type { TaskStagingRow } from '../models/taskStaging.model';

const SET = ENTITY_SETS.taskStaging;

const BASE_SELECT = [
  'pmo_taskstagingid',
  'pmo_operation',
  'pmo_entitytype',
  'pmo_targetid',
  '_pmo_project_value',
  'pmo_payload',
  'pmo_syncstatus',
  'pmo_syncerror',
  'pmo_scheduleapicode',
  'pmo_opsetid',
  'pmo_attempts',
  'pmo_sequence',
  '_pmo_dependsonstagingid_value',
  'ownerid',
  'createdon',
  'modifiedon',
  'statecode',
] as const;

export async function createStagingRow(payload: Record<string, unknown>): Promise<TaskStagingRow> {
  return dv.create<TaskStagingRow>(SET, payload);
}

export async function getStagingRow(id: string): Promise<TaskStagingRow> {
  return dv.get<TaskStagingRow>(SET, id, BASE_SELECT as unknown as string[]);
}

/** Return the highest `pmo_sequence` value present for a project so the app
 *  can assign the next monotonic sequence number. Falls back to 0. */
export async function maxSequenceForProject(projectId: string): Promise<number> {
  const rows = await dv.list<{ pmo_sequence?: number }>(SET, {
    $select: ['pmo_sequence'],
    $filter: `_pmo_project_value eq ${projectId}`,
    $orderby: 'pmo_sequence desc',
    $top: 1,
  });
  return rows[0]?.pmo_sequence ?? 0;
}

/** Rows relevant for the read overlay: Pending / InFlight / Failed, plus
 *  Synced rows modified within the last 60s -- the grace window lets the
 *  OData refetch catch up so the overlay-create card doesnt visibly
 *  disappear during the ~1s window between "plugin flips Synced" and
 *  "listProjectTasks refetch returns the real row". applyTaskStagingOverlay
 *  is responsible for filtering Synced rows out of the merged output once
 *  the real upstream row has arrived (see stillOverlaid). */
export async function listActiveStagingRowsForProject(projectId: string): Promise<TaskStagingRow[]> {
  const graceCutoff = new Date(Date.now() - 60_000).toISOString();
  return dv.list<TaskStagingRow>(SET, {
    $select: BASE_SELECT as unknown as string[],
    $filter:
      `_pmo_project_value eq ${projectId} and ` +
      `(pmo_syncstatus eq ${STAGING_SYNC_STATUS.Pending} or ` +
      `pmo_syncstatus eq ${STAGING_SYNC_STATUS.InFlight} or ` +
      `pmo_syncstatus eq ${STAGING_SYNC_STATUS.Failed} or ` +
      `(pmo_syncstatus eq ${STAGING_SYNC_STATUS.Synced} and modifiedon ge ${graceCutoff}))`,
    $orderby: 'pmo_sequence asc',
    $top: 500,
  });
}

/** Recent flush activity for the admin System Jobs Panel A. */
export async function listStuckStagingRows(): Promise<TaskStagingRow[]> {
  return dv.list<TaskStagingRow>(SET, {
    $select: BASE_SELECT as unknown as string[],
    $filter:
      `(pmo_syncstatus eq ${STAGING_SYNC_STATUS.Failed} or ` +
      `pmo_syncstatus eq ${STAGING_SYNC_STATUS.InFlight}) and statecode eq 0`,
    $orderby: 'createdon desc',
    $top: 200,
  });
}

/** Flip a row's sync_status. Used by admin actions:
 *  - Retry: Failed → Pending (also fires the plugin, which triggers a drain)
 *  - Abandon: Failed → Abandoned (row disappears from overlays + stuck list) */
export async function updateStagingRow(id: string, patch: Partial<TaskStagingRow>): Promise<void> {
  return dv.update(SET, id, patch);
}

/** Invoke pmo_FlushTaskStaging Custom API. Wraps the same drain the plugin
 *  runs, so admin Force-flush and per-row Retry share code with the write path. */
export async function invokeFlushTaskStaging(params: {
  projectId: string;
  stagingIds?: string[];
  forceRetry?: boolean;
}): Promise<void> {
  await dv.executeAction<
    { ProjectId: string; StagingIds?: string; ForceRetry?: boolean },
    unknown
  >(ENTITY_SETS.project, 'pmo_FlushTaskStaging', {
    ProjectId: params.projectId,
    ...(params.stagingIds && params.stagingIds.length > 0
      ? { StagingIds: params.stagingIds.join(',') }
      : {}),
    ...(params.forceRetry ? { ForceRetry: true } : {}),
  });
}
