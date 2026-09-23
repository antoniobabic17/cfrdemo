/**
 * Read overlay for pmo_taskstaging.
 *
 * The staging table is authoritative for "changes the user just made that
 * haven't reached PSS yet." Every read hook that renders tasks/buckets/deps/
 * assignments unions its OData result with the active staging rows so the
 * user sees their edit immediately.
 *
 * Overlay rules (per row):
 *   - Create + no upstream match         → prepend synthetic row, _saving=true
 *   - Update on existing upstream row    → field-level merge, _saving=true
 *   - Delete (Pending/InFlight)          → filter row out
 *   - Failed                             → do NOT overlay; caller drops back
 *                                          to upstream (implicit rollback)
 *
 * Live subscription via useSyncExternalStore: read hooks call
 * `useStagingRows(projectId)` to trigger re-render when the plugin flips a
 * row's pmo_syncstatus (or a new stage-write is inserted). Under the hood a
 * single polling loop per project fetches active rows every 3 s.
 */
import { useSyncExternalStore, useEffect, useState, useMemo } from 'react';
import { listActiveStagingRowsForProject } from '../api/taskStaging.api';
import type { TaskStagingRow } from '../models/taskStaging.model';
import {
  STAGING_OPERATION,
  STAGING_ENTITY_TYPE,
  STAGING_SYNC_STATUS,
} from './constants';
import type { ProjectTask } from '../models/projectTask.model';
import type { ProjectBucket } from '../models/projectBucket.model';
import type {
  ScheduleTaskCreate,
  ScheduleTaskUpdate,
  ScheduleBucketCreate,
  ScheduleBucketUpdate,
} from './schedulingClient';
import { toDataverseDateOnly } from './dateOnly';

// ── Store ────────────────────────────────────────────────────────────────────

interface ProjectStore {
  rows: readonly TaskStagingRow[];
  subscribers: Set<() => void>;
  pollHandle: ReturnType<typeof setInterval> | null;
  refCount: number;
  inFlightFetch: Promise<void> | null;
  lastFetchedAt: number;
}

const stores = new Map<string, ProjectStore>();

const POLL_INTERVAL_MS = 3_000;

function getStore(projectId: string): ProjectStore {
  let s = stores.get(projectId);
  if (!s) {
    s = {
      rows: [],
      subscribers: new Set(),
      pollHandle: null,
      refCount: 0,
      inFlightFetch: null,
      lastFetchedAt: 0,
    };
    stores.set(projectId, s);
  }
  return s;
}

function notify(store: ProjectStore): void {
  store.subscribers.forEach((fn) => fn());
}

async function fetchRows(projectId: string): Promise<void> {
  const store = getStore(projectId);
  if (store.inFlightFetch) return store.inFlightFetch;
  const p = (async () => {
    try {
      const rows = await listActiveStagingRowsForProject(projectId);
      // Only notify if the row list actually changed (by id + status).
      if (!shallowRowsEqual(store.rows, rows)) {
        store.rows = rows;
        notify(store);
      }
      store.lastFetchedAt = Date.now();
    } catch (err) {
      // Best-effort — never let the overlay crash a page.
      // eslint-disable-next-line no-console
      console.warn('[stagingOverlay] fetch failed', err);
    } finally {
      store.inFlightFetch = null;
    }
  })();
  store.inFlightFetch = p;
  return p;
}

function shallowRowsEqual(a: readonly TaskStagingRow[], b: readonly TaskStagingRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i];
    if (
      x.pmo_taskstagingid !== y.pmo_taskstagingid ||
      x.pmo_syncstatus !== y.pmo_syncstatus ||
      x.pmo_sequence !== y.pmo_sequence
    ) return false;
  }
  return true;
}

function subscribe(projectId: string, listener: () => void): () => void {
  const store = getStore(projectId);
  store.subscribers.add(listener);
  store.refCount++;
  if (store.pollHandle === null) {
    // Kick immediately + start polling.
    fetchRows(projectId);
    store.pollHandle = setInterval(() => fetchRows(projectId), POLL_INTERVAL_MS);
  }
  return () => {
    store.subscribers.delete(listener);
    store.refCount--;
    if (store.refCount <= 0 && store.pollHandle !== null) {
      clearInterval(store.pollHandle);
      store.pollHandle = null;
    }
  };
}

/** React hook. Returns the current active staging rows for a project. */
export function useStagingRows(projectId: string | undefined): readonly TaskStagingRow[] {
  const id = projectId ?? '';
  const rows = useSyncExternalStore(
    (listener) => (id ? subscribe(id, listener) : () => {}),
    () => (id ? getStore(id).rows : EMPTY),
    () => EMPTY,
  );
  return rows;
}

