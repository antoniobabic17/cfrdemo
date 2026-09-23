/**
 * How a run's outcome and a test case's status are derived. This module is the fix for
 * the defect the whole rebuild is named after.
 *
 * THE LEGACY FAILURE, STATED, because every rule below is shaped by it: the old system
 * fed a Dataverse rollup into a calculated string that mapped every non-Pass value to
 * "FAIL". A case with one passing and one in-process child therefore read as failed, and
 * there was no representation of in-progress at case level at all (spec.md FR-022,
 * scenario 2). Two structural decisions follow, and neither is negotiable here:
 *
 *   1. **A case carries a *status*, never an *outcome*.** `pmo_uatexecutionstatus` is
 *      Not Started / In Process / Completed / Returned for Defect / Blocked and has no
 *      `Fail` member at all, while `pmo_uatoutcome` (Pass / Fail / Blocked / Not Applicable /
 *      In Process) is what answers and runs carry. The two sets now share the word "Blocked"
 *      and it means the same thing in both, which is fine — what matters is that no status
 *      means "Fail". Keeping the vocabularies apart is what makes "never Fail" structural
 *      rather than remembered.
 *   2. **Derived and written on save, never a rollup.** Rollups recalculate on a platform
 *      schedule and so cannot back a live board — data-model.md §7 and T024's acceptance
 *      both say so, with that reason.
 *
 * ⚠ THE TWO SETS SHARE INTEGERS, AND NOTHING AT RUNTIME CAN TELL THEM APART. Every set in
 * this environment starts at the same base, so four pairs now collide outright: `Fail` with
 * In Process(status), `Blocked`(outcome) with `Completed`, `Not Applicable` with Returned for
 * Defect, and — since the status set gained a fifth member — `In Process`(outcome) with
 * `Blocked`(status), which is the nastiest of the four because the two words are swapped
 * between the sets. (The integers are deliberately not repeated here — uatOptionSets.ts is the only
 * place they are written, and uatStatus.test.ts asserts each collision from the constants
 * so the claim cannot go stale.) Returning an outcome where a status belongs type-checks
 * (both are numeric literal unions that overlap), produces a plausible-looking value, and
 * no assertion on the value or its label can catch it. So `RUN_RESULT_TO_STATUS` is
 * guarded by a source-text test instead: uatStatus.test.ts asserts its right-hand sides
 * are spelled `UAT_EXECUTION_STATUS.*`. Never flatten, never copy an integer between the two.
 *
 * FR-047 NEEDS NO SEPARATE WRITE. "Raising a defect moves its test case to Returned for
 * Defect" is already true the moment the run records a failing answer, because a defect
 * can only be raised from a failing run. Scenario 4 (retest) follows for the same reason
 * a re-test is a new run: the new run becomes current and the case status follows it.
 */
import {
  UAT_EXECUTION_STATUS,
  UAT_OUTCOME,
  type UatExecutionStatusValue,
  type UatOutcomeValue,
} from '../../../lib/uatOptionSets';

/**
 * Which outcome a run reads when its answers disagree — most dominant first.
 *
 * ONE CONSTANT ON PURPOSE. Two of these five rows were an assumption when this was written,
 * because nothing in spec.md, data-model.md, plan.md or research.md said what a run reads when
 * a `Blocked` or a `Not Applicable` answer is mixed with passes (progress.md finding 45). Both
 * were put to the owner on 2026-08-31 and are now DECIDED:
 *
 *   - **`Blocked` outranks `In Process`, and surfaces as its own status.** *"It is blocked and
 *     should show blocked."* A blocked case must be visible and countable as blocked, not folded
 *     into work merely underway — hence the fifth status member.
 *   - **`Not Applicable` counts toward completion.** A run of passes and not-applicables, with
 *     nothing unanswered, is Completed. Questions that never applied to a case do not hold it
 *     open, which would otherwise leave cases open indefinitely on questions that will never
 *     apply.
 *
 * `Fail` dominating was always fixed by T024's acceptance, and `Pass` losing to everything is
 * self-evident. Every cell is still named individually in the tests, so a future change of mind
 * shows up as a diff on exactly the rows that moved.
 */
export const OUTCOME_PRECEDENCE: readonly UatOutcomeValue[] = [
  UAT_OUTCOME.Fail,
  UAT_OUTCOME.Blocked,
  UAT_OUTCOME.InProcess,
  UAT_OUTCOME.NotApplicable,
  UAT_OUTCOME.Pass,
] as const;

