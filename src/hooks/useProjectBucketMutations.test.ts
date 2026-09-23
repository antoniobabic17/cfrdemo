import { describe, it, expect } from 'vitest';
import { realBucketIds, resolveDeferredReorder, resolveDeferredDelete } from './useProjectBucketMutations';
import type { ProjectBucket } from '../models/projectBucket.model';

describe('realBucketIds (reorder placeholder filter)', () => {
  it('drops optimistic placeholder ids so they never hit the OData key', () => {
    // 2026-07-28 regression: an in-flight bucket's placeholder id used to be
    // PATCHed as pmo_projectbuckets(optimistic-...), which Dataverse rejected
    // with "')' or ',' expected at position 11" and killed the whole reorder.
    const ordered = ['guid-a', 'optimistic-1785237868194', 'guid-b'];
    expect(realBucketIds(ordered)).toEqual(['guid-a', 'guid-b']);
  });

  it('keeps all ids when none are optimistic', () => {
    const ordered = ['guid-a', 'guid-b', 'guid-c'];
    expect(realBucketIds(ordered)).toEqual(ordered);
  });

  it('preserves order of the surviving real ids', () => {
    const ordered = ['optimistic-1', 'guid-b', 'guid-a', 'optimistic-2'];
    expect(realBucketIds(ordered)).toEqual(['guid-b', 'guid-a']);
  });

  it('returns empty when every id is optimistic', () => {
    expect(realBucketIds(['optimistic-1', 'optimistic-2'])).toEqual([]);
  });
});

const mkBucket = (id: string): ProjectBucket => ({
  msdyn_projectbucketid: id,
  msdyn_name: id,
  statecode: 0,
  '_msdyn_project_value': 'proj-1',
});

describe('resolveDeferredReorder (drag a still-creating bucket)', () => {
  const optimisticId = 'optimistic-1785237868194';

  it('waits while the optimistic placeholder is still in the list', () => {
    const buckets = [mkBucket('guid-a'), mkBucket(optimisticId), mkBucket('guid-b')];
    const res = resolveDeferredReorder({
      orderedIds: [optimisticId, 'guid-a', 'guid-b'],
      optimisticId,
      buckets,
      knownRealIds: new Set(['guid-a', 'guid-b']),
    });
    expect(res).toEqual({ status: 'wait' });
  });

  it('maps the optimistic slot to the newly-created real id and keeps order', () => {
    // Create settled: placeholder gone, a brand-new 'guid-new' appeared.
    const buckets = [mkBucket('guid-a'), mkBucket('guid-new'), mkBucket('guid-b')];
    const res = resolveDeferredReorder({
      orderedIds: [optimisticId, 'guid-a', 'guid-b'],
      optimisticId,
      buckets,
      knownRealIds: new Set(['guid-a', 'guid-b']),
    });
    expect(res).toEqual({ status: 'ready', orderedIds: ['guid-new', 'guid-a', 'guid-b'] });
  });

  it('abandons when the placeholder vanished and no new bucket appeared (create failed)', () => {
    const buckets = [mkBucket('guid-a'), mkBucket('guid-b')];
    const res = resolveDeferredReorder({
      orderedIds: [optimisticId, 'guid-a', 'guid-b'],
      optimisticId,
      buckets,
      knownRealIds: new Set(['guid-a', 'guid-b']),
    });
    expect(res).toEqual({ status: 'abandon' });
  });

  it('abandons when two new buckets appear at once (ambiguous)', () => {
    const buckets = [mkBucket('guid-a'), mkBucket('guid-new1'), mkBucket('guid-new2')];
    const res = resolveDeferredReorder({
      orderedIds: [optimisticId, 'guid-a'],
      optimisticId,
      buckets,
      knownRealIds: new Set(['guid-a']),
    });
    expect(res).toEqual({ status: 'abandon' });
  });
});

describe('resolveDeferredDelete (delete a still-creating bucket)', () => {
  const optimisticId = 'optimistic-1785237868194';

  it('waits while the create is still in flight (placeholder present)', () => {
    const buckets = [mkBucket('guid-a'), mkBucket(optimisticId)];
    expect(resolveDeferredDelete(buckets, optimisticId, new Set(['guid-a'])))
      .toEqual({ status: 'wait' });
  });

  it('deletes the real row once the create settles', () => {
    // Placeholder replaced by a brand-new 'guid-new' row after PSS create.
    const buckets = [mkBucket('guid-a'), mkBucket('guid-new')];
    expect(resolveDeferredDelete(buckets, optimisticId, new Set(['guid-a'])))
      .toEqual({ status: 'delete', realId: 'guid-new' });
  });

  it('no-ops when cancel won the race (placeholder gone, no new row)', () => {
    const buckets = [mkBucket('guid-a')];
    expect(resolveDeferredDelete(buckets, optimisticId, new Set(['guid-a'])))
      .toEqual({ status: 'noop' });
  });
});
