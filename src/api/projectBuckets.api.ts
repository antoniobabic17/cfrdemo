import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import {
  createScheduledBucket,
  updateScheduledBucket,
  deleteScheduledBucket,
} from '../lib/schedulingClient';
import type { ProjectBucket } from '../models/projectBucket.model';
import { getBucketOrder } from '../models/projectBucket.model';

const SET = ENTITY_SETS.projectBucket;

const BASE_SELECT: string[] = [
  'msdyn_projectbucketid',
  'msdyn_name',
  'msdyn_displayorder',
  'pmo_bucketorder',
  'statecode',
  'createdon',
  '_msdyn_project_value',
];

export async function listProjectBuckets(projectId: string): Promise<ProjectBucket[]> {
  // Server-side orderby uses msdyn_displayorder for legacy compatibility;
  // client-side sort below prefers pmo_bucketorder so drag-to-reorder
  // takes precedence without needing OData's null-handling quirks.
  const raw = await dv.list<ProjectBucket>(SET, {
    $select: BASE_SELECT,
    $filter: `_msdyn_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'msdyn_displayorder asc',
  });
  return [...raw].sort((a, b) => {
    const oa = getBucketOrder(a);
    const ob = getBucketOrder(b);
    if (oa !== ob) return oa - ob;
    // Tie-break by createdon so the order is stable within a project.
    return (a.createdon ?? '').localeCompare(b.createdon ?? '');
  });
}

export async function createProjectBucket(
  projectId: string,
  name: string,
  displayOrder?: number,
): Promise<void> {
  return createScheduledBucket({ projectId, name, displayOrder });
}

export async function renameProjectBucket(
  projectId: string,
  bucketId: string,
  name: string,
): Promise<void> {
  return updateScheduledBucket(projectId, { bucketId, name });
}

export async function deleteProjectBucket(projectId: string, bucketId: string): Promise<void> {
  return deleteScheduledBucket(projectId, bucketId);
}

/**
 * Set pmo_bucketorder via direct OData PATCH.
 *
 * PSS blocks writes to msdyn_displayorder via both msdyn_PssUpdateV1
 * (AV-0002) and direct PATCH. But msdyn_projectbucket accepts direct
 * PATCH on our own custom columns (pmo_*) -- same escape hatch we use
 * for pmo_taskeffort / pmo_taskhoursdone on msdyn_projecttask.
 *
 * Nullable: pass null to clear the override and fall back to
 * msdyn_displayorder for that bucket.
 */
export async function setProjectBucketOrder(bucketId: string, order: number | null): Promise<void> {
  return dv.update(SET, bucketId, { pmo_bucketorder: order });
}
