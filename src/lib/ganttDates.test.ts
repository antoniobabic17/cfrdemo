import { describe, expect, it } from 'vitest';
import { startOfDay, addDays, diffDays } from './ganttDates';

describe('ganttDates', () => {
  it('startOfDay zeroes the time', () => {
    const d = startOfDay(new Date('2026-09-15T13:45:30'));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('addDays moves forward and backward', () => {
    const base = startOfDay(new Date('2026-09-15T00:00:00'));
    expect(addDays(base, 5).getDate()).toBe(20);
    expect(addDays(base, -5).getDate()).toBe(10);
  });

  it('diffDays returns whole-day difference', () => {
    const a = startOfDay(new Date('2026-09-20T00:00:00'));
    const b = startOfDay(new Date('2026-09-15T00:00:00'));
    expect(diffDays(a, b)).toBe(5);
    expect(diffDays(b, a)).toBe(-5);
    expect(diffDays(a, a)).toBe(0);
  });
});
