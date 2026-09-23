/**
 * T024's acceptance: the whole truth table, including the two cells the legacy system
 * got wrong.
 *
 * WHY THERE ARE SOURCE-TEXT TESTS IN HERE. `pmo_uatoutcome` and `pmo_uatexecutionstatus`
 * share integers in this environment, and since the status set gained its fifth member on
 * 2026-08-31 the overlap is TOTAL: five members each, same base, so no integer identifies which
 * vocabulary it came from and no runtime guard can either. The test below asserts that from the
 * constants rather than restating the numbers, because a number written twice can go stale. So writing an outcome where a status
 * belongs is invisible to every value assertion AND to every label assertion, since the
 * label maps are keyed by the same integer. The only guard that can fail is one that reads
 * how the crossing is spelled. Measured 2026-08-31: planting `UAT_OUTCOME.Blocked` as the
 * map's Pass value — identical to the correct `UAT_EXECUTION_STATUS.Completed` — leaves 45
 * of these 46 tests green and fails only the source guard. The inverse plant, a status
 * constant inside OUTCOME_PRECEDENCE, does the same to the other source guard.
 *
 * The outcome-precedence cells for `Blocked` and `Not Applicable` WERE an assumption
 * (progress.md finding 45) and are now owner decisions taken on 2026-08-31: a blocked case reads
 * **Blocked** -- its own status member, added for this -- and Not Applicable counts toward
 * completion. Those rows are prefixed OWNER so the next reader can tell a decision from a
 * default, and each is still one test, so a change of mind shows up as a diff on exactly the
 * rows that moved.
 */
import { describe, expect, it } from 'vitest';
import {
  UAT_EXECUTION_STATUS,
  UAT_EXECUTION_STATUS_LABELS,
  UAT_OUTCOME,
  UAT_OUTCOME_LABELS,
} from '../../../lib/uatOptionSets';
import {
  OUTCOME_PRECEDENCE,
  RUN_RESULT_TO_STATUS,
  deriveCaseStatus,
  deriveCaseStatusFromRuns,
  deriveRunResult,
  deriveRunSave,
  deriveRunStatus,
  isExecutionStatus,
  isOutcome,
  selectCurrentRun,
  type CaseStatusRun,
  type RunAnswerOutcome,
} from './uatStatus';

