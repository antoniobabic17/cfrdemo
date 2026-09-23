/**
 * Pace — is this cycle on schedule, and by how much?
 *
 * **Computed from rows and a date, like coverage, and for the same reason.** Two-hop navigation
 * filters and `countdistinct` return wrong answers with an HTTP 200 on this platform, so there is
 * no server-side pace query to trust; the fixture in the test is hand-counted and the arithmetic
 * lives here where a test can read it.
 *
 * **"Today" is a parameter, never `new Date()` inside the function.** A schedule calculation that
 * reads the clock itself cannot be tested for the mid-cycle-behind case without freezing time,
 * and freezing time in a suite that also renders React is how twelve tests time out at once
 * (finding: T027 hit exactly that). The caller passes the day.
 *
 * **The expected curve is linear across the planned window, by working DAY count.** Not by hour:
 * a cycle is planned in days, a tester works in days, and an hourly curve would report a team
 * "behind" at 09:00 on day one. Linear is a deliberate simplification and it is stated so nobody
 * later reads a burndown shape into it.
 */
import { UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';

export type PaceState =
  | 'no-dates'        // the cycle has no planned window; there is nothing to be ahead or behind of
  | 'not-started'     // today is before the planned start
  | 'ahead'
  | 'on-track'
  | 'behind'
  | 'overdue'         // past the planned end with work outstanding
  | 'complete';       // every case done, whenever that happened

export const PACE_STATE_LABELS: Readonly<Record<PaceState, string>> = {
  'no-dates': 'No planned dates',
  'not-started': 'Not started',
  ahead: 'Ahead',
  'on-track': 'On track',
  behind: 'Behind',
  overdue: 'Overdue',
  complete: 'Complete',
};

/** A test case as pace needs it: done, or not yet. */
export interface PaceTestCase {
  testCaseId: string;
  executionStatus: number | null;
}

export interface PaceCycle {
  cycleId: string;
  name?: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

export interface CyclePace {
  cycleId: string;
  state: PaceState;
  /** Cases counted as done. */
  completed: number;
  total: number;
  /** How many should be done by `today` if the cycle ran evenly. Null without dates. */
  expected: number | null;
  /** completed − expected. Positive is ahead. Null without dates. */
  variance: number | null;
  /** 0–1 through the planned window, clamped. Null without dates. */
  elapsedFraction: number | null;
  /** One point per planned day: what should be done, and what was. */
  curve: PacePoint[];
}

export interface PacePoint {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  expected: number;
  /** Null for a future day — a chart must not draw actuals it cannot know. */
  actual: number | null;
}

const DAY_MS = 86_400_000;

/** A date-only UTC value from an ISO string, or null if it is unusable. */
function dayOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / DAY_MS) * DAY_MS;
}

const isoOf = (day: number) => new Date(day).toISOString().slice(0, 10);

/** True when this case counts as finished. Returned for Defect is NOT done. */
export function isCaseComplete(testCase: PaceTestCase): boolean {
  return testCase.executionStatus === UAT_EXECUTION_STATUS.Completed;
}

/**
 * One cycle's pace as of `today`.
 *
 * The state precedence matters and is not arbitrary:
 *
 *  1. **complete** first. A cycle that finished everything is complete even if it finished late —
 *     calling it "overdue" would tell a team it still owes work it has already done.
 *  2. **no-dates** next: without a planned window there is no schedule to be measured against,
 *     and inventing one (from `createdon`, say) would produce a number that looks real.
 *  3. **not-started** before the window opens. Zero of ten done on day −1 is not "behind".
 *  4. **overdue** past the window with work outstanding.
 *  5. Inside the window: ahead / on-track / behind, by comparing done with expected. The
 *     tolerance is ONE case, because a cycle of seven cases would otherwise flip between ahead
 *     and behind every time a single test was run.
 */
