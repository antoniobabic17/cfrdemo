/**
 * Task duration — single source of truth, matching PSS/PROD semantics.
 *
 * VERIFIED against live PROD (msdyn_projecttask) 2026-07-29: PSS stores
 * `msdyn_duration` in DAYS, computed as working-hours(start->end over a Mon-Fri
 * 8-hour workday) / 8. For full-day windows (the only kind the app produces,
 * since its date pickers are date-only) this reduces exactly to the count of
 * weekdays inclusive between start and due:
 *
 *   check-the-date  07-22..07-31  -> 8 weekdays  -> duration 8   (PROD: 8.0) OK
 *   recruit-testers 07-20..07-22  -> 3 weekdays  -> duration 3   (full days)
 *   single weekday  05-01..05-01  -> 1 weekday   -> duration 1   (PROD: 1.0) OK
 *
 * (PROD's fractional durations like 3.75 / 0.12 come from intra-day
 * start/end TIMES, which the app's date-only inputs never produce, so a whole
 * weekday count is the faithful custom-path equivalent.)
 *
 * Stored in pmo_task.pmo_duration (Decimal days) so the overnight pmo_ -> msdyn
 * ETL and P4W stay 1:1 with PSS. UTC-noon cursor avoids DST/local-midnight
 * off-by-one.
 */

/**
 * Count Mon-Fri days inclusive between two date-ish inputs. Returns the PSS
 * duration in DAYS. undefined when either endpoint is missing/invalid or the
 * window is inverted (due before start). A single weekday = 1 day
 * (PSS `Math.max`-style floor via the inclusive count).
 */
export function computeDurationDays(
  startISO: string | undefined | null,
  dueISO: string | undefined | null,
): number | undefined {
  if (!startISO || !dueISO) return undefined;
  const sd = new Date(startISO);
  const ed = new Date(dueISO);
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return undefined;
  if (ed.getTime() < sd.getTime()) return undefined;

  let workDays = 0;
  const cursor = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate(), 12));
  const stop = new Date(Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth(), ed.getUTCDate(), 12));
  while (cursor.getTime() <= stop.getTime()) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) workDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return workDays; // days; matches PROD msdyn_duration for full-day windows
}

/**
 * Render a stored duration (days) for display, e.g. "8d" / "1d". Handles the
 * fractional values PSS may store on msdyn (from intra-day windows). Returns
 * undefined for null/undefined/non-finite so callers can omit the chip.
 */
export function formatDurationDays(days: number | undefined | null): string | undefined {
  if (days == null || !Number.isFinite(days)) return undefined;
  const rounded = Math.round(days * 100) / 100;
  return `${rounded}d`;
}