/** The module's own text, for the guards that no value assertion can make. */
const uatStatusSource = Object.values(
  import.meta.glob('./uatStatus.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];

/** Answer rows from a list of outcomes; null means the question is unanswered. */
const answers = (...outcomes: (number | null)[]): RunAnswerOutcome[] =>
  outcomes.map((pmo_outcome) => ({ pmo_outcome }));

const run = (over: Partial<CaseStatusRun> = {}): CaseStatusRun => ({
  pmo_iscurrent: true,
  pmo_runnumber: 1,
  pmo_status: UAT_EXECUTION_STATUS.Completed,
  ...over,
});

// ── The two vocabularies stay apart ─────────────────────────────────────────

describe('the two vocabularies', () => {
  it('gives the status set no Fail member at all — this is what makes FR-022 structural', () => {
    // FIVE members since 2026-08-31. The owner rejected both "In Process" and "Returned for
    // Defect" for a blocked case -- "It is blocked and should show blocked" -- so Blocked became
    // a real status rather than a label over a stored In Process. FR-021 was amended with it.
    expect(Object.keys(UAT_EXECUTION_STATUS)).toEqual([
      'NotStarted', 'InProcess', 'Completed', 'ReturnedForDefect', 'Blocked',
    ]);
    expect(Object.values(UAT_EXECUTION_STATUS_LABELS)).toEqual([
      'Not Started', 'In Process', 'Completed', 'Returned for Defect', 'Blocked',
    ]);
    // The load-bearing ABSENCE, unchanged and still the whole point: adding Blocked separates a
    // state that was being folded into In Process, which is the opposite of the legacy collapse
    // of every non-Pass value into "FAIL".
    expect(Object.values(UAT_EXECUTION_STATUS_LABELS)).not.toContain('Fail');
  });

  it('now overlaps the outcome set COMPLETELY, which is why the source guards exist', () => {
    // Both sets have five members from the same base, so the overlap is total: there is no
    // longer any integer that identifies which vocabulary a value came from. Measured, not
    // preferred -- and it got worse when the fifth status member was added, which is exactly
    // when a source guard stops being belt-and-braces and becomes the only guard.
    expect(Object.values(UAT_OUTCOME).sort())
      .toEqual(Object.values(UAT_EXECUTION_STATUS).sort());

    // The pairs, named, because the words swap between the sets and that is the trap.
    expect(UAT_OUTCOME.Pass).toBe(UAT_EXECUTION_STATUS.NotStarted);
    expect(UAT_OUTCOME.Fail).toBe(UAT_EXECUTION_STATUS.InProcess);
    expect(UAT_OUTCOME.Blocked).toBe(UAT_EXECUTION_STATUS.Completed);
    expect(UAT_OUTCOME.NotApplicable).toBe(UAT_EXECUTION_STATUS.ReturnedForDefect);
    // The nastiest: "In Process" the outcome and "Blocked" the status are the same integer,
    // and BOTH words exist in both sets meaning different things at different numbers.
    expect(UAT_OUTCOME.InProcess).toBe(UAT_EXECUTION_STATUS.Blocked);

    // And they mean different things, which is the danger.
    expect(UAT_OUTCOME_LABELS[UAT_OUTCOME.Fail]).toBe('Fail');
    expect(UAT_EXECUTION_STATUS_LABELS[UAT_EXECUTION_STATUS.InProcess]).toBe('In Process');
    expect(UAT_OUTCOME_LABELS[UAT_OUTCOME.InProcess]).toBe('In Process');
    expect(UAT_EXECUTION_STATUS_LABELS[UAT_EXECUTION_STATUS.Blocked]).toBe('Blocked');
  });

  it('covers every outcome exactly once in OUTCOME_PRECEDENCE', () => {
    // Makes deriveRunResult's fall-through unreachable, which is why it may return null.
    expect([...OUTCOME_PRECEDENCE].sort()).toEqual(Object.values(UAT_OUTCOME).sort());
    expect(new Set(OUTCOME_PRECEDENCE).size).toBe(OUTCOME_PRECEDENCE.length);
  });

  it('maps every outcome to a real status member in RUN_RESULT_TO_STATUS', () => {
    const keys = Object.keys(RUN_RESULT_TO_STATUS).map(Number).sort();
    expect(keys).toEqual(Object.values(UAT_OUTCOME).sort());
    for (const [outcome, status] of Object.entries(RUN_RESULT_TO_STATUS)) {
      expect(isExecutionStatus(status), `${outcome} maps outside the status set`).toBe(true);
    }
  });
});

describe('the crossing between the sets is spelled correctly', () => {
  const mapSource = (() => {
    const from = uatStatusSource.indexOf('export const RUN_RESULT_TO_STATUS');
    const body = uatStatusSource.slice(from);
    return body.slice(0, body.indexOf('};') + 2);
  })();

  it('loaded the module source', () => {
    expect(uatStatusSource, 'uatStatus.ts was not loaded as raw text').toBeTruthy();
    expect(mapSource).toContain('RUN_RESULT_TO_STATUS');
  });

  it('writes UAT_EXECUTION_STATUS on every value and UAT_OUTCOME only in key position', () => {
    const rows = mapSource.split('\n').filter((line) => line.includes(']:'));
    expect(rows, 'expected one row per outcome').toHaveLength(Object.keys(UAT_OUTCOME).length);
    for (const row of rows) {
      const value = row.slice(row.indexOf(']:') + 2);
      expect(value, `status value must come from UAT_EXECUTION_STATUS: ${row.trim()}`)
        .toContain('UAT_EXECUTION_STATUS.');
      expect(value, `an outcome integer is a valid status integer and means something else: ${row.trim()}`)
        .not.toContain('UAT_OUTCOME.');
    }
  });

  it('writes UAT_OUTCOME on every OUTCOME_PRECEDENCE entry — the inverse mistake', () => {
    const from = uatStatusSource.indexOf('export const OUTCOME_PRECEDENCE');
    const body = uatStatusSource.slice(from);
    const listSource = body.slice(0, body.indexOf('] as const;') + 1);
    const rows = listSource.split('\n').filter((line) => line.trim().startsWith('UAT_'));
    expect(rows).toHaveLength(Object.keys(UAT_OUTCOME).length);
    for (const row of rows) {
      expect(row, `precedence entries are outcomes, not statuses: ${row.trim()}`)
        .toContain('UAT_OUTCOME.');
    }
  });
});

// ── The truth table ─────────────────────────────────────────────────────────

interface TableRow {
  name: string;
  answers: RunAnswerOutcome[];
  questionCount?: number;
  result: number | null;
  status: number;
}

const TRUTH_TABLE: TableRow[] = [
  // Nothing recorded. The not-yet-run pair from data-model.md §7 note 2.
  {
    name: 'no answers and no expected count reads Not Started with a null result',
    answers: [], result: null, status: UAT_EXECUTION_STATUS.NotStarted,
  },
  {
    name: 'no answers but 13 questions expected reads In Process, not Not Started',
    answers: [], questionCount: 13,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },

  // Complete and clean.
  {
    name: 'every question answered Pass reads Pass / Completed',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Pass, UAT_OUTCOME.Pass), questionCount: 3,
    result: UAT_OUTCOME.Pass, status: UAT_EXECUTION_STATUS.Completed,
  },

  // Fail dominates everything, answered or not. T024's stated cell.
  {
    name: 'one Fail among passes reads Fail / Returned for Defect',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Fail), questionCount: 2,
    result: UAT_OUTCOME.Fail, status: UAT_EXECUTION_STATUS.ReturnedForDefect,
  },
  {
    name: 'a Fail found halfway through, with rows still missing, is still a Fail',
    answers: answers(UAT_OUTCOME.Fail), questionCount: 13,
    result: UAT_OUTCOME.Fail, status: UAT_EXECUTION_STATUS.ReturnedForDefect,
  },
  {
    name: 'a Fail beside an explicitly unanswered question is still a Fail',
    answers: answers(UAT_OUTCOME.Fail, null), questionCount: 2,
    result: UAT_OUTCOME.Fail, status: UAT_EXECUTION_STATUS.ReturnedForDefect,
  },
  {
    name: 'every outcome present at once still reads Fail',
    answers: answers(
      UAT_OUTCOME.Pass, UAT_OUTCOME.Blocked, UAT_OUTCOME.NotApplicable,
      UAT_OUTCOME.InProcess, UAT_OUTCOME.Fail,
    ), questionCount: 5,
    result: UAT_OUTCOME.Fail, status: UAT_EXECUTION_STATUS.ReturnedForDefect,
  },

  // Incomplete: an unanswered question holds the run open.
  {
    name: 'a null outcome beside a pass reads In Process',
    answers: answers(UAT_OUTCOME.Pass, null), questionCount: 2,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'a missing answer row — 2 saved of 3 questions — reads In Process, never Completed',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Pass), questionCount: 3,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'all questions present but none answered reads In Process',
    answers: answers(null, null, null), questionCount: 3,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'an explicit In Process answer reads In Process',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.InProcess), questionCount: 2,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'more answer rows than expected questions does not invent a missing row',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Pass, UAT_OUTCOME.Pass), questionCount: 2,
    result: UAT_OUTCOME.Pass, status: UAT_EXECUTION_STATUS.Completed,
  },

  // The two assumed cells. Finding 45: nothing in the artifacts fixes these.
  {
    name: 'OWNER — one Blocked among passes reads Blocked, and its case reads Blocked too',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Blocked), questionCount: 2,
    result: UAT_OUTCOME.Blocked, status: UAT_EXECUTION_STATUS.Blocked,
  },
  {
    name: 'OWNER — Blocked outranks an explicit In Process',
    answers: answers(UAT_OUTCOME.Blocked, UAT_OUTCOME.InProcess), questionCount: 2,
    result: UAT_OUTCOME.Blocked, status: UAT_EXECUTION_STATUS.Blocked,
  },
  {
    name: 'Blocked does NOT outrank an unanswered question: the run is still open',
    answers: answers(UAT_OUTCOME.Blocked, null), questionCount: 2,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'OWNER — Pass plus Not Applicable reads Not Applicable / Completed',
    answers: answers(UAT_OUTCOME.Pass, UAT_OUTCOME.NotApplicable), questionCount: 2,
    result: UAT_OUTCOME.NotApplicable, status: UAT_EXECUTION_STATUS.Completed,
  },
  {
    name: 'OWNER — a run where every question was Not Applicable is Completed, not open forever',
    answers: answers(UAT_OUTCOME.NotApplicable, UAT_OUTCOME.NotApplicable), questionCount: 2,
    result: UAT_OUTCOME.NotApplicable, status: UAT_EXECUTION_STATUS.Completed,
  },
  {
    name: 'In Process outranks Not Applicable',
    answers: answers(UAT_OUTCOME.NotApplicable, UAT_OUTCOME.InProcess), questionCount: 2,
    result: UAT_OUTCOME.InProcess, status: UAT_EXECUTION_STATUS.InProcess,
  },
  {
    name: 'Blocked outranks Not Applicable',
    answers: answers(UAT_OUTCOME.Blocked, UAT_OUTCOME.NotApplicable), questionCount: 2,
    result: UAT_OUTCOME.Blocked, status: UAT_EXECUTION_STATUS.Blocked,
  },
];