const EMPTY: readonly TaskStagingRow[] = Object.freeze([]);

/** Force an immediate refetch — call after a mutation's write settles so the
 *  user's new staging row is picked up without waiting for the poll tick. */
export function refreshStagingRows(projectId: string): Promise<void> {
  return fetchRows(projectId);
}

/** Dev helper. */
if (typeof window !== 'undefined') {
  (window as unknown as { __stagingOverlayDebug?: () => unknown }).__stagingOverlayDebug =
    () => Array.from(stores.entries()).map(([k, v]) => ({ projectId: k, rows: v.rows.length, subs: v.subscribers.size }));
}

// ── Payload parsing ──────────────────────────────────────────────────────────

function parsePayload<T>(row: TaskStagingRow): T | null {
  try { return JSON.parse(row.pmo_payload) as T; } catch { return null; }
}

function isPendingOrInFlight(row: TaskStagingRow): boolean {
  return row.pmo_syncstatus === STAGING_SYNC_STATUS.Pending ||
         row.pmo_syncstatus === STAGING_SYNC_STATUS.InFlight;
}

/** A Create staging row should stay overlaid in the grace window right
 *  after it flips Synced -- if the upstream OData refetch hasnt caught
 *  up yet, dropping the overlay would leave the card visibly gone for a
 *  moment. isSyncedRecently keeps the synth row until the upstream fetch
 *  starts returning the real record (at which point the merge loop below
 *  drops the synth naturally since seenIds already contains its id). */
function stillOverlaidCreate(row: TaskStagingRow): boolean {
  if (isPendingOrInFlight(row)) return true;
  if (row.pmo_syncstatus !== STAGING_SYNC_STATUS.Synced) return false;
  return true;
}

/** Delete stays overlaid (i.e. the target row remains hidden from the
 *  merged list) while Pending / InFlight / recently-Synced. Without the
 *  Synced case a deleted task briefly reappears in the ~1s gap between
 *  "plugin flips Synced" and "OData refetch returns the without-it list". */
function stillOverlaidDelete(row: TaskStagingRow): boolean {
  return isPendingOrInFlight(row) || row.pmo_syncstatus === STAGING_SYNC_STATUS.Synced;
}

// ── Task overlay ─────────────────────────────────────────────────────────────

export function applyTaskStagingOverlay(
  tasks: ProjectTask[],
  stagingRows: readonly TaskStagingRow[],
): ProjectTask[] {
  const taskRows = stagingRows.filter((r) => r.pmo_entitytype === STAGING_ENTITY_TYPE.Task);
  if (taskRows.length === 0) return tasks;

  // Index by targetId → most recent staging row (highest sequence wins if
  // multiple exist for the same task).
  const byTarget = new Map<string, TaskStagingRow>();
  for (const r of taskRows) {
    const prev = byTarget.get(r.pmo_targetid);
    if (!prev || (r.pmo_sequence ?? 0) > (prev.pmo_sequence ?? 0)) {
      byTarget.set(r.pmo_targetid, r);
    }
  }

  // Deletes → filter upstream rows out (only when Pending/InFlight).
  const deleted = new Set<string>();
  for (const [id, row] of byTarget) {
    if (row.pmo_operation === STAGING_OPERATION.Delete && stillOverlaidDelete(row)) {
      deleted.add(id);
    }
  }

  const merged: ProjectTask[] = [];
  const seenIds = new Set<string>();
  for (const t of tasks) {
    if (deleted.has(t.msdyn_projecttaskid)) continue;
    const stagingRow = byTarget.get(t.msdyn_projecttaskid);
    if (
      stagingRow &&
      stagingRow.pmo_operation === STAGING_OPERATION.Update &&
      isPendingOrInFlight(stagingRow)
    ) {
      const patch = parsePayload<ScheduleTaskUpdate>(stagingRow);
      merged.push(mergeTaskWithUpdate(t, patch));
    } else {
      merged.push(t);
    }
    seenIds.add(t.msdyn_projecttaskid);
  }

  // Creates → prepend synthetic rows for those the upstream fetch doesn't
  // yet include. Also keep the synth row visible during the grace window
  // right after the plugin flips Synced -- listActiveStagingRowsForProject
  // is what actually bounds the grace period (60s cutoff). Once the OData
  // refetch returns the real row, seenIds.has(id) is true above and we skip
  // this synth row cleanly. Net: the card never disappears between "Synced"
  // and "cache has the real record".
  for (const [id, row] of byTarget) {
    if (seenIds.has(id)) continue;
    if (row.pmo_operation !== STAGING_OPERATION.Create) continue;
    if (!stillOverlaidCreate(row)) continue;
    const params = parsePayload<ScheduleTaskCreate>(row);
    if (!params) continue;
    const synth = taskFromCreate(id, params);
    // Keep _saving=true even in the Synced grace window: TaskRow relies
    // on this flag AND on pendingExtras. Dropping it here creates a brief
    // window where the card looks done while extras are still being
    // pushed. useCreateProjectTask.mutationFn calls markPendingExtras
    // BEFORE this overlay ever refreshes, so the ORed isSaving in TaskRow
    // stays true regardless -- this is belt-and-suspenders.
    merged.push(synth);
  }

  return merged;
}

