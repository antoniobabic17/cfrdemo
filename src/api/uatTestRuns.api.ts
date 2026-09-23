/**
 * UAT cycle, test run and answer services.
 *
 * A RE-TEST IS A NEW RUN. There is deliberately no "reset this run" operation: history
 * is immutable, and `createUatTestRun` plus flipping the previous run's pmo_iscurrent
 * is the only sanctioned path. The legacy tool overwrote in place, which is why it
 * could not answer "what did this look like last month".
 *
 * pmo_result carries the SHARED pmo_uatoutcome vocabulary, so there is no "Not Run"
 * value to write. A not-yet-run test is pmo_result null with pmo_status = Not Started.
 */
import * as dv from '../lib/dataverseClient';
import { projectMatch } from '../lib/projectLookupRef';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import type { ODataParams } from '../models/common.model';
import type {
  UatCycle,
  UatCycleCreate,
  UatCycleUpdate,
  UatTestRun,
  UatTestRunCreate,
  UatTestRunUpdate,
  UatTestRunAnswer,
  UatTestRunAnswerCreate,
  UatTestRunAnswerUpdate,
} from '../models/uatTestRun.model';

const CYCLE_SET = UAT_ENTITY_SETS.cycle;
const RUN_SET = UAT_ENTITY_SETS.testRun;
const ANSWER_SET = UAT_ENTITY_SETS.testRunAnswer;

const CYCLE_LIST_SELECT: string[] = [
  'pmo_uatcycleid',
  'pmo_name',
  'pmo_status',
  'pmo_sequence',
  'pmo_plannedstart',
  'pmo_plannedend',
  'pmo_actualstart',
  'pmo_actualend',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

const CYCLE_DETAIL_SELECT: string[] = [...CYCLE_LIST_SELECT, 'pmo_description'];

const RUN_LIST_SELECT: string[] = [
  'pmo_uattestrunid',
  'pmo_name',
  '_pmo_testcase_value',
  '_pmo_cycle_value',
  '_pmo_tester_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'pmo_runnumber',
  'pmo_startedon',
  'pmo_completedon',
  'pmo_minutes',
  'pmo_minutesoverridden',
  'pmo_status',
  'pmo_result',
  'pmo_iscurrent',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

const RUN_DETAIL_SELECT: string[] = [...RUN_LIST_SELECT, 'pmo_comments'];

const ANSWER_SELECT: string[] = [
  'pmo_uattestrunanswerid',
  'pmo_questiontextsnapshot',
  'pmo_responselabelsnapshot',
  '_pmo_testrun_value',
  '_pmo_templatequestion_value',
  'pmo_sequence',
  'pmo_outcome',
  'pmo_observedvalue',
  'pmo_observednumber',
  'pmo_observeddate',
  'pmo_comment',
  'statecode',
  'statuscode',
  'createdon',
];

// ── Cycles ──────────────────────────────────────────────────────────────────

export async function listUatCycles(params?: ODataParams): Promise<UatCycle[]> {
  return dv.list<UatCycle>(CYCLE_SET, {
    $select: CYCLE_LIST_SELECT,
    $orderby: 'pmo_sequence asc',
    ...params,
  });
}

export async function listUatCyclesByProject(projectId: string): Promise<UatCycle[]> {
  return dv.list<UatCycle>(CYCLE_SET, {
    $select: CYCLE_LIST_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_sequence asc',
  });
}

export async function getUatCycle(id: string): Promise<UatCycle> {
  return dv.get<UatCycle>(CYCLE_SET, id, CYCLE_DETAIL_SELECT);
}

export async function createUatCycle(payload: UatCycleCreate): Promise<UatCycle> {
  return dv.create<UatCycle>(CYCLE_SET, payload);
}

export async function updateUatCycle(id: string, payload: UatCycleUpdate): Promise<void> {
  return dv.update(CYCLE_SET, id, payload);
}

export async function deleteUatCycle(id: string): Promise<void> {
  return dv.deactivate(CYCLE_SET, id);
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function listUatTestRuns(params?: ODataParams): Promise<UatTestRun[]> {
  return dv.list<UatTestRun>(RUN_SET, {
    $select: RUN_LIST_SELECT,
    $orderby: 'createdon desc',
    ...params,
  });
}

/** Every run for one test case, newest first — the run history panel. */
export async function listUatTestRunsByTestCase(testCaseId: string): Promise<UatTestRun[]> {
  return dv.list<UatTestRun>(RUN_SET, {
    $select: RUN_LIST_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and statecode eq 0`,
    $orderby: 'pmo_runnumber desc',
  });
}

/** The current run for one test case, or an empty array if it has never been run. */
export async function listCurrentUatTestRun(testCaseId: string): Promise<UatTestRun[]> {
  return dv.list<UatTestRun>(RUN_SET, {
    $select: RUN_DETAIL_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and pmo_iscurrent eq true and statecode eq 0`,
    $top: 1,
  });
}

export async function getUatTestRun(id: string): Promise<UatTestRun> {
  return dv.get<UatTestRun>(RUN_SET, id, RUN_DETAIL_SELECT);
}

export async function createUatTestRun(payload: UatTestRunCreate): Promise<UatTestRun> {
  return dv.create<UatTestRun>(RUN_SET, payload);
}

export async function updateUatTestRun(id: string, payload: UatTestRunUpdate): Promise<void> {
  return dv.update(RUN_SET, id, payload);
}

// ── Answers ─────────────────────────────────────────────────────────────────

/**
 * Answers for one run, in the order the questions were presented.
 *
 * Ordered by pmo_sequence, which is frozen with the snapshot — so this ordering
 * reproduces what the tester saw even if the template has since been reordered.
 */
export async function listUatTestRunAnswers(testRunId: string): Promise<UatTestRunAnswer[]> {
  return dv.list<UatTestRunAnswer>(ANSWER_SET, {
    $select: ANSWER_SELECT,
    $filter: `_pmo_testrun_value eq '${testRunId}' and statecode eq 0`,
    $orderby: 'pmo_sequence asc',
  });
}

export async function getUatTestRunAnswer(id: string): Promise<UatTestRunAnswer> {
  return dv.get<UatTestRunAnswer>(ANSWER_SET, id, ANSWER_SELECT);
}

export async function createUatTestRunAnswer(
  payload: UatTestRunAnswerCreate,
): Promise<UatTestRunAnswer> {
  return dv.create<UatTestRunAnswer>(ANSWER_SET, payload);
}

export async function updateUatTestRunAnswer(
  id: string,
  payload: UatTestRunAnswerUpdate,
): Promise<void> {
  return dv.update(ANSWER_SET, id, payload);
}