describe('deriveRunResult / deriveRunStatus — the whole truth table', () => {
  for (const row of TRUTH_TABLE) {
    it(row.name, () => {
      const result = deriveRunResult(row.answers, { questionCount: row.questionCount });
      expect(result, 'pmo_result').toBe(row.result);
      expect(deriveRunStatus(result), 'pmo_status').toBe(row.status);
    });
  }

  it('derives both columns from one call, so they cannot disagree', () => {
    for (const row of TRUTH_TABLE) {
      expect(deriveRunSave(row.answers, { questionCount: row.questionCount }))
        .toEqual({ pmo_result: row.result, pmo_status: row.status });
    }
  });

  it('never derives a status outside the four members', () => {
    for (const row of TRUTH_TABLE) {
      expect(isExecutionStatus(deriveRunSave(row.answers, { questionCount: row.questionCount }).pmo_status))
        .toBe(true);
    }
  });

  it('reads a run as In Process rather than Completed when questionCount is omitted but rows are unanswered', () => {
    // The guard that survives a caller who does not know the question count.
    expect(deriveRunResult(answers(UAT_OUTCOME.Pass, null))).toBe(UAT_OUTCOME.InProcess);
  });

  it('ignores an outcome integer that is not a member of the set', () => {
    // A stray value from a model-driven edit counts as unanswered, not as a new outcome.
    expect(deriveRunResult(answers(UAT_OUTCOME.Pass, 999_999), { questionCount: 2 }))
      .toBe(UAT_OUTCOME.InProcess);
  });
});

