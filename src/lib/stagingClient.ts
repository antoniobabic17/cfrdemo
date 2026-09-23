/**
 * Staging client.
 *
 * The staging table (`pmo_taskstaging`) sits between the app and PSS. Writes go
 * here as plain OData rows — no OperationSet, no per-user quota, no rate limit.
 * A .NET async plugin on Create/Update of `pmo_taskstaging` debounces ~10 s per
 * project, drains all `Pending` rows into ONE OperationSet, and Executes.
 *
 * Every helper below returns:
 *   - the staging row's GUID (so callers can subscribe/wait on it)
 *   - the `pmo_targetid` GUID (client-generated for creates so downstream ops
 *     in the same OperationSet can reference the new row)
 *
 * Feature flag: `SETTING_STAGING_ENABLED` (pmo_appsetting `pmo.staging_enabled`)
 * gates whether the mutation hooks use this module or fall back to
 * schedulingClient.ts direct-PSS writes. The flag is read via
 * `useStagingEnabled()` (see hooks/useStagingEnabled.ts).
 *
 * See docs/staging-architecture.md for the full contract.
 */
import {
  ENTITY_SETS,
  STAGING_OPERATION,
  STAGING_ENTITY_TYPE,
  STAGING_SYNC_STATUS,
  QUERY_STALE_TIME as _unused_QUERY_STALE_TIME,
} from './constants';
import type {
  StagingOperation,
  StagingEntityType,
} from './constants';
import {
  createStagingRow,
  getStagingRow,
  invokeFlushTaskStaging,
  maxSequenceForProject,
} from '../api/taskStaging.api';
import type {
  ScheduleTaskCreate,
  ScheduleTaskUpdate,
  ScheduleBucketCreate,
  ScheduleBucketUpdate,
} from './schedulingClient';
import { LINK_TYPE } from './schedulingClient';
import { isDemoActive } from './demoMode';
void _unused_QUERY_STALE_TIME; // keep import list stable

// ── Utilities ────────────────────────────────────────────────────────────────

/** Client-generated GUID for a not-yet-created upstream record. Used as the
 *  staging row's pmo_targetid AND as the eventual msdyn_projecttaskid /
 *  msdyn_projectbucketid / etc. so downstream ops in the same drain can
 *  reference it via @odata.bind. */
export function newTargetGuid(): string {
  // crypto.randomUUID is available in all modern browsers + the Code App host.
  return (globalThis.crypto?.randomUUID?.() ?? fallbackGuid());
}

function fallbackGuid(): string {
  // v4-ish. Only used when crypto.randomUUID is missing (very old hosts).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Per-project sequence cache: read `max(pmo_sequence)` once, then increment
// locally so we don't round-trip Dataverse on every write.
const seqCache = new Map<string, number>();

async function nextSequence(projectId: string): Promise<number> {
  let base = seqCache.get(projectId);
  if (base === undefined) {
    base = await maxSequenceForProject(projectId);
    seqCache.set(projectId, base);
  }
  const next = base + 1;
  seqCache.set(projectId, next);
  return next;
}

/** Reset the local sequence cache. Useful after a successful drain when the
 *  app knows Dataverse has advanced — or on project switch. Not required for
 *  correctness (Dataverse tolerates gaps in pmo_sequence). */
export function resetSequenceCache(projectId?: string): void {
  if (projectId) seqCache.delete(projectId);
  else seqCache.clear();
}

async function insertStagingRow(params: {
  projectId: string;
  operation: StagingOperation;
  entityType: StagingEntityType;
  targetId: string;
  payload: object;
  dependsOnStagingId?: string;
}): Promise<{ stagingId: string; targetId: string }> {
  const sequence = await nextSequence(params.projectId);
  const body: Record<string, unknown> = {
    pmo_operation: params.operation,
    pmo_entitytype: params.entityType,
    pmo_targetid: params.targetId,
    'pmo_Project@odata.bind': `/${ENTITY_SETS.project}(${params.projectId})`,
    pmo_payload: JSON.stringify(params.payload),
    pmo_syncstatus: STAGING_SYNC_STATUS.Pending,
    pmo_sequence: sequence,
    pmo_attempts: 0,
  };
  if (params.dependsOnStagingId) {
    body['pmo_DependsOnStagingId@odata.bind'] =
      `/${ENTITY_SETS.taskStaging}(${params.dependsOnStagingId})`;
  }
  const row = await createStagingRow(body);
  return { stagingId: row.pmo_taskstagingid, targetId: params.targetId };
}

// ── Task ─────────────────────────────────────────────────────────────────────

export async function stageTaskCreate(
  params: ScheduleTaskCreate,
): Promise<{ stagingId: string; taskId: string }> {
  const taskId = newTargetGuid();
  const { stagingId } = await insertStagingRow({
    projectId: params.projectId,
    operation: STAGING_OPERATION.Create,
    entityType: STAGING_ENTITY_TYPE.Task,
    targetId: taskId,
    // Store the exact ScheduleTaskCreate shape the drain will re-serialize
    // into PssCreateV1 + a follow-up PssUpdateV1 for dates/milestone.
    payload: params,
  });
  return { stagingId, taskId };
}

export async function stageTaskUpdate(
  params: ScheduleTaskUpdate,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Update,
    entityType: STAGING_ENTITY_TYPE.Task,
    targetId: params.taskId,
    payload: params,
  });
  return { stagingId };
}

