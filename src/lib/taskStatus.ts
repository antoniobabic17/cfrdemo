/**
 * Task status — derived, single source of truth for every task view.
 *
 * NO new Dataverse column. Status is a pure function of fields we
 * already read on every task load: statecode, msdyn_progress (via
 * getDisplayProgressPct which prefers effort/effortCompleted when
 * present), and msdyn_scheduledend / msdyn_finish.
 *
 * Views MUST call `deriveTaskStatus` here and look up STATUS_META /
 * STATUS_HEX — no color or label hardcoded elsewhere. If the palette
 * needs a tweak, this file is the ONE place to change.
 *
 * Statuses are intentionally limited to what we can derive without
 * storage. Blocked / On Hold / In Review / Cancelled would need a
 * user-set column (pmo_taskstatus OptionSet) and are deferred to a
 * separate Option B session.
 */
import type { ProjectTask } from '../models/projectTask.model';
import { getDisplayProgressPct } from '../models/projectTask.model';

export type TaskStatus =
  | 'not-started'
  | 'in-progress'
  | 'at-risk'
  | 'overdue'
  | 'done';

/** How many days out from "now" counts as At Risk. Tuneable in one place. */
export const AT_RISK_WINDOW_DAYS = 3;

/**
 * Compute the display status for a task.
 *
 * Order of precedence:
 *   1. statecode=1  -> done   (server explicitly closed the task)
 *   2. progress>=100 -> done  (hours or msdyn_progress says complete)
 *   3. past scheduledEnd, <100% -> overdue
 *   4. due within AT_RISK_WINDOW_DAYS, <100% -> at-risk
 *   5. progress==0 -> not-started
 *   6. otherwise    -> in-progress
 *
 * Note: we do NOT flip statecode when the checkbox marks Done — PSS
 * treats statecode on msdyn_projecttask as E_NOTEDITABLE. Done state
 * is driven purely by progress>=100, matching the existing isDone
 * checks scattered across every view before this helper existed.
 */
export function deriveTaskStatus(task: ProjectTask): TaskStatus {
  if (task.statecode === 1) return 'done';
  const pct = getDisplayProgressPct(task);
  if (pct >= 100) return 'done';
  const due = task.msdyn_scheduledend ?? task.msdyn_finish;
  if (due) {
    const dueMs = new Date(due).getTime();
    if (Number.isFinite(dueMs)) {
      const now = Date.now();
      if (dueMs < now) return 'overdue';
      const dDays = (dueMs - now) / 86_400_000;
      if (dDays <= AT_RISK_WINDOW_DAYS) return 'at-risk';
    }
  }
  if (pct === 0) return 'not-started';
  return 'in-progress';
}

export interface StatusMeta {
  label: string;
  /** Tailwind border color class. Combine with `border-2` on the tile
   *  root. Kept as a separate token so callers can pick the border
   *  thickness that fits their layout. */
  borderCls: string;
  /** Tailwind bg + text classes for the status pill. */
  pillCls: string;
  /** Optional tile-body background tint. Only present for Done today
   *  (the light-green fill the operator asked for). Absent means the
   *  view should not tint the tile background. */
  bgCls?: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  'not-started': {
    label: 'Not Started',
    borderCls: 'border-slate-300 dark:border-slate-600',
    pillCls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  'in-progress': {
    label: 'In Progress',
    borderCls: 'border-sky-400 dark:border-sky-500',
    pillCls: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  'at-risk': {
    label: 'At Risk',
    borderCls: 'border-amber-400 dark:border-amber-500',
    pillCls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  'overdue': {
    label: 'Overdue',
    borderCls: 'border-rose-400 dark:border-rose-500',
    pillCls: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  },
  'done': {
    label: 'Done',
    borderCls: 'border-emerald-400 dark:border-emerald-500',
    pillCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    bgCls: 'bg-emerald-50 dark:bg-emerald-950/30',
  },
};

/** Hex palette for chart libs that don't speak Tailwind class names.
 *  Keep in sync with the *border* colors above (which are the same
 *  visual family as the pills). */
export const STATUS_HEX: Record<TaskStatus, string> = {
  'not-started': '#cbd5e1',
  'in-progress': '#38bdf8',
  'at-risk':     '#fbbf24',
  'overdue':     '#fb7185',
  'done':        '#34d399',
};

/** Convenient ordered list for iterating (charts, filters, tests). */
export const STATUS_ORDER: readonly TaskStatus[] = [
  'not-started',
  'in-progress',
  'at-risk',
  'overdue',
  'done',
] as const;