function mergeTaskWithUpdate(t: ProjectTask, p: ScheduleTaskUpdate | null): ProjectTask {
  if (!p) return { ...t, _saving: true };
  const next: ProjectTask = { ...t, _saving: true };
  if (p.subject !== undefined) next.msdyn_subject = p.subject;
  if (p.progress !== undefined) next.msdyn_progress = p.progress;
  if (p.effortCompleted !== undefined) next.msdyn_effortcompleted = p.effortCompleted;
  if (p.effort !== undefined) next.msdyn_effort = p.effort;
  if (p.scheduledStart !== undefined) next.msdyn_scheduledstart = toDataverseDateOnly(p.scheduledStart);
  if (p.scheduledEnd !== undefined) {
    next.msdyn_scheduledend = toDataverseDateOnly(p.scheduledEnd);
    next.msdyn_finish = next.msdyn_scheduledend;
  }
  if (p.duration !== undefined) next.msdyn_duration = p.duration;
  if (p.isMilestone !== undefined) next.msdyn_ismilestone = p.isMilestone;
  if (p.priority !== undefined) next.msdyn_priority = p.priority;
  if (p.description !== undefined) next.msdyn_description = p.description;
  if (p.bucketId !== undefined) next['_msdyn_projectbucket_value'] = p.bucketId;
  return next;
}

function taskFromCreate(taskId: string, params: ScheduleTaskCreate): ProjectTask {
  return {
    msdyn_projecttaskid: taskId,
    msdyn_subject: params.subject,
    msdyn_scheduledstart: params.scheduledStart,
    msdyn_scheduledend: params.scheduledEnd,
    msdyn_duration: params.duration,
    msdyn_ismilestone: params.isMilestone,
    msdyn_progress: 0,
    msdyn_outlinelevel: 1,
    statecode: 0,
    '_msdyn_project_value': params.projectId,
    '_msdyn_projectbucket_value': params.bucketId,
    '_msdyn_parenttask_value': params.parentTaskId,
    _saving: true,
  };
}

// ── Bucket overlay ───────────────────────────────────────────────────────────

export function applyBucketStagingOverlay(
  buckets: ProjectBucket[],
  stagingRows: readonly TaskStagingRow[],
): ProjectBucket[] {
  const bucketRows = stagingRows.filter((r) => r.pmo_entitytype === STAGING_ENTITY_TYPE.Bucket);
  if (bucketRows.length === 0) return buckets;

  const byTarget = new Map<string, TaskStagingRow>();
  for (const r of bucketRows) {
    const prev = byTarget.get(r.pmo_targetid);
    if (!prev || (r.pmo_sequence ?? 0) > (prev.pmo_sequence ?? 0)) {
      byTarget.set(r.pmo_targetid, r);
    }
  }

  const deleted = new Set<string>();
  for (const [id, row] of byTarget) {
    if (row.pmo_operation === STAGING_OPERATION.Delete && stillOverlaidDelete(row)) {
      deleted.add(id);
    }
  }

  const merged: ProjectBucket[] = [];
  const seenIds = new Set<string>();
  for (const b of buckets) {
    if (deleted.has(b.msdyn_projectbucketid)) continue;
    const row = byTarget.get(b.msdyn_projectbucketid);
    if (
      row &&
      row.pmo_operation === STAGING_OPERATION.Update &&
      isPendingOrInFlight(row)
    ) {
      const patch = parsePayload<ScheduleBucketUpdate>(row);
      merged.push({ ...b, msdyn_name: patch?.name ?? b.msdyn_name });
    } else {
      merged.push(b);
    }
    seenIds.add(b.msdyn_projectbucketid);
  }

  for (const [id, row] of byTarget) {
    if (seenIds.has(id)) continue;
    if (row.pmo_operation !== STAGING_OPERATION.Create) continue;
    if (!isPendingOrInFlight(row)) continue;
    const params = parsePayload<ScheduleBucketCreate>(row);
    if (!params) continue;
    merged.push({
      msdyn_projectbucketid: id,
      msdyn_name: params.name,
      msdyn_displayorder: params.displayOrder,
      statecode: 0,
      '_msdyn_project_value': params.projectId,
    });
  }

  return merged;
}