export async function stageTaskDelete(
  taskId: string,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Delete,
    entityType: STAGING_ENTITY_TYPE.Task,
    targetId: taskId,
    payload: { taskId, projectId },
  });
  return { stagingId };
}

// ── Bucket ───────────────────────────────────────────────────────────────────

export async function stageBucketCreate(
  params: ScheduleBucketCreate,
): Promise<{ stagingId: string; bucketId: string }> {
  const bucketId = newTargetGuid();
  const { stagingId } = await insertStagingRow({
    projectId: params.projectId,
    operation: STAGING_OPERATION.Create,
    entityType: STAGING_ENTITY_TYPE.Bucket,
    targetId: bucketId,
    payload: params,
  });
  return { stagingId, bucketId };
}

export async function stageBucketUpdate(
  params: ScheduleBucketUpdate,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Update,
    entityType: STAGING_ENTITY_TYPE.Bucket,
    targetId: params.bucketId,
    payload: params,
  });
  return { stagingId };
}

export async function stageBucketDelete(
  bucketId: string,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Delete,
    entityType: STAGING_ENTITY_TYPE.Bucket,
    targetId: bucketId,
    payload: { bucketId, projectId },
  });
  return { stagingId };
}

// ── Dependency ───────────────────────────────────────────────────────────────

export interface StageDependencyCreate {
  projectId: string;
  successorTaskId: string;
  predecessorTaskId: string;
  linkType?: number;
  /** Optional staging-row lookup — if either referenced task is still a
   *  Pending Create in staging, wait one drain cycle. */
  dependsOnStagingId?: string;
}

export async function stageDependencyCreate(
  params: StageDependencyCreate,
): Promise<{ stagingId: string; dependencyId: string }> {
  const dependencyId = newTargetGuid();
  const { stagingId } = await insertStagingRow({
    projectId: params.projectId,
    operation: STAGING_OPERATION.Create,
    entityType: STAGING_ENTITY_TYPE.Dependency,
    targetId: dependencyId,
    dependsOnStagingId: params.dependsOnStagingId,
    payload: {
      projectId: params.projectId,
      successorTaskId: params.successorTaskId,
      predecessorTaskId: params.predecessorTaskId,
      linkType: params.linkType ?? LINK_TYPE.FS,
    },
  });
  return { stagingId, dependencyId };
}

export async function stageDependencyDelete(
  dependencyId: string,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Delete,
    entityType: STAGING_ENTITY_TYPE.Dependency,
    targetId: dependencyId,
    payload: { dependencyId, projectId },
  });
  return { stagingId };
}

// ── Resource assignment ──────────────────────────────────────────────────────

export interface StageAssignmentCreate {
  projectId: string;
  taskId: string;
  teamMemberId: string;
  name: string;
  /** Optional staging-row lookup — if the target task is a Pending Create,
   *  wait one drain cycle. */
  dependsOnStagingId?: string;
}

export async function stageAssignmentCreate(
  params: StageAssignmentCreate,
): Promise<{ stagingId: string; assignmentId: string }> {
  const assignmentId = newTargetGuid();
  const { stagingId } = await insertStagingRow({
    projectId: params.projectId,
    operation: STAGING_OPERATION.Create,
    entityType: STAGING_ENTITY_TYPE.Assignment,
    targetId: assignmentId,
    dependsOnStagingId: params.dependsOnStagingId,
    payload: {
      projectId: params.projectId,
      taskId: params.taskId,
      teamMemberId: params.teamMemberId,
      name: params.name,
    },
  });
  return { stagingId, assignmentId };
}

