/** msdyn_projectbucket -- Planner bucket (Kanban column) */
export interface ProjectBucket {
  msdyn_projectbucketid: string;
  msdyn_name: string;
  /** PSS-owned displayorder. Read-only from client -- PSS blocks writes
   *  via both msdyn_PssUpdateV1 (AV-0002) and direct OData PATCH ("You
   *  cannot directly do 'Update' operation to 'msdyn_projectbucket'").
   *  Kept as a fallback when pmo_bucketorder is null (pre-migration
   *  buckets). */
  msdyn_displayorder?: number;
  /** CVS-owned display order. Directly writable via OData PATCH so
   *  drag-to-reorder works without fighting PSS. Nullable. Reads prefer
   *  this over msdyn_displayorder; a bucket with pmo_bucketorder set
   *  wins ordering over one that only has msdyn_displayorder. */
  pmo_bucketorder?: number;
  statecode?: 0 | 1;
  createdon?: string;

  '_msdyn_project_value'?: string;

  /** Transient UI flag -- true while a bucket-reorder mutation is
   *  in-flight for this row. Never persisted; set by
   *  useReorderProjectBuckets.onMutate for every bucket whose order
   *  changed, cleared in onSettled on either success or rollback.
   *  BucketSection renders a Loader2 in the header when true. */
  _saving?: boolean;
}

/**
 * Effective display order = pmo_bucketorder when set, else
 * msdyn_displayorder. Callers sort ascending; ties fall back to
 * createdon so the order is stable within a project.
 */
export function getBucketOrder(b: Pick<ProjectBucket, 'pmo_bucketorder' | 'msdyn_displayorder'>): number {
  return b.pmo_bucketorder ?? b.msdyn_displayorder ?? Number.MAX_SAFE_INTEGER;
}
