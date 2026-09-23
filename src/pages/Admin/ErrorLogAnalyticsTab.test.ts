import { describe, it, expect } from 'vitest';
import { bucketErrorsPerDay, topGroupedCount } from './ErrorLogAnalyticsTab';

describe('bucketErrorsPerDay', () => {
  const NOW = new Date('2026-07-15T12:00:00');

  it('emits N buckets even when all days have zero counts', () => {
    const out = bucketErrorsPerDay([], NOW, 7);
    expect(out).toHaveLength(7);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it('places same-day rows into the last bucket (local time)', () => {
    const out = bucketErrorsPerDay(
      ['2026-07-15T09:00:00', '2026-07-15T18:00:00'],
      NOW,
      7,
    );
    expect(out[out.length - 1].count).toBe(2);
    for (let i = 0; i < out.length - 1; i++) expect(out[i].count).toBe(0);
  });

  it('drops rows older than the window', () => {
    const out = bucketErrorsPerDay(
      ['2026-06-01T12:00:00', '2026-07-15T12:00:00'],
      NOW,
      7,
    );
    const total = out.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });

  it('ignores unparseable and undefined createdOn values', () => {
    const out = bucketErrorsPerDay([undefined, 'garbage', '2026-07-15T12:00:00'], NOW, 7);
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(1);
  });

  it('produces stable chronological order (oldest first)', () => {
    const out = bucketErrorsPerDay([], NOW, 3);
    // Last bucket must match today.
    expect(out[out.length - 1].day).toBe('2026-07-15');
    // First bucket is 2 days earlier.
    expect(out[0].day).toBe('2026-07-13');
  });
});

describe('topGroupedCount', () => {
  it('counts + sorts descending by frequency', () => {
    const out = topGroupedCount(['a', 'a', 'b', 'a', 'c', 'b'], 5);
    expect(out).toEqual([
      { name: 'a', value: 3 },
      { name: 'b', value: 2 },
      { name: 'c', value: 1 },
    ]);
  });

  it('rolls everything past topN into "Other"', () => {
    const out = topGroupedCount(['a', 'a', 'b', 'b', 'c', 'd', 'e'], 2);
    expect(out).toEqual([
      { name: 'a', value: 2 },
      { name: 'b', value: 2 },
      { name: 'Other', value: 3 },
    ]);
  });

  it('substitutes "(unknown)" for empty / undefined values', () => {
    const out = topGroupedCount([undefined, '', '   ', 'a'], 5);
    expect(out).toEqual([
      { name: '(unknown)', value: 3 },
      { name: 'a', value: 1 },
    ]);
  });

  it('handles an empty input as an empty result', () => {
    expect(topGroupedCount([], 5)).toEqual([]);
  });

  it('supports a custom other-label', () => {
    const out = topGroupedCount(['a', 'b', 'c'], 1, 'Rest');
    expect(out).toEqual([
      { name: 'a', value: 1 },
      { name: 'Rest', value: 2 },
    ]);
  });

  it('does not emit the Other bucket when no values are past topN', () => {
    const out = topGroupedCount(['a', 'b'], 5);
    expect(out).toEqual([
      { name: 'a', value: 1 },
      { name: 'b', value: 1 },
    ]);
  });
});
