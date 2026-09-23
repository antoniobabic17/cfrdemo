/**
 * Date-only column helpers.
 *
 * Dataverse stores calendar-day columns with a "behavior" setting:
 *   - DateOnly (behavior=1): stores the literal calendar date, no TZ shift.
 *   - User Local (behavior=0, the default for most stock date columns):
 *     converts to/from UTC based on the caller's timezone.
 *
 * Naively `new Date(iso).toLocaleDateString()` mostly works for display but
 * `.split('T')[0]` on the raw ISO does NOT — that grabs the UTC calendar day,
 * which is off by one for any user east of UTC (or west, depending on the
 * time-of-day component the server chose to send back).
 *
 * These helpers pin the whole app to one convention:
 *   - When the user picks 2026-07-05, we send a value that round-trips back
 *     to 2026-07-05 in the user's local calendar, forever, regardless of the
 *     column's behavior setting or the user's timezone.
 *   - When reading a date-only column, we render the LOCAL calendar day
 *     (via Date.getFullYear/getMonth/getDate — never `.split('T')[0]`).
 *
 * The trick on the write side is sending noon UTC (`T12:00:00Z`). No timezone
 * on Earth crosses a day boundary at noon UTC, so both `DateOnly` and
 * `User Local` columns store the intended calendar day and every reader
 * gets the same day back.
 */

/**
 * Format a Dataverse date-only ISO string as MM/DD/YYYY in the user's LOCAL
 * timezone. Returns '—' for undefined/empty input.
 *
 * SAFETY: use for values that came back from Dataverse (noon-UTC via
 * toDataverseDateOnly on the write side). For raw YYYY-MM-DD values still
 * in in-memory form state (wizard drafts before Dataverse round-trip),
 * use fmtLocalYmd -- new Date() on a bare YYYY-MM-DD parses as midnight
 * UTC, which shifts a day back in every timezone west of UTC.
 *
 * Defensive: if a caller hands us a bare YYYY-MM-DD, we route through
 * fmtLocalYmd anyway so this is a safe drop-in.
 */
export function fmtDateOnly(v?: string | null): string {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtLocalYmd(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  // toLocaleDateString respects the browser's locale + timezone. For a
  // Dataverse value stored as noon-UTC, every timezone on Earth resolves to
  // the same local calendar day.
  return d.toLocaleDateString();
}

/**
 * Format a raw YYYY-MM-DD string as MM/DD/YYYY with NO timezone math.
 * Handles values that came straight from an <input type="date"> (or the
 * first 10 chars of a full ISO) without shifting the calendar day.
 *
 * new Date('2026-07-17').toLocaleDateString() in a UTC-4 browser returns
 * '07/16/2026' because JS parses the bare ISO as midnight UTC. This helper
 * skips the Date object entirely and formats the calendar day directly.
 */
export function fmtLocalYmd(v?: string | null): string {
  if (!v) return '—';
  const ymd = v.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '—';
  const [, yyyy, mm, dd] = m;
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Convert a Dataverse date-only ISO string to a `YYYY-MM-DD` value suitable
 * for `<input type="date">`. Uses the LOCAL calendar day so what the user
 * originally picked is what they see in the input field.
 *
 * Returns '' for undefined/empty input.
 */
export function dateInputValue(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert a `YYYY-MM-DD` local date string (as produced by an
 * `<input type="date">`) into the ISO string to PATCH to Dataverse.
 *
 * Sends noon UTC on that day so both DateOnly and User-Local date-only
 * columns round-trip cleanly. Callers should feed this into any Dataverse
 * PATCH payload where the target column is a date-only column.
 *
 * Returns undefined for empty input so callers can pass it directly into a
 * payload object without extra guards.
 */
export function toDataverseDateOnly(localYmd?: string | null): string | undefined {
  if (!localYmd) return undefined;
  // Trim any accidental time component; the input is expected to be YYYY-MM-DD.
  const ymd = localYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  return `${ymd}T12:00:00Z`;
}

/**
 * Today's date in the user's local timezone as YYYY-MM-DD. Suitable for
 * seeding `<input type="date">` defaults. For a Dataverse-bound payload,
 * pipe through toDataverseDateOnly.
 */
export function toEdmDate(value?: string | null): string | undefined {
  // True Edm.Date (DateOnly-behavior) columns REJECT any T..Z suffix
  // ("Cannot convert the literal '...T12:00:00Z' to the expected type
  // 'Edm.Date'"). Send the BARE YYYY-MM-DD. Use for pmo_task.pmo_startdate /
  // pmo_duedate (DateOnly, per scripts/create-pmo-task-tables.py). Accepts a
  // bare date or a full ISO (first 10 chars taken).
  if (!value) return undefined;
  const ymd = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : undefined;
}

export function edmDateToNoonUtc(value?: string | null): string | undefined {
  // Expand a bare YYYY-MM-DD (as stored in an Edm.Date column) to noon-UTC ISO
  // so the app's `new Date(iso).toLocaleDateString()` renderers show the picked
  // calendar day, not the day before (bare date parses as midnight UTC -> off
  // by one west of UTC: the 8/4 -> 8/3 bug). No-op if a time is already present.
  if (!value) return undefined;
  const ymd = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return value ?? undefined;
  return `${ymd}T12:00:00Z`;
}

export function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
