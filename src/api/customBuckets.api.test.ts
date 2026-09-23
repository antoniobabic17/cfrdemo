import { describe, expect, it } from 'vitest';
import { normalizeCustomBucket, buildCustomBucketCreatePayload } from './customBuckets.api';

describe('normalizeCustomBucket', () => {
  it('bridges same-Guid pmo_bucketid to msdyn_projectbucketid', () => {
    const out = normalizeCustomBucket({ pmo_bucketid: 'bkt-1', pmo_name: 'Design' });
    expect(out.msdyn_projectbucketid).toBe('bkt-1');
    expect(out.msdyn_name).toBe('Design');
  });

  it('populates BOTH msdyn_displayorder and pmo_bucketorder from pmo_orderinproject', () => {
    const out = normalizeCustomBucket({
      pmo_bucketid: 'x', pmo_orderinproject: 3.5,
    });
    expect(out.msdyn_displayorder).toBe(3.5);
    expect(out.pmo_bucketorder).toBe(3.5);
  });

  it('leaves order fields undefined when pmo_orderinproject missing', () => {
    const out = normalizeCustomBucket({ pmo_bucketid: 'x' });
    expect(out.msdyn_displayorder).toBeUndefined();
    expect(out.pmo_bucketorder).toBeUndefined();
  });

  it('defaults name to empty string when pmo_name null', () => {
    const out = normalizeCustomBucket({ pmo_bucketid: 'x', pmo_name: null });
    expect(out.msdyn_name).toBe('');
  });

  it('remaps _pmo_projectref_value to _msdyn_project_value', () => {
    const out = normalizeCustomBucket({ pmo_bucketid: 'x', _pmo_projectref_value: 'proj-g' });
    expect(out._msdyn_project_value).toBe('proj-g');
  });

  it('defaults statecode to 0 when missing', () => {
    const out = normalizeCustomBucket({ pmo_bucketid: 'x' });
    expect(out.statecode).toBe(0);
  });
});

describe('buildCustomBucketCreatePayload', () => {
  it('maps name + binds the project lookup via @odata.bind', () => {
    const p = buildCustomBucketCreatePayload('proj-1', 'Design');
    expect(p.pmo_name).toBe('Design');
    expect(p['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(proj-1)');
  });

  it('includes pmo_orderinproject when an order is provided', () => {
    const p = buildCustomBucketCreatePayload('proj-1', 'Design', 2000);
    expect(p.pmo_orderinproject).toBe(2000);
  });

  it('omits pmo_orderinproject when order is undefined', () => {
    const p = buildCustomBucketCreatePayload('proj-1', 'Design');
    expect('pmo_orderinproject' in p).toBe(false);
  });
});