// ── FR-022 and scenario 2: the legacy defect ────────────────────────────────

describe('FR-022 — a case with one passing and one in-process run', () => {
  const passingRun: CaseStatusRun = {
    pmo_iscurrent: false, pmo_runnumber: 1,
    pmo_status: deriveRunStatus(deriveRunResult(answers(UAT_OUTCOME.Pass), { questionCount: 1 })),
  };
  const inProcessRun: CaseStatusRun = {
    pmo_iscurrent: true, pmo_runnumber: 2,
    pmo_status: deriveRunStatus(deriveRunResult(answers(UAT_OUTCOME.Pass, null), { questionCount: 2 })),
  };

  it('reads In Process', () => {
    const status = deriveCaseStatusFromRuns([passingRun, inProcessRun]);
    expect(UAT_EXECUTION_STATUS_LABELS[status]).toBe('In Process');
    expect(status).toBe(UAT_EXECUTION_STATUS.InProcess);
  });

  it('does not read Completed just because a run passed', () => {
    // The mirror of the legacy defect: the old chain collapsed every non-Pass to FAIL;
    // aggregating across runs the other way would collapse an open case to Completed.
    expect(deriveCaseStatusFromRuns([passingRun, inProcessRun]))
      .not.toBe(UAT_EXECUTION_STATUS.Completed);
  });

  it('never produces a status whose label is Fail, for any run combination', () => {
    for (const row of TRUTH_TABLE) {
      const status = deriveCaseStatusFromRuns([
        { pmo_iscurrent: true, pmo_runnumber: 1, pmo_status: deriveRunSave(row.answers, { questionCount: row.questionCount }).pmo_status },
      ]);
      expect(UAT_EXECUTION_STATUS_LABELS[status]).not.toBe('Fail');
    }
  });
});

// ── FR-047 and scenario 4: defects need no separate write ───────────────────

describe('FR-047 — a failing run and its retest', () => {
  const failedRun: CaseStatusRun = {
    pmo_iscurrent: true, pmo_runnumber: 1,
    pmo_status: deriveRunSave(answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Fail), { questionCount: 2 }).pmo_status,
  };

  it('moves the case to Returned for Defect from the failing answer alone', () => {
    expect(deriveCaseStatusFromRuns([failedRun])).toBe(UAT_EXECUTION_STATUS.ReturnedForDefect);
  });

  it('follows the retest, because a re-test is a new current run', () => {
    const retest: CaseStatusRun = {
      pmo_iscurrent: true, pmo_runnumber: 2,
      pmo_status: deriveRunSave(answers(UAT_OUTCOME.Pass, UAT_OUTCOME.Pass), { questionCount: 2 }).pmo_status,
    };
    const status = deriveCaseStatusFromRuns([{ ...failedRun, pmo_iscurrent: false }, retest]);
    expect(status).toBe(UAT_EXECUTION_STATUS.Completed);
  });
});