export function cyclePace(
  cycle: PaceCycle,
  cases: readonly PaceTestCase[],
  today: string,
): CyclePace {
  const total = cases.length;
  const completed = cases.filter(isCaseComplete).length;
  const start = dayOf(cycle.plannedStart);
  const end = dayOf(cycle.plannedEnd);
  const now = dayOf(today);

  const base = { cycleId: cycle.cycleId, completed, total };

  if (total > 0 && completed === total) {
    return { ...base, state: 'complete', expected: total, variance: 0, elapsedFraction: 1, curve: [] };
  }
  if (start === null || end === null || now === null || end < start) {
    return { ...base, state: 'no-dates', expected: null, variance: null, elapsedFraction: null, curve: [] };
  }

  // Inclusive day count: a cycle planned for one day has one day in it, not zero.
  const days = Math.round((end - start) / DAY_MS) + 1;
  const curve: PacePoint[] = [];
  for (let index = 0; index < days; index++) {
    const day = start + index * DAY_MS;
    // Expected rises evenly and reaches the total ON the last planned day, not the day after.
    const expectedForDay = days === 1 ? total : Math.round((total * (index + 1)) / days);
    curve.push({
      date: isoOf(day),
      expected: expectedForDay,
      // Actuals are only knowable up to today. A chart drawing a flat line into the future
      // reads as "no progress planned", which is a claim nobody made.
      actual: day <= now ? completed : null,
    });
  }

  if (now < start) {
    return { ...base, state: 'not-started', expected: 0, variance: completed, elapsedFraction: 0, curve };
  }

  const elapsedDays = Math.min(days, Math.round((now - start) / DAY_MS) + 1);
  const elapsedFraction = Math.min(1, elapsedDays / days);
  const expected = Math.round(total * elapsedFraction);
  const variance = completed - expected;

  if (now > end) {
    return { ...base, state: 'overdue', expected: total, variance: completed - total, elapsedFraction: 1, curve };
  }

  // One case of tolerance: a seven-case cycle must not flip state on every single test run.
  const state: PaceState = variance > 1 ? 'ahead' : variance < -1 ? 'behind' : 'on-track';
  return { ...base, state, expected, variance, elapsedFraction, curve };
}

export interface ProjectPaceInput {
  projectId: string;
  /** True when UAT is bypassed for this project — excluded from the rollup. */
  bypassed?: boolean | null;
  cycles: readonly { cycle: PaceCycle; cases: readonly PaceTestCase[] }[];
}

export interface ProjectPace {
  projectId: string;
  completed: number;
  total: number;
  expected: number;
  variance: number;
  /** The worst state among its cycles — what a portfolio row should show. */
  state: PaceState;
}

/** Worst first, so a rollup can take the first match rather than ranking by hand twice. */
const STATE_SEVERITY: readonly PaceState[] = [
  'overdue', 'behind', 'on-track', 'ahead', 'not-started', 'no-dates', 'complete',
];

export function worstState(states: readonly PaceState[]): PaceState {
  for (const candidate of STATE_SEVERITY) {
    if (states.includes(candidate)) return candidate;
  }
  return 'no-dates';
}

/** One project's pace across its cycles. */
export function projectPace(input: ProjectPaceInput, today: string): ProjectPace {
  const paces = input.cycles.map(({ cycle, cases }) => cyclePace(cycle, cases, today));
  const completed = paces.reduce((sum, p) => sum + p.completed, 0);
  const total = paces.reduce((sum, p) => sum + p.total, 0);
  const expected = paces.reduce((sum, p) => sum + (p.expected ?? 0), 0);
  return {
    projectId: input.projectId,
    completed,
    total,
    expected,
    variance: completed - expected,
    state: worstState(paces.map((p) => p.state)),
  };
}

export interface PortfolioPace {
  projects: ProjectPace[];
  completed: number;
  total: number;
  expected: number;
  variance: number;
  excludedProjectIds: string[];
}

/**
 * The portfolio rollup — **per project, then summed**. Never one org-wide query.
 *
 * The org-wide aggregate would hit the 50,000-record ceiling and return a silently truncated
 * answer, which is worse than an error because it looks like a number. So this takes rows the
 * caller read per project and adds them up here, and bypassed projects are excluded (T046).
 */
export function portfolioPace(
  projects: readonly ProjectPaceInput[],
  today: string,
): PortfolioPace {
  const counted = projects.filter((project) => project.bypassed !== true);
  const paces = counted.map((project) => projectPace(project, today));
  const completed = paces.reduce((sum, p) => sum + p.completed, 0);
  const total = paces.reduce((sum, p) => sum + p.total, 0);
  const expected = paces.reduce((sum, p) => sum + p.expected, 0);
  return {
    projects: paces,
    completed,
    total,
    expected,
    variance: completed - expected,
    excludedProjectIds: projects.filter((p) => p.bypassed === true).map((p) => p.projectId),
  };
}
