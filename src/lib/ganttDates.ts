/**
 * Small pure date helpers shared by the Gantt-style timeline views
 * (TaskTimelineView, TeamSchedulingGantt). Day-granular; local time.
 */

/** Midnight (local) of the given date, as a new Date. */
export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** `d` plus `n` days (n may be negative), as a new Date. */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Whole-day difference a - b (rounded). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