// ── Which run is current ────────────────────────────────────────────────────

describe('selectCurrentRun', () => {
  it('returns null when the case has never been run', () => {
    expect(selectCurrentRun([])).toBeNull();
  });

  it('picks the flagged run, not the highest-numbered one', () => {
    const flagged = run({ pmo_iscurrent: true, pmo_runnumber: 1 });
    const later = run({ pmo_iscurrent: false, pmo_runnumber: 9 });
    expect(selectCurrentRun([flagged, later])).toBe(flagged);
  });

  it('picks the later of TWO flagged runs — the state a failed start leaves behind', () => {
    // useStartUatTestRun creates then demotes, precisely so a mid-sequence failure
    // leaves two current runs rather than zero. The new one is the one just opened.
    const stale = run({ pmo_iscurrent: true, pmo_runnumber: 1 });
    const fresh = run({ pmo_iscurrent: true, pmo_runnumber: 2 });
    expect(selectCurrentRun([fresh, stale])).toBe(fresh);
  });

  it('falls back to the latest run when NONE is flagged, rather than reading never-tested', () => {
    const first = run({ pmo_iscurrent: false, pmo_runnumber: 1 });
    const second = run({ pmo_iscurrent: null, pmo_runnumber: 2 });
    expect(selectCurrentRun([second, first])).toBe(second);
  });

  it('breaks a run-number tie on createdon', () => {
    const older = run({ pmo_runnumber: null, createdon: '2026-08-01T00:00:00Z' });
    const newer = run({ pmo_runnumber: null, createdon: '2026-08-29T00:00:00Z' });
    expect(selectCurrentRun([newer, older])).toBe(newer);
  });

  it('is total: identical runs still yield one', () => {
    const a = run({ pmo_runnumber: null });
    const b = run({ pmo_runnumber: null });
    expect(selectCurrentRun([a, b])).toBe(b);
  });
});

// ── Case status ─────────────────────────────────────────────────────────────

describe('deriveCaseStatus', () => {
  it('reads Not Started when there is no run', () => {
    expect(deriveCaseStatus(null)).toBe(UAT_EXECUTION_STATUS.NotStarted);
    expect(deriveCaseStatus(undefined)).toBe(UAT_EXECUTION_STATUS.NotStarted);
    expect(deriveCaseStatusFromRuns([])).toBe(UAT_EXECUTION_STATUS.NotStarted);
  });

  it('takes the current run’s status verbatim, without re-deriving from answers', () => {
    for (const status of Object.values(UAT_EXECUTION_STATUS)) {
      expect(deriveCaseStatus(run({ pmo_status: status }))).toBe(status);
    }
  });

  it('reads In Process — never Not Started — when a run exists with an unusable status', () => {
    // A run row exists, so "never started" would be a lie. Reachable from a
    // model-driven form edit or a legacy import, not from this app's writes.
    expect(deriveCaseStatus(run({ pmo_status: null }))).toBe(UAT_EXECUTION_STATUS.InProcess);
    expect(deriveCaseStatus(run({ pmo_status: 999_999 }))).toBe(UAT_EXECUTION_STATUS.InProcess);
  });
});

describe('the set guards', () => {
  it('isExecutionStatus accepts only the five members', () => {
    for (const value of Object.values(UAT_EXECUTION_STATUS)) expect(isExecutionStatus(value)).toBe(true);
    expect(isExecutionStatus(null)).toBe(false);
    expect(isExecutionStatus(undefined)).toBe(false);
    expect(isExecutionStatus(999_999)).toBe(false);
    // NOTE what this guard can no longer do. It used to reject UAT_OUTCOME.InProcess, the one
    // outcome integer that was not also a status integer. Since the status set gained its fifth
    // member the two sets overlap COMPLETELY, so no runtime guard can tell an outcome from a
    // status any more -- see the overlap test above. The source guards are now the only thing
    // standing between the two vocabularies.
    for (const value of Object.values(UAT_OUTCOME)) {
      expect(isExecutionStatus(value), 'every outcome integer is now also a status integer').toBe(true);
    }
  });

  it('isOutcome accepts only the five members', () => {
    for (const value of Object.values(UAT_OUTCOME)) expect(isOutcome(value)).toBe(true);
    expect(isOutcome(null)).toBe(false);
    expect(isOutcome(undefined)).toBe(false);
    expect(isOutcome(999_999)).toBe(false);
  });
});
