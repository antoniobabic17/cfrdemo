import { describe, it, expect } from 'vitest';
import { computeDurationDays, formatDurationDays } from './taskDuration';

describe('computeDurationDays', () => {
  it('single weekday (same start/due) = 1 day', () => {
    expect(computeDurationDays('2026-07-06', '2026-07-06')).toBe(1); // Mon
  });

  it('Mon..Fri (one work week) = 5 days', () => {
    expect(computeDurationDays('2026-07-06', '2026-07-10')).toBe(5);
  });

  it('matches PROD TASK-10038: 07-22..07-31 = 8 weekdays', () => {
    expect(computeDurationDays('2026-07-22', '2026-07-31')).toBe(8);
  });

  it('Mon..Wed = 3 weekdays (recruit-testers full-day equivalent)', () => {
    expect(computeDurationDays('2026-07-20', '2026-07-22')).toBe(3);
  });

  it('Mon..next Mon spans a weekend = 6 weekdays', () => {
    expect(computeDurationDays('2026-07-06', '2026-07-13')).toBe(6);
  });

  it('weekend-only window has 0 weekdays (edge case; app date-pickers avoid it)', () => {
    expect(computeDurationDays('2026-07-11', '2026-07-12')).toBe(0);
  });

  it('ignores time-of-day (uses UTC-noon cursor)', () => {
    expect(computeDurationDays('2026-07-06T23:00:00Z', '2026-07-07T01:00:00Z')).toBe(2); // Mon+Tue
  });

  it('returns undefined for missing endpoints', () => {
    expect(computeDurationDays(undefined, '2026-07-06')).toBeUndefined();
    expect(computeDurationDays('2026-07-06', null)).toBeUndefined();
  });

  it('returns undefined for inverted window (due before start)', () => {
    expect(computeDurationDays('2026-07-10', '2026-07-06')).toBeUndefined();
  });

  it('returns undefined for invalid dates', () => {
    expect(computeDurationDays('not-a-date', '2026-07-06')).toBeUndefined();
  });
});

describe('formatDurationDays', () => {
  it('formats whole days', () => {
    expect(formatDurationDays(8)).toBe('8d');
    expect(formatDurationDays(1)).toBe('1d');
  });

  it('formats fractional days (PSS intra-day windows) without trailing zeros', () => {
    expect(formatDurationDays(3.75)).toBe('3.75d');
    expect(formatDurationDays(0.12)).toBe('0.12d');
  });

  it('returns undefined for null/undefined/non-finite', () => {
    expect(formatDurationDays(undefined)).toBeUndefined();
    expect(formatDurationDays(null)).toBeUndefined();
    expect(formatDurationDays(NaN)).toBeUndefined();
  });
});
