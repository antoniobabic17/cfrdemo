/**
 * UAT execution layer: cycle, run, answer.
 *
 * HISTORY IS IMMUTABLE. A re-test is a new pmo_uattestrun, never an edit of the last
 * one. Deleting a test case cascades to its runs and their answers — the fix for the
 * legacy behaviour where every relationship was RemoveLink, so a delete left rows
 * that still existed, still counted in aggregates, and belonged to nothing.
 *
 * THE TIMING COLUMNS ARE NOT TESTER-ENTERED. pmo_startedon, pmo_completedon and
 * pmo_minutes are written by the run form's timer. pmo_minutesoverridden is written
 * explicitly false on a measured save, never left null, so "how much of this metric
 * was measured?" is a query rather than an interpretation. The legacy equivalent was
 * hand-typed and then gated a flow at a hard-coded 240.
 */
import type { ActiveState } from './common.model';
import type { UatProjectReferenceFields } from './uatRequirement.model';

export interface UatCycle extends ActiveState, UatProjectReferenceFields {
  pmo_uatcycleid: string;
  pmo_name: string;
  pmo_description: string | null;
  /** Global pmo_uatcyclestatus set. */
  pmo_status: number | null;
  pmo_plannedstart: string | null;
  pmo_plannedend: string | null;
  pmo_actualstart: string | null;
  pmo_actualend: string | null;
  pmo_sequence: number | null;
  createdon: string;
  modifiedon: string;
}

export interface UatCycleUpdate {
  pmo_name?: string;
  pmo_description?: string | null;
  pmo_status?: number | null;
  pmo_plannedstart?: string | null;
  pmo_plannedend?: string | null;
  pmo_actualstart?: string | null;
  pmo_actualend?: string | null;
  pmo_sequence?: number | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export interface UatCycleCreate extends UatCycleUpdate {
  pmo_name: string;
}

export interface UatTestRun extends ActiveState, UatProjectReferenceFields {
  pmo_uattestrunid: string;
  /** Autonumber, RUN-00000. */
  pmo_name: string;
  _pmo_testcase_value: string;
  _pmo_cycle_value: string | null;
  _pmo_tester_value: string | null;
  pmo_runnumber: number | null;
  /** Written by the run form's timer, not by a tester. */
  pmo_startedon: string | null;
  pmo_completedon: string | null;
  pmo_minutes: number | null;
  /** Explicitly false on a measured save. Never left null. */
  pmo_minutesoverridden: boolean | null;
  /** Global pmo_uatexecutionstatus set, shared with the test case. */
  pmo_status: number | null;
  /**
   * Global pmo_uatoutcome set — the SHARED outcome vocabulary, so there is
   * deliberately no "Not Run" member. A not-yet-run test is pmo_result null with
   * pmo_status = Not Started.
   */
  pmo_result: number | null;
  pmo_comments: string | null;
  /** True on the latest run for its case; superseded runs stay, with this false. */
  pmo_iscurrent: boolean | null;
  createdon: string;
  modifiedon: string;
}

export interface UatTestRunUpdate {
  pmo_runnumber?: number | null;
  pmo_startedon?: string | null;
  pmo_completedon?: string | null;
  pmo_minutes?: number | null;
  pmo_minutesoverridden?: boolean | null;
  pmo_status?: number | null;
  pmo_result?: number | null;
  pmo_comments?: string | null;
  pmo_iscurrent?: boolean | null;
  'pmo_Cycle@odata.bind'?: string | null;
  'pmo_Tester@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export interface UatTestRunCreate extends UatTestRunUpdate {
  /** '/pmo_uattestcases(<guid>)'. Cascade parent: required. */
  'pmo_TestCase@odata.bind': string;
}

/**
 * One answer to one question in one run. This table replaces the legacy 39 fixed
 * result columns.
 *
 * THE SNAPSHOT COLUMNS ARE WHY CONFIGURABLE QUESTIONS ARE SAFE. They freeze what was
 * actually asked and what the tester actually read. Without them, editing a template
 * would silently rewrite the meaning of every historical run — a worse outcome than
 * the fixed columns being replaced. Read the snapshot, not the joined question, when
 * displaying history.
 */
export interface UatTestRunAnswer extends ActiveState {
  pmo_uattestrunanswerid: string;
  /** This table's primary name, so the platform requires it. Load-bearing. */
  pmo_questiontextsnapshot: string;
  _pmo_testrun_value: string;
  /** Reference only. What was asked lives in the snapshot above. */
  _pmo_templatequestion_value: string | null;
  pmo_sequence: number | null;
  /** The outcome label as displayed at execution time. Choice labels can be renamed. */
  pmo_responselabelsnapshot: string | null;
  /** Global pmo_uatoutcome set. */
  pmo_outcome: number | null;
  pmo_observedvalue: string | null;
  pmo_observednumber: number | null;
  pmo_observeddate: string | null;
  pmo_comment: string | null;
  createdon: string;
}

export interface UatTestRunAnswerUpdate {
  pmo_questiontextsnapshot?: string;
  pmo_sequence?: number | null;
  pmo_responselabelsnapshot?: string | null;
  pmo_outcome?: number | null;
  pmo_observedvalue?: string | null;
  pmo_observednumber?: number | null;
  pmo_observeddate?: string | null;
  pmo_comment?: string | null;
}

export interface UatTestRunAnswerCreate extends UatTestRunAnswerUpdate {
  pmo_questiontextsnapshot: string;
  /** '/pmo_uattestruns(<guid>)'. Cascade parent: required. */
  'pmo_TestRun@odata.bind': string;
  'pmo_TemplateQuestion@odata.bind'?: string | null;
}