/**
 * A run's outcome to the status it and its case take.
 *
 * The whole crossing between the two vocabularies happens here and nowhere else.
 *
 * `Blocked` MAPS TO A STATUS OF ITS OWN, by owner decision on 2026-08-31. Asked whether a
 * case with one blocked answer and the rest passing should read In Process or Returned for
 * Defect, the answer was neither: *"It is blocked and should show blocked."* That could not be
 * done by display alone — storing In Process while showing "Blocked" would be a label
 * disagreeing with the data, and every count taken from the status column would have read the
 * case as merely underway. So `pmo_uatexecutionstatus` gained a fifth member and FR-021 was
 * amended from four values to five.
 *
 * This is the opposite of the legacy failure, not a repeat of it. The old system collapsed every
 * non-Pass outcome into "FAIL"; this separates a state that was being folded into In Process. The
 * status set still has no `Fail` member, and that absence is still what makes FR-022 structural.
 */
export const RUN_RESULT_TO_STATUS: Readonly<Record<UatOutcomeValue, UatExecutionStatusValue>> = {
  [UAT_OUTCOME.Fail]: UAT_EXECUTION_STATUS.ReturnedForDefect,
  [UAT_OUTCOME.Blocked]: UAT_EXECUTION_STATUS.Blocked,
  [UAT_OUTCOME.InProcess]: UAT_EXECUTION_STATUS.InProcess,
  [UAT_OUTCOME.NotApplicable]: UAT_EXECUTION_STATUS.Completed,
  [UAT_OUTCOME.Pass]: UAT_EXECUTION_STATUS.Completed,
};

/** True when `value` is a member of `pmo_uatexecutionstatus`. */
export function isExecutionStatus(value: number | null | undefined): value is UatExecutionStatusValue {
  return value !== null && value !== undefined
    && (Object.values(UAT_EXECUTION_STATUS) as number[]).includes(value);
}

/** True when `value` is a member of `pmo_uatoutcome`. */
export function isOutcome(value: number | null | undefined): value is UatOutcomeValue {
  return value !== null && value !== undefined
    && (Object.values(UAT_OUTCOME) as number[]).includes(value);
}

/**
 * The one field of an answer this module reads.
 *
 * Structural rather than `UatTestRunAnswer`, so the run form can derive from unsaved
 * form state with the same function that derives from persisted rows. Two derivations
 * would be two truths.
 */
export interface RunAnswerOutcome {
  pmo_outcome: number | null;
}

export interface DeriveRunResultOptions {
  /**
   * How many questions the run's template presents.
   *
   * Supply it wherever it is known. Without it, a run that has saved 3 of 13 answers and
   * passed all three derives `Pass`, and its case reads **Completed** — the same class of
   * lie as the legacy FAIL, in the opposite direction. With it, missing answer rows count
   * as unanswered and the run stays In Process.
   */
  questionCount?: number;
}

/**
 * Derive `pmo_uattestrun.pmo_result` from the run's answers.
 *
 * Returns null only when there is genuinely nothing to derive from — no answers and no
 * expected question count. Null is the not-yet-run half of the pair data-model.md §7
 * note 2 fixes: `pmo_result` null with `pmo_status` = Not Started. There is deliberately
 * no `Not Run` outcome member to return instead.
 *
 * An unanswered question — a null `pmo_outcome`, or a missing row when `questionCount`
 * says one is expected — makes the run In Process regardless of what the answered
 * questions say, with one exception: a `Fail` already recorded still dominates, because a
 * failure found halfway through a run is a failure.
 *
 * Whether the run is *allowed* to be saved with unanswered required questions is the run
 * form's decision (T027), not this module's. This function reports what the answers say.
 */
export function deriveRunResult(
  answers: readonly RunAnswerOutcome[],
  options: DeriveRunResultOptions = {},
): UatOutcomeValue | null {
  const expected = options.questionCount;
  if (answers.length === 0 && !expected) return null;

  const present = answers.map((a) => a.pmo_outcome).filter(isOutcome);
  const missing = answers.length - present.length
    + Math.max(0, (expected ?? 0) - answers.length);

  if (present.includes(UAT_OUTCOME.Fail)) return UAT_OUTCOME.Fail;
  if (missing > 0) return UAT_OUTCOME.InProcess;

  for (const outcome of OUTCOME_PRECEDENCE) {
    if (present.includes(outcome)) return outcome;
  }
  // Unreachable while OUTCOME_PRECEDENCE covers the set — a test pins that it does.
  return null;
}

