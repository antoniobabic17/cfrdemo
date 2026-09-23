/**
 * Option-C custom-source read helpers for pmo_bucket. Sister to
 * customTasks.api.ts. See docs/pss-decoupling-c-design.md.
 *
 * Reads from pmo_bucket and normalizes back into the existing
 * ProjectBucket shape so downstream consumers (BucketSection,
 * TaskWorkspace, bucket-order helpers) see no type change.
 */

import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import { deleteCustomTask } from './customTasks.api';
import type { ProjectBucket } from '../models/projectBucket.model';
import { getBucketOrder } from '../models/projectBucket.model';

interface PmoBucketRow {
  pmo_bucketid: string;
  pmo_name?: string | null;
  pmo_orderinproject?: number | null;
  statecode?: 0 | 1;
  createdon?: string;
  // NEW canonical lookup -> pmo_project (msdyn_project decoupling, Tier 1);
  // replaces _pmo_project_value which targeted the msdyn_project shell.
  _pmo_projectref_value?: string | null;
}

const SET = 'pmo_buckets';

const BASE_SELECT: string[] = [
  'pmo_bucketid',
  'pmo_name',
  'pmo_orderinproject',
  'statecode',
  'createdon',
  '_pmo_projectref_value',
];

/**
 * Normalize a pmo_bucket row into the ProjectBucket shape the rest of
 * the app already consumes. Same-Guid on both sides means pmo_bucketid
 * populates BOTH msdyn_projectbucketid + pmo_bucketorder in the output
 * so getBucketOrder + drag-to-reorder logic keeps working.
 */
export function normalizeCustomBucket(row: PmoBucketRow): ProjectBucket {
  const order = row.pmo_orderinproject ?? undefined;
  return {
    msdyn_projectbucketid: row.pmo_bucketid,
    msdyn_name:            row.pmo_name ?? '',
    // pmo side has a single unified "orderinproject" column. Populate
    // BOTH msdyn_displayorder and pmo_bucketorder from it so the order
    // resolves correctly regardless of which the caller inspects
    // (getBucketOrder helper prefers pmo_bucketorder).
    msdyn_displayorder: order,
    pmo_bucketorder:    order,
    statecode:          row.statecode ?? 0,
    createdon:          row.createdon,
    _msdyn_project_value: row._pmo_projectref_value ?? undefined,
  };
}

/** Fetch buckets from pmo_bucket for a project (active only). Sorted the
 *  same way the msdyn read path sorts. */
export async function listCustomBuckets(projectId: string): Promise<ProjectBucket[]> {
  const raw = await dv.list<PmoBucketRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_projectref_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'pmo_orderinproject asc',
  });
  const rows = raw.map(normalizeCustomBucket);
  return [...rows].sort((a, b) => {
    const oa = getBucketOrder(a);
    const ob = getBucketOrder(b);
    if (oa !== ob) return oa - ob;
    return (a.createdon ?? '').localeCompare(b.createdon ?? '');
  });
}

// ── Option-C Phase 4 write path (direct OData, no PSS) ─────────────────────
//
// When pmo.task_source === 'custom' the app writes buckets straight to
// pmo_bucket via plain CRUD. No OperationSet, no ~15s PSS round-trip, and
// dv.create returns the real GUID synchronously so there is no
// optimistic-placeholder window. msdyn_projectbucket (and thus P4W) goes
// stale until the reverse ETL lands -- accepted on DEV during Phase 4a.

/** Shape the create payload for pmo_bucket. Pure -- unit tested. The
 *  project lookup is bound via the @odata.bind navigation property
 *  (pmo_ProjectRef -> pmo_projects, PascalCase nav-property name; the read
 *  side reads it back as the lowercase _pmo_projectref_value). Tier-1
 *  decoupling: this custom path targets pmo_project directly, not the shell. */
export function buildCustomBucketCreatePayload(
  projectId: string,
  name: string,
  orderInProject?: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    pmo_name: name,
    'pmo_ProjectRef@odata.bind': `/pmo_projects(${projectId})`,
  };
  if (orderInProject !== undefined) payload.pmo_orderinproject = orderInProject;
  return payload;
}

/** Create a bucket in pmo_bucket. Returns the new server GUID. */
export async function createCustomBucket(
  projectId: string,
  name: string,
  orderInProject?: number,
): Promise<string> {
  const created = await dv.create<PmoBucketRow>(
    SET,
    buildCustomBucketCreatePayload(projectId, name, orderInProject),
  );
  void touchCustomProject(projectId);
  return created.pmo_bucketid;
}

/** Rename a bucket. */
export async function renameCustomBucket(bucketId: string, name: string): Promise<void> {
  await dv.update(SET, bucketId, { pmo_name: name });
  void touchProjectFromChild(SET, bucketId, '_pmo_projectref_value');
}

/** Soft-delete a bucket (statecode=1) and cascade-deactivate all active tasks
 *  inside it, so Tasks count and board stay in sync. Matching the mirror plugin's
 *  soft-delete convention so audit history + reconciliation stay symmetric. */
export async function deleteCustomBucket(bucketId: string): Promise<void> {
  // Cascade: deactivate every active task in this bucket first.
  // Doing this BEFORE the bucket deactivation so the task touch helpers can
  // still resolve the project ref via the bucket.
  const tasks = await dv.list<{ pmo_taskid: string }>(
    'pmo_tasks',
    { $select: ['pmo_taskid'], $filter: `_pmo_bucket_value eq '${bucketId}' and statecode eq 0` },
  );
  await Promise.all(tasks.map((task) => deleteCustomTask(task.pmo_taskid)));
  void touchProjectFromChild(SET, bucketId, '_pmo_projectref_value');
  await dv.deactivate(SET, bucketId);
}

/** Set a bucket's order. Writes the same pmo_orderinproject column
 *  listCustomBuckets sorts by, so reorder is coherent end-to-end. */
export async function setCustomBucketOrder(bucketId: string, order: number): Promise<void> {
  await dv.update(SET, bucketId, { pmo_orderinproject: order });
  void touchProjectFromChild(SET, bucketId, '_pmo_projectref_value');
}
