/**
 * Finish-to-Start (FS) scheduling cascade — the custom-source replacement for
 * PSS's server-side reschedule engine.
 *
 * See docs/pss-decoupling-c-design.md §"Scheduling cascade design". When a task's
 * dates move on the custom source, PSS is not in the loop to shift its dependent
 * tasks, so we recompute the shifts client-side and PATCH the successors directly.
 *
 * Deliberately scoped (design doc §"Out of scope"):
 *   - FS (linktype=0) dependencies ONLY. SS/FF/SF are ignored (manual coordination).
 *   - Same-project only (callers pass one project's tasks + deps).
 *   - Skips tasks flagged pmo_ismanuallyscheduled — a manual task's OWN dates are
 *     pinned, but the cascade STILL propagates PAST it to its successors (operator
 *     decision locked 2026-07-23, design doc §"Operator decisions").
 *   - Cycle-detected → abort with zero shifts (never write on a malformed graph).
 *   - No resource leveling, effort normalization, or intra-day time math.
 *
 * Pure + synchronous so it can be unit-tested exhaustively and run inside a
 * mutation before the write resolves. Feature-flagged by pmo.fs_cascade_enabled.
 */

/**
 * App-setting key that gates the cascade. Admin-writable (`pmo_admin`, see
 * settingKeyRoles.ts) and surfaced in Admin > Settings. Absent row = disabled,
 * which is the intended default until the DEV UAT rows T10-T13 are signed off.
 */
export const FS_CASCADE_SETTING_KEY = 'pmo.fs_cascade_enabled';

/** Minimal task shape the cascade needs. Dates are ISO strings (noon-UTC on the
 *  custom source) or a bare YYYY-MM-DD; both parse via the UTC accessors below. */
export interface CascadeTask {
  id: string;
  start?: string | null;
  end?: string | null;
  /** pmo_ismanuallyscheduled — when true the task's own dates are pinned. */
  isManual?: boolean;
}

/** Minimal dependency edge. Only linkType 0 (FS) participates in the cascade. */
export interface CascadeDep {
  predecessorId: string;
  successorId: string;
  linkType?: number;
}

/** A computed shift for one task. Dates are bare YYYY-MM-DD (Edm.Date friendly),
 *  so callers feed them straight into updateCustomTask (which runs toEdmDate). */
export interface TaskShift {
  taskId: string;
  newStart?: string;
  newEnd?: string;
}

export interface FsCascadeResult {
  /** Tasks to PATCH, in breadth-first (predecessor→successor) order. */
  shifts: TaskShift[];
  /** True when a dependency cycle was detected — caller must NOT write. */
  cycleDetected: boolean;
}

const FS = 0;

/** Extract the UTC calendar day of an ISO/YMD string as a YYYY-MM-DD, or null. */
function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const ymd = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** Add `days` (may be negative) calendar days to a YYYY-MM-DD, return YYYY-MM-DD.
 *  Uses a noon-UTC cursor so DST / local-midnight never causes an off-by-one. */
function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d, 12));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  const yy = cursor.getUTCFullYear();
  const mm = String(cursor.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cursor.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compute the FS cascade shifts when `movedTaskId` moved by `deltaDays` calendar
 * days. Every downstream FS successor shifts by the SAME delta; manual tasks are
 * omitted from the output (their dates stay pinned) but the delta still
 * propagates through them to their own successors.
 *
 * @param tasks       all tasks in the project (the moved task included)
 * @param deps        all dependency edges in the project
 * @param movedTaskId the task the user just re-dated
 * @param deltaDays   signed calendar-day delta applied to the moved task
 */
export function computeFsShifts(
  tasks: CascadeTask[],
  deps: CascadeDep[],
  movedTaskId: string,
  deltaDays: number,
): FsCascadeResult {
  if (deltaDays === 0) return { shifts: [], cycleDetected: false };

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // FS adjacency: predecessor → [successors].
  const successors = new Map<string, string[]>();
  for (const dep of deps) {
    if ((dep.linkType ?? FS) !== FS) continue;
    const list = successors.get(dep.predecessorId);
    if (list) list.push(dep.successorId);
    else successors.set(dep.predecessorId, [dep.successorId]);
  }

  const shifts: TaskShift[] = [];
  const shifted = new Set<string>([movedTaskId]); // moved task handled by the caller's own PATCH
  const onPath = new Set<string>(); // recursion stack for cycle detection

  // Iterative DFS with an explicit stack so a deep chain can't blow the call
  // stack; onPath tracks the active recursion path for back-edge detection.
  let cycleDetected = false;

  function visit(nodeId: string): boolean {
    if (cycleDetected) return false;
    onPath.add(nodeId);
    for (const succId of successors.get(nodeId) ?? []) {
      if (onPath.has(succId)) {
        cycleDetected = true;
        return false;
      }
      if (!shifted.has(succId)) {
        shifted.add(succId);
        const succ = taskById.get(succId);
        // Manual tasks: pin their own dates (no shift emitted) but keep
        // propagating the delta to their successors.
        if (succ && !succ.isManual) {
          const startYmd = toYmd(succ.start);
          const endYmd = toYmd(succ.end);
          if (startYmd || endYmd) {
            shifts.push({
              taskId: succId,
              ...(startYmd ? { newStart: addCalendarDays(startYmd, deltaDays) } : {}),
              ...(endYmd ? { newEnd: addCalendarDays(endYmd, deltaDays) } : {}),
            });
          }
        }
      }
      if (!visit(succId)) {
        if (cycleDetected) return false;
      }
    }
    onPath.delete(nodeId);
    return true;
  }

  visit(movedTaskId);

  if (cycleDetected) return { shifts: [], cycleDetected: true };
  return { shifts, cycleDetected: false };
}
