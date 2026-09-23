/**
 * Serial queue for PSS bucket creates with mid-flight cancellation support.
 *
 * - Each click injects an optimistic entry immediately (in TaskWorkspace).
 * - PSS creates run one-at-a-time via an explicit drain loop.
 * - Invalidation is deferred until all pending creates drain so optimistic
 *   entries from still-pending creates are not wiped mid-flight.
 * - cancelBucketCreate(optimisticId) removes a queued item before it runs,
 *   or marks it cancelled if pssCreate is already awaited; either way the
 *   pending count decrements and the final invalidation still fires.
 *
 * Compatible with useSyncExternalStore via subscribeToBucketQueue /
 * getPendingBucketCount.
 */

interface QueuedCreate {
  optimisticId: string;
  pssCreate: () => Promise<void>;
  cancelled: boolean;
}

const subscribers = new Set<() => void>();
const items: QueuedCreate[] = [];
let pendingCount = 0;
let draining = false;
let queuedInvalidate: (() => void) | null = null;

function emit(): void {
  subscribers.forEach((fn) => fn());
}

export function getPendingBucketCount(): number {
  return pendingCount;
}

export function subscribeToBucketQueue(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/**
 * Cancel a queued or in-flight create by its optimistic ID.
 * - Queued (not yet started): skipped entirely on next drain tick.
 * - In-flight (pssCreate already running): marked cancelled; the drain will
 *   skip the post-completion bookkeeping so pendingCount stays consistent.
 * The caller is responsible for removing the optimistic cache entry.
 */
export function cancelBucketCreate(optimisticId: string): void {
  const item = items.find((i) => i.optimisticId === optimisticId && !i.cancelled);
  if (!item) return;

  item.cancelled = true;
  pendingCount--;
  emit();

  // If everything just drained to 0 and drain is idle, fire the reconciliation.
  if (pendingCount === 0 && !draining && queuedInvalidate) {
    queuedInvalidate();
    queuedInvalidate = null;
  }
}

/**
 * Enqueue a bucket PSS create.
 *
 * @param optimisticId  The `msdyn_projectbucketid` of the optimistic cache entry.
 * @param pssCreate     Async fn that runs the PSS create + PSS_DELAY wait.
 *                      Must NOT call invalidateQueries.
 * @param invalidate    Called once after all queued creates drain to zero.
 */
export function enqueueBucketCreate(
  optimisticId: string,
  pssCreate: () => Promise<void>,
  invalidate: () => void,
): void {
  items.push({ optimisticId, pssCreate, cancelled: false });
  queuedInvalidate = invalidate;
  pendingCount++;
  emit();
  void runDrain();
}

async function runDrain(): Promise<void> {
  if (draining) return;
  draining = true;

  while (items.length > 0) {
    const item = items[0];

    if (item.cancelled) {
      items.shift();
      continue;
    }

    try {
      await item.pssCreate();
    } catch {
      // errors handled inside pssCreate via .catch()
    }

    items.shift();

    if (!item.cancelled) {
      // Normal completion: decrement. If cancelled during await,
      // cancelBucketCreate already decremented.
      pendingCount--;
      emit();
    }
  }

  draining = false;

  // Single reconciliation invalidation after all items processed.
  if (queuedInvalidate) {
    queuedInvalidate();
    queuedInvalidate = null;
  }
}