/**
 * Derive `pmo_uattestrun.pmo_status` from the run's own `pmo_result`.
 *
 * Null result means the run has recorded nothing, which is Not Started. This is the only
 * crossing from the outcome vocabulary into the status vocabulary, and it goes through
 * `RUN_RESULT_TO_STATUS`.
 */
export function deriveRunStatus(result: UatOutcomeValue | null): UatExecutionStatusValue {
  if (result === null) return UAT_EXECUTION_STATUS.NotStarted;
  return RUN_RESULT_TO_STATUS[result];
}

/** The pair a run save writes. Both columns, from one call, so they cannot disagree. */
export interface DerivedRunSave {
  pmo_result: UatOutcomeValue | null;
  pmo_status: UatExecutionStatusValue;
}

/**
 * What the run form writes on save: the run's outcome and its status together.
 *
 * Deriving them in two places is how the legacy rollup and its calculated string came to
 * disagree, so there is one entry point and callers spread it into the update payload.
 */
export function deriveRunSave(
  answers: readonly RunAnswerOutcome[],
  options: DeriveRunResultOptions = {},
): DerivedRunSave {
  const pmo_result = deriveRunResult(answers, options);
  return { pmo_result, pmo_status: deriveRunStatus(pmo_result) };
}

/**
 * The fields of a run that decide which one is current and what status it carries.
 */
export interface CaseStatusRun {
  pmo_iscurrent: boolean | null;
  pmo_runnumber: number | null;
  pmo_status: number | null;
  createdon?: string;
}

/**
 * Pick the run a case's status is derived from.
 *
 * `pmo_iscurrent` is the authority — data-model.md §4.2 and spec.md's run entity both say
 * the run carries whether it is the current attempt, and FR-022 says *current* run,
 * singular. So a case does not aggregate across runs: scenario 2's "one passing and one
 * in-process run reads In Process" holds because the in-process run is the later one and
 * therefore the current one.
 *
 * Two degenerate states are handled deliberately rather than left to array order:
 *
 *   - **Two runs flagged current.** A real, documented state: `useStartUatTestRun` creates
 *     the new run before demoting the old one precisely so a mid-sequence failure leaves
 *     two current runs that a person can see and fix, rather than zero. The later run
 *     wins, which is the one the tester just opened.
 *   - **Runs exist but none is flagged.** Reading that as "never tested" would silently
 *     discard the last known result — the exact loss the create-then-demote order exists
 *     to prevent. The latest run wins instead.
 *
 * Latest means highest `pmo_runnumber`, then newest `createdon`, then last in the array.
 */
export function selectCurrentRun<T extends CaseStatusRun>(runs: readonly T[]): T | null {
  if (runs.length === 0) return null;

  const flagged = runs.filter((r) => r.pmo_iscurrent === true);
  const pool = flagged.length > 0 ? flagged : runs;

  return pool.reduce((best, candidate) => {
    const bestNumber = best.pmo_runnumber ?? -Infinity;
    const candidateNumber = candidate.pmo_runnumber ?? -Infinity;
    if (candidateNumber !== bestNumber) return candidateNumber > bestNumber ? candidate : best;
    const bestCreated = best.createdon ?? '';
    const candidateCreated = candidate.createdon ?? '';
    if (candidateCreated !== bestCreated) return candidateCreated > bestCreated ? candidate : best;
    return candidate; // Last one wins, so the reduce is stable and total.
  });
}

/**
 * Derive `pmo_uattestcase.pmo_executionstatus` from the case's current run.
 *
 * No run means Not Started. Otherwise the case takes the current run's status verbatim —
 * the case does not re-derive from answers, because the run already did and two
 * derivations would be two truths.
 *
 * A run whose stored status is not a member of the set reads **In Process**, not Not
 * Started: a run row exists, so "never started" would be a lie, and In Process is the
 * honest "a run is open and we cannot say more". This is reachable from a model-driven
 * form edit or a legacy import, not from this application's own writes.
 */
export function deriveCaseStatus(currentRun: CaseStatusRun | null | undefined): UatExecutionStatusValue {
  if (!currentRun) return UAT_EXECUTION_STATUS.NotStarted;
  if (isExecutionStatus(currentRun.pmo_status)) return currentRun.pmo_status;
  return UAT_EXECUTION_STATUS.InProcess;
}

/** `deriveCaseStatus` over a case's whole run list. The call site most callers want. */
export function deriveCaseStatusFromRuns(runs: readonly CaseStatusRun[]): UatExecutionStatusValue {
  return deriveCaseStatus(selectCurrentRun(runs));
}
