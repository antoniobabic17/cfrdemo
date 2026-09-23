/**
 * T052 — pace, over hand-counted fixtures, for the five cases the acceptance names.
 *
 * **"Today" is a parameter and every fixture states it.** A schedule calculation that read the
 * clock could not be tested for mid-cycle-behind without freezing time, and freezing time in a
 * suite that also renders React is how twelve tests timed out at once in T027. Every expected
 * number below is worked out in the comment beside it.
 *
 * **The rollup is asserted to be per-project-then-summed.** An org-wide aggregate would hit the
 * 50,000-record ceiling and return a silently truncated answer, which is worse than an error
 * because it looks like a number — so the arithmetic happens here, over rows, and the test adds
 * the same numbers up by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  cyclePace,
  projectPace,
  portfolioPace,
  worstState,
  isCaseComplete,
  PACE_STATE_LABELS,
  type PaceTestCase,
} from './uatPace';
import { UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';

/** `done` completed cases and `outstanding` not-yet-done ones. */
function cases(done: number, outstanding: number): PaceTestCase[] {
  return [
    ...Array.from({ length: done }, (_, i) => ({
      testCaseId: `done-${i}`, executionStatus: UAT_EXECUTION_STATUS.Completed,
    })),
    ...Array.from({ length: outstanding }, (_, i) => ({
      testCaseId: `todo-${i}`, executionStatus: UAT_EXECUTION_STATUS.NotStarted,
    })),
  ];
}

/** A ten-day cycle: 1 Sep to 10 Sep inclusive. */
const CYCLE = { cycleId: 'C1', plannedStart: '2026-09-01', plannedEnd: '2026-09-10' };

describe('the five cases T052 names', () => {
  it('1. not started — before the window, zero done is not "behind"', () => {
    const pace = cyclePace(CYCLE, cases(0, 10), '2026-08-28');
    expect(pace.state).toBe('not-started');
    expect(pace.expected).toBe(0);
    expect(pace.elapsedFraction).toBe(0);
  });

  it('2. mid-cycle AHEAD — day 5 of 10, 8 of 10 done against 5 expected', () => {
    // 5 days elapsed of 10 → expected 5. Done 8. Variance +3, which is above the tolerance.
    const pace = cyclePace(CYCLE, cases(8, 2), '2026-09-05');
    expect(pace.expected).toBe(5);
    expect(pace.completed).toBe(8);
    expect(pace.variance).toBe(3);
    expect(pace.state).toBe('ahead');
  });

  it('3. mid-cycle BEHIND — day 5 of 10, 1 of 10 done against 5 expected', () => {
    const pace = cyclePace(CYCLE, cases(1, 9), '2026-09-05');
    expect(pace.expected).toBe(5);
    expect(pace.variance).toBe(-4);
    expect(pace.state).toBe('behind');
  });

  it('4. overdue — past the planned end with work outstanding', () => {
    const pace = cyclePace(CYCLE, cases(7, 3), '2026-09-15');
    expect(pace.state).toBe('overdue');
    // Expected is the whole cycle by now, so the variance is what is still owed.
    expect(pace.expected).toBe(10);
    expect(pace.variance).toBe(-3);
  });

  it('5. complete — and complete beats overdue, even when it finished late', () => {
    // Calling a finished cycle "overdue" would tell a team it still owes work it has done.
    const pace = cyclePace(CYCLE, cases(10, 0), '2026-09-30');
    expect(pace.state).toBe('complete');
    expect(pace.variance).toBe(0);
  });
});