// ── Dependency overlay ───────────────────────────────────────────────────────

export interface RawTaskDependency {
  msdyn_projecttaskdependencyid: string;
  msdyn_linktype?: number;
  '_msdyn_predecessortask_value'?: string;
  '_msdyn_successortask_value'?: string;
  '_msdyn_project_value'?: string;
  statecode?: number;
  _saving?: boolean;
}

export function applyDependencyStagingOverlay<T extends RawTaskDependency>(
  deps: T[],
  stagingRows: readonly TaskStagingRow[],
): T[] {
  const depRows = stagingRows.filter((r) => r.pmo_entitytype === STAGING_ENTITY_TYPE.Dependency);
  if (depRows.length === 0) return deps;

  const byTarget = new Map<string, TaskStagingRow>();
  for (const r of depRows) byTarget.set(r.pmo_targetid, r);

  const deleted = new Set<string>();
  for (const [id, row] of byTarget) {
    if (row.pmo_operation === STAGING_OPERATION.Delete && stillOverlaidDelete(row)) {
      deleted.add(id);
    }
  }

  const merged: T[] = [];
  const seen = new Set<string>();
  for (const d of deps) {
    if (deleted.has(d.msdyn_projecttaskdependencyid)) continue;
    merged.push(d);
    seen.add(d.msdyn_projecttaskdependencyid);
  }

  for (const [id, row] of byTarget) {
    if (seen.has(id)) continue;
    if (row.pmo_operation !== STAGING_OPERATION.Create) continue;
    if (!isPendingOrInFlight(row)) continue;
    const params = parsePayload<{
      projectId: string; successorTaskId: string; predecessorTaskId: string; linkType?: number;
    }>(row);
    if (!params) continue;
    merged.push({
      msdyn_projecttaskdependencyid: id,
      msdyn_linktype: params.linkType,
      '_msdyn_predecessortask_value': params.predecessorTaskId,
      '_msdyn_successortask_value': params.successorTaskId,
      '_msdyn_project_value': params.projectId,
      statecode: 0,
      _saving: true,
    } as T);
  }

  return merged;
}

// ── Assignment overlay ───────────────────────────────────────────────────────

export interface RawResourceAssignment {
  msdyn_resourceassignmentid: string;
  msdyn_name?: string;
  '_msdyn_taskid_value'?: string;
  '_msdyn_projectteamid_value'?: string;
  '_msdyn_projectid_value'?: string;
  statecode?: number;
  _saving?: boolean;
  // Option-C custom-source assignee identity (systemuserid + display name).
  // Present only on the custom path; the staging overlay never sets these.
  assigneeUserId?: string | null;
  assigneeUserName?: string;
  /** New Resource Model: per-assignee contributed hours on the task. */
  contributedHours?: number;
}

export function applyAssignmentStagingOverlay<T extends RawResourceAssignment>(
  assignments: T[],
  stagingRows: readonly TaskStagingRow[],
): T[] {
  const assignRows = stagingRows.filter((r) => r.pmo_entitytype === STAGING_ENTITY_TYPE.Assignment);
  if (assignRows.length === 0) return assignments;

  const byTarget = new Map<string, TaskStagingRow>();
  for (const r of assignRows) byTarget.set(r.pmo_targetid, r);

  const deleted = new Set<string>();
  for (const [id, row] of byTarget) {
    if (row.pmo_operation === STAGING_OPERATION.Delete && stillOverlaidDelete(row)) {
      deleted.add(id);
    }
  }

  const merged: T[] = [];
  const seen = new Set<string>();
  for (const a of assignments) {
    if (deleted.has(a.msdyn_resourceassignmentid)) continue;
    merged.push(a);
    seen.add(a.msdyn_resourceassignmentid);
  }

  for (const [id, row] of byTarget) {
    if (seen.has(id)) continue;
    if (row.pmo_operation !== STAGING_OPERATION.Create) continue;
    if (!isPendingOrInFlight(row)) continue;
    const params = parsePayload<{
      projectId: string; taskId: string; teamMemberId: string; name: string;
    }>(row);
    if (!params) continue;
    merged.push({
      msdyn_resourceassignmentid: id,
      msdyn_name: params.name,
      '_msdyn_taskid_value': params.taskId,
      '_msdyn_projectteamid_value': params.teamMemberId,
      '_msdyn_projectid_value': params.projectId,
      statecode: 0,
      _saving: true,
    } as T);
  }

  return merged;
}

