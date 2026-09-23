/**
 * How one answer's inputs map onto the answer row's columns.
 *
 * Extracted from the run form so the shell and the in-progress body can share it, and so the
 * routing between the three typed observed-value columns has one home rather than being
 * re-decided at each input.
 */
import { UAT_OUTCOME, UAT_RESPONSE_TYPE, type UatOutcomeValue } from '../../../lib/uatOptionSets';
import type { UatTestRunAnswerCreate } from '../../../models/uatTestRun.model';

/** What the tester has entered for one question, before it becomes an answer row. */
export interface AnswerDraft {
  outcome: number | null;
  observed: string;
  comment: string;
}

export const EMPTY_DRAFT: AnswerDraft = { outcome: null, observed: '', comment: '' };

/**
 * Outcome options in the order a tester scans them.
 *
 * One global vocabulary, so there is no response-set editor and no per-question option list —
 * the owner chose the single outcome vocabulary, which is why the two response-set tables do
 * not exist.
 */
export const OUTCOME_OPTIONS: readonly UatOutcomeValue[] = [
  UAT_OUTCOME.Pass,
  UAT_OUTCOME.Fail,
  UAT_OUTCOME.Blocked,
  UAT_OUTCOME.NotApplicable,
  UAT_OUTCOME.InProcess,
] as const;

/**
 * Which observed-value column a response type writes to.
 *
 * Three typed columns exist rather than one string, so a number stays sortable and a date
 * stays comparable. Every call clears the other two, so a tester who changes a question's
 * answer type mid-run cannot leave a stale value behind in the column it used to use.
 */
export function observedFields(
  responseType: number | null,
  raw: string,
): Pick<UatTestRunAnswerCreate, 'pmo_observedvalue' | 'pmo_observednumber' | 'pmo_observeddate'> {
  const value = raw.trim();
  if (!value) return { pmo_observedvalue: null, pmo_observednumber: null, pmo_observeddate: null };
  switch (responseType) {
    case UAT_RESPONSE_TYPE.Number:
    case UAT_RESPONSE_TYPE.Currency:
    case UAT_RESPONSE_TYPE.Duration: {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? { pmo_observedvalue: null, pmo_observednumber: parsed, pmo_observeddate: null }
        // Unparseable input is kept as TEXT rather than discarded. Losing what the tester
        // actually saw is worse than storing it in the less useful column.
        : { pmo_observedvalue: value, pmo_observednumber: null, pmo_observeddate: null };
    }
    case UAT_RESPONSE_TYPE.Date:
      return { pmo_observedvalue: null, pmo_observednumber: null, pmo_observeddate: value };
    default:
      return { pmo_observedvalue: value, pmo_observednumber: null, pmo_observeddate: null };
  }
}

/** The HTML input type for a response type. */
export function inputType(responseType: number | null): string {
  switch (responseType) {
    case UAT_RESPONSE_TYPE.Number:
    case UAT_RESPONSE_TYPE.Currency:
    case UAT_RESPONSE_TYPE.Duration: return 'number';
    case UAT_RESPONSE_TYPE.Date: return 'date';
    default: return 'text';
  }
}