describe('the states that are not about being late', () => {
  it('reports no-dates rather than inventing a window', () => {
    const pace = cyclePace({ cycleId: 'C1', plannedStart: null, plannedEnd: null }, cases(2, 3), '2026-09-05');
    expect(pace.state).toBe('no-dates');
    expect(pace.expected).toBeNull();
    expect(pace.variance).toBeNull();
  });

  it('reports no-dates when the end is before the start', () => {
    const pace = cyclePace({ cycleId: 'C1', plannedStart: '2026-09-10', plannedEnd: '2026-09-01' }, cases(0, 5), '2026-09-05');
    expect(pace.state).toBe('no-dates');
  });

  it('tolerates one case either way, so a small cycle does not flip on every run', () => {
    // Day 5 of 10, expected 5. Six done is +1 and four is −1: both on track.
    expect(cyclePace(CYCLE, cases(6, 4), '2026-09-05').state).toBe('on-track');
    expect(cyclePace(CYCLE, cases(4, 6), '2026-09-05').state).toBe('on-track');
    expect(cyclePace(CYCLE, cases(5, 5), '2026-09-05').state).toBe('on-track');
  });

  it('counts a case Returned for Defect as NOT done', () => {
    // A failing case is outstanding work. Counting it would report a cycle complete while its
    // tests are failing — the exact class of claim this whole feature exists to stop.
    const withFailure: PaceTestCase[] = [
      { testCaseId: 'a', executionStatus: UAT_EXECUTION_STATUS.Completed },
      { testCaseId: 'b', executionStatus: UAT_EXECUTION_STATUS.ReturnedForDefect },
    ];
    expect(isCaseComplete(withFailure[1])).toBe(false);
    const pace = cyclePace(CYCLE, withFailure, '2026-09-10');
    expect(pace.completed).toBe(1);
    expect(pace.state).not.toBe('complete');
  });

  it('handles an empty cycle without claiming it is complete', () => {
    const pace = cyclePace(CYCLE, [], '2026-09-05');
    expect(pace.total).toBe(0);
    expect(pace.state).not.toBe('complete');
  });

  it('labels every state', () => {
    for (const label of Object.values(PACE_STATE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('the curve a chart draws', () => {
  it('has one point per planned day, inclusive of both ends', () => {
    const pace = cyclePace(CYCLE, cases(3, 7), '2026-09-05');
    expect(pace.curve).toHaveLength(10);
    expect(pace.curve[0].date).toBe('2026-09-01');
    expect(pace.curve[9].date).toBe('2026-09-10');
  });

  it('reaches the total ON the last planned day, not the day after', () => {
    const pace = cyclePace(CYCLE, cases(3, 7), '2026-09-05');
    expect(pace.curve[9].expected).toBe(10);
    expect(pace.curve[0].expected).toBe(1);
  });

  it('leaves future actuals NULL rather than drawing a flat line into the future', () => {
    // A flat actual line ahead of today reads as "no progress planned", a claim nobody made.
    const pace = cyclePace(CYCLE, cases(3, 7), '2026-09-05');
    expect(pace.curve[4].actual).toBe(3);      // 5 Sep, today
    expect(pace.curve[5].actual).toBeNull();   // 6 Sep, not yet
    expect(pace.curve.filter((p) => p.actual !== null)).toHaveLength(5);
  });

  it('handles a one-day cycle without dividing by zero', () => {
    const pace = cyclePace({ cycleId: 'C1', plannedStart: '2026-09-01', plannedEnd: '2026-09-01' }, cases(0, 4), '2026-09-01');
    expect(pace.curve).toHaveLength(1);
    expect(pace.curve[0].expected).toBe(4);
    expect(pace.expected).toBe(4);
  });
});

describe('the project and portfolio rollups', () => {
  const PROJECT_A = {
    projectId: 'p-1',
    cycles: [
      { cycle: CYCLE, cases: cases(8, 2) },                                              // ahead
      { cycle: { cycleId: 'C2', plannedStart: '2026-09-01', plannedEnd: '2026-09-10' }, cases: cases(1, 9) }, // behind
    ],
  };
  const PROJECT_B = {
    projectId: 'p-2',
    cycles: [{ cycle: CYCLE, cases: cases(4, 0) }],                                      // complete
  };
  const BYPASSED = {
    projectId: 'p-3',
    bypassed: true,
    cycles: [{ cycle: CYCLE, cases: cases(0, 50) }],                                     // would drown the rest
  };

  it('takes the WORST state among a project\'s cycles', () => {
    // A project with one cycle ahead and one behind is behind: the good news must not hide it.
    expect(projectPace(PROJECT_A, '2026-09-05').state).toBe('behind');
    expect(worstState(['ahead', 'behind', 'complete'])).toBe('behind');
    expect(worstState(['overdue', 'behind'])).toBe('overdue');
    expect(worstState(['complete', 'complete'])).toBe('complete');
  });

  it('sums a project\'s cycles by hand-checkable arithmetic', () => {
    // Cycle 1: 8 of 10, expected 5. Cycle 2: 1 of 10, expected 5. Totals 9 of 20, expected 10.
    const pace = projectPace(PROJECT_A, '2026-09-05');
    expect(pace.completed).toBe(9);
    expect(pace.total).toBe(20);
    expect(pace.expected).toBe(10);
    expect(pace.variance).toBe(-1);
  });

  it('rolls up per project and then sums, never as one query', () => {
    // p-1: 9 of 20, expected 10. p-2: 4 of 4, complete so expected 4. Totals 13 of 24, exp 14.
    const portfolio = portfolioPace([PROJECT_A, PROJECT_B], '2026-09-05');
    expect(portfolio.projects.map((p) => p.projectId)).toEqual(['p-1', 'p-2']);
    expect(portfolio.completed).toBe(13);
    expect(portfolio.total).toBe(24);
    expect(portfolio.expected).toBe(14);
    expect(portfolio.variance).toBe(-1);
  });

  it('EXCLUDES a bypassed project, and the exclusion visibly changes the answer', () => {
    const without = portfolioPace([PROJECT_A, PROJECT_B], '2026-09-05');
    const withIt = portfolioPace([PROJECT_A, PROJECT_B, BYPASSED], '2026-09-05');
    expect(withIt.total).toBe(without.total);                 // its 50 cases are not counted
    expect(withIt.excludedProjectIds).toEqual(['p-3']);
    expect(withIt.projects.map((p) => p.projectId)).not.toContain('p-3');
    // And the difference is real: counting it would have made the total 74.
    expect(without.total).toBe(24);
  });
});