export async function stageAssignmentDelete(
  assignmentId: string,
  projectId: string,
): Promise<{ stagingId: string }> {
  const { stagingId } = await insertStagingRow({
    projectId,
    operation: STAGING_OPERATION.Delete,
    entityType: STAGING_ENTITY_TYPE.Assignment,
    targetId: assignmentId,
    payload: { assignmentId, projectId },
  });
  return { stagingId };
}

// ── Wait for sync ───────────────────────────────────────────────────────────────────────

/**
 * Force-drain the project staging queue synchronously and return the final
 * settled state of one row.
 *
 * Under the covers this POSTs to the pmo_FlushTaskStaging Custom API (see
 * FlushCustomApi.cs). That API drains the whole project's Pending backlog
 * inline in the sandbox and only returns once the drain is done. We then
 * do ONE read of the row to learn Synced vs Failed.
 *
 * Why sync instead of the previous async-plugin + poll model:
 *   - Task-board reliability was the sole priority. The old poll loop
 *     depended on the async FlushPlugin dispatching, which was silently
 *     failing in PROD for reasons unrelated to registration correctness
 *     (see 2026-07-21 incident notes). The sync CustomAPI path had been
 *     working the entire time.
 *   - The React app never used fire-and-forget anywhere -- every mutation
 *     already blocked on waitForStagingSync anyway. Switching to sync
 *     removed a whole class of failure modes for zero UX regression.
 *   - Users tolerate 10-15s spinners on Save; nobody tolerates 30-minute
 *     silent hangs followed by a scary "your work is preserved" toast.
 *
 * Caveats:
 *   - Dataverse sandbox plugins have a 2-minute wall-clock cap. If a
 *     single drain ever runs longer than that, the CustomAPI throws and
 *     the client surfaces it as a save failure. In practice a project's
 *     Pending queue is dozens of rows at most, drained in seconds.
 *   - dependsOnStagingId ordering is preserved because the CustomAPI
 *     drains in pmo_sequence order (see StagingDrain.Run).
 */
export async function waitForStagingSync(
  stagingId: string,
  projectId: string,
): Promise<{ synced: boolean; error?: string; scheduleApiCode?: string }> {
  // Demo mode: the create already landed in the in-memory store via dv.create.
  // There is no backend plugin to flush, and the staging row pmo_syncstatus
  // is never set to Synced, so the post-flush read would always return failure.
  // Short-circuit to success -- the data is already in-memory.
  if (isDemoActive()) return { synced: true };

  try {
    await invokeFlushTaskStaging({ projectId, stagingIds: [stagingId] });
  } catch (err) {
    // Sandbox 2-min limit, permission failure, transient Dataverse blip.
    // Read once anyway -- if the row happens to have settled to Synced
    // (e.g. drain finished but response was lost) we report success.
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const row = await getStagingRow(stagingId);
      if (row.pmo_syncstatus === STAGING_SYNC_STATUS.Synced) return { synced: true };
    } catch { /* deleted via retention -- fall through */ }
    return {
      synced: false,
      error: `Your save could not complete. ${msg}`,
    };
  }

  // Drain returned success. Read the row once to see what it settled on.
  let row;
  try {
    row = await getStagingRow(stagingId);
  } catch {
    // Row may have been hard-deleted after Synced (retention job)
    // between the drain response and this read. Treat as success.
    return { synced: true };
  }

  if (row.pmo_syncstatus === STAGING_SYNC_STATUS.Synced) return { synced: true };
  if (row.pmo_syncstatus === STAGING_SYNC_STATUS.Failed) {
    return {
      synced: false,
      error: row.pmo_syncerror ?? 'Save failed.',
      scheduleApiCode: row.pmo_scheduleapicode,
    };
  }
  // Drain succeeded but row is still Pending/InFlight. Very unusual --
  // means the drain ran but didn't process our specific row (e.g. it
  // was pruned by a debounce inside the drain). Return not-synced so
  // the caller surfaces an error the user can retry.
  return {
    synced: false,
    error: 'Save completed but this change was not applied. Please retry.',
  };
}