// ── Failed-row surfacing hook ────────────────────────────────────────────────

/**
 * Fire a callback for every staging row that flips to Failed. Used by the
 * mutation-hook layer to push failed patches into `failedSavesStore` +
 * `toast.error` so the rollback UX matches the pre-staging behaviour.
 *
 * Deduplicates by (stagingId, attempts) so re-entering the failed state
 * (e.g. Retry that fails again) fires exactly once per attempt.
 */
export function useFailedStagingWatcher(
  projectId: string | undefined,
  onFailed: (row: TaskStagingRow) => void,
): void {
  const rows = useStagingRows(projectId);
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    for (const r of rows) {
      if (r.pmo_syncstatus !== STAGING_SYNC_STATUS.Failed) continue;
      const key = `${r.pmo_taskstagingid}::${r.pmo_attempts ?? 0}`;
      if (firedKeys.has(key)) continue;
      firedKeys.add(key);
      persistFiredKeys();
      try { onFailed(r); } catch { /* never let the watcher crash */ }
    }
  }, [rows, onFailed]);
}

// firedKeys persists across page reloads via localStorage so a Failed
// staging row that lingers in Dataverse (retention window can be days)
// only ever surfaces ONE toast to the user, not one per app-open. Bounded
// at MAX_FIRED_KEYS entries with FIFO eviction so the storage cant grow
// unboundedly if failures pile up.
const FIRED_KEYS_STORAGE = 'cfr_staging_fired_keys';
const MAX_FIRED_KEYS = 500;
const firedKeys: Set<string> = (() => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(FIRED_KEYS_STORAGE);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
})();
function persistFiredKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    let arr = Array.from(firedKeys);
    if (arr.length > MAX_FIRED_KEYS) {
      // FIFO trim: drop oldest entries. Set iteration order is insertion order.
      arr = arr.slice(-MAX_FIRED_KEYS);
      firedKeys.clear();
      for (const k of arr) firedKeys.add(k);
    }
    window.localStorage.setItem(FIRED_KEYS_STORAGE, JSON.stringify(arr));
  } catch { /* out of space / disabled -- swallow */ }
}

// ── Degraded-save detector ───────────────────────────────────────────────────
//
// If the current user has staged a row that has been sitting Pending for
// more than DEGRADED_SAVE_THRESHOLD_MS with no InFlight transition, the
// background flush plugin is likely stuck (see 2026-07-20 Tracey incident:
// pmo_taskstaging rows sat Pending for 30+ min because the Dataverse async
// service wasn't dispatching the FlushPlugin steps).
//
// Option C in the 2026-07-20 fix set: self-referential -- only fires when
// THIS user is actually feeling pain. Doesn't over-alarm during quiet
// plugin periods, and doesn't require a global "is the plugin alive?" query.

/**
 * 60 seconds is well above the plugin's 10s debounce so we don't misfire
 * during normal quiet periods; well below the client's 30-min queueTimeout
 * so users see the warning long before their save fails.
 */
const DEGRADED_SAVE_THRESHOLD_MS = 60_000;

/**
 * True iff any staging row this user owns has been Pending (never InFlight,
 * never Synced, never Failed) for longer than the threshold. Re-evaluates
 * every ~5s to catch rows that cross the threshold without a new staging
 * event.
 */
export function useDegradedSaveWarning(
  projectId: string | undefined,
  currentUserId: string | undefined,
): boolean {
  const rows = useStagingRows(projectId);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!projectId || !currentUserId) return;
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [projectId, currentUserId]);
  return useMemo(() => {
    if (!currentUserId) return false;
    if (!rows || rows.length === 0) return false;
    const now = Date.now();
    for (const r of rows) {
      const owner = (r as unknown as { _ownerid_value?: string })._ownerid_value;
      if (owner?.toLowerCase() !== currentUserId.toLowerCase()) continue;
      if (r.pmo_syncstatus !== STAGING_SYNC_STATUS.Pending) continue;
      if (!r.createdon) continue;
      const ageMs = now - new Date(r.createdon).getTime();
      if (ageMs > DEGRADED_SAVE_THRESHOLD_MS) return true;
    }
    void tick;
    return false;
  }, [rows, currentUserId, tick]);
}
