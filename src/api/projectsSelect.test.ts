import { describe, it, expect } from 'vitest';
import { buildListSelect } from './projects.api';

describe('buildListSelect', () => {
  it('returns the base LIST_SELECT unchanged when no extras', () => {
    const base = buildListSelect();
    const withEmpty = buildListSelect([]);
    expect(withEmpty).toBe(base);
    expect(base.length).toBeGreaterThan(10);
  });

  it('appends unknown extra keys after the base, deduped', () => {
    const base = buildListSelect();
    const out = buildListSelect(['brand_new_col', 'msdyn_subject' /* already in base */, 'another_new']);
    // base preserved as prefix
    expect(out.slice(0, base.length)).toEqual(base);
    // new keys appended once
    expect(out.filter((k) => k === 'brand_new_col')).toHaveLength(1);
    expect(out.filter((k) => k === 'another_new')).toHaveLength(1);
    // duplicate of an existing base key is not re-added
    expect(out.filter((k) => k === 'msdyn_subject')).toHaveLength(1);
  });

  it('bounds the union to the cap', () => {
    const many = Array.from({ length: 200 }, (_, i) => `extra_${i}`);
    const out = buildListSelect(many);
    expect(out.length).toBeLessThanOrEqual(90);
  });

  it('ignores empty-string keys', () => {
    const base = buildListSelect();
    const out = buildListSelect(['', '  '.trim()]);
    expect(out).toEqual(base);
  });
});
