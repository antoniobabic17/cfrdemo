/**
 * UAT test case, coverage link and tag services.
 *
 * DELETING A TEST CASE WITH COVERAGE LINKS IS REFUSED BY THE PLATFORM. The junction's
 * test-case end is Restrict, deliberately: RemoveLink would leave an orphaned link
 * that silently misstates traceability, which is the thing the coverage layer exists
 * to report on. Callers must unlink first and surface the platform's refusal rather
 * than swallowing it — see progress.md finding 17.
 */
import * as dv from '../lib/dataverseClient';
import { projectMatch } from '../lib/projectLookupRef';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import type { ODataParams } from '../models/common.model';
import type {
  UatTestCase,
  UatTestCaseCreate,
  UatTestCaseUpdate,
  UatCoverageLink,
  UatCoverageLinkCreate,
  UatCoverageLinkUpdate,
  UatTag,
  UatTagCreate,
  UatTagLink,
} from '../models/uatTestCase.model';

const SET = UAT_ENTITY_SETS.testCase;
const COVERAGE_SET = UAT_ENTITY_SETS.coverageLink;
const TAG_SET = UAT_ENTITY_SETS.tag;
const TAG_LINK_SET = UAT_ENTITY_SETS.tagLink;

const LIST_SELECT: string[] = [
  'pmo_uattestcaseid',
  'pmo_name',
  'pmo_title',
  'pmo_priority',
  'pmo_executionstatus',
  'pmo_source',
  '_pmo_template_value',
  '_pmo_cycle_value',
  '_pmo_importbatch_value',
  '_pmo_assignedtester_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'pmo_plannedstart',
  'pmo_plannedend',
  'pmo_estimatedminutes',
  'pmo_externalsystem',
  'pmo_externalkey',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

// The four narrative columns, pmo_testdata chief among them: it replaced the legacy
// 40+ Epic-specific columns and is by far the largest field on the table.
const DETAIL_SELECT: string[] = [
  ...LIST_SELECT,
  'pmo_objective',
  'pmo_scenario',
  'pmo_preconditions',
  'pmo_testdata',
  'pmo_externalid',
  'pmo_externalurl',
  'pmo_externalstatus',
  'pmo_externalsyncedon',
];

const COVERAGE_SELECT: string[] = [
  'pmo_uatcoveragelinkid',
  'pmo_name',
  '_pmo_requirement_value',
  '_pmo_testcase_value',
  'pmo_coveragetype',
  'pmo_notes',
  'statecode',
  'statuscode',
  'createdon',
];

const TAG_SELECT: string[] = [
  'pmo_uattagid',
  'pmo_name',
  'pmo_colour',
  'statecode',
  'statuscode',
  'createdon',
];

const TAG_LINK_SELECT: string[] = [
  'pmo_uattaglinkid',
  'pmo_name',
  '_pmo_tag_value',
  '_pmo_testcase_value',
  '_pmo_requirement_value',
  '_pmo_testrun_value',
  '_pmo_defect_value',
  '_pmo_cycle_value',
  '_pmo_importbatch_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'statecode',
  'statuscode',
  'createdon',
];

/**
 * Every active test case, across projects. Backs the cross-project UAT list.
 *
 * `statecode eq 0` is a DEFAULT rather than a hard-coded clause so a caller can widen it
 * deliberately, but it is present because its absence was a real inconsistency: every
 * other list in this file filters it, so a deactivated case would have appeared on the
 * cross-project surface and been absent from the per-project one — two surfaces giving
 * two answers about the same row, with nothing failing. A caller that supplies its own
 * `$filter` replaces this one and owns the statecode decision.
 */
export async function listUatTestCases(params?: ODataParams): Promise<UatTestCase[]> {
  return dv.list<UatTestCase>(SET, {
    $select: LIST_SELECT,
    $filter: 'statecode eq 0',
    $orderby: 'createdon desc',
    ...params,
  });
}

export async function listUatTestCasesByProject(projectId: string): Promise<UatTestCase[]> {
  return dv.list<UatTestCase>(SET, {
    $select: LIST_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_name asc',
  });
}

export async function listUatTestCasesByCycle(cycleId: string): Promise<UatTestCase[]> {
  return dv.list<UatTestCase>(SET, {
    $select: LIST_SELECT,
    $filter: `_pmo_cycle_value eq '${cycleId}' and statecode eq 0`,
    $orderby: 'pmo_name asc',
  });
}

export async function getUatTestCase(id: string): Promise<UatTestCase> {
  return dv.get<UatTestCase>(SET, id, DETAIL_SELECT);
}

export async function createUatTestCase(payload: UatTestCaseCreate): Promise<UatTestCase> {
  return dv.create<UatTestCase>(SET, payload);
}

export async function updateUatTestCase(id: string, payload: UatTestCaseUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function deleteUatTestCase(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}

// ── Coverage ────────────────────────────────────────────────────────────────

export async function listCoverageForRequirement(requirementId: string): Promise<UatCoverageLink[]> {
  return dv.list<UatCoverageLink>(COVERAGE_SET, {
    $select: COVERAGE_SELECT,
    $filter: `_pmo_requirement_value eq '${requirementId}' and statecode eq 0`,
    $orderby: 'createdon asc',
  });
}

export async function listCoverageForTestCase(testCaseId: string): Promise<UatCoverageLink[]> {
  return dv.list<UatCoverageLink>(COVERAGE_SET, {
    $select: COVERAGE_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and statecode eq 0`,
    $orderby: 'createdon asc',
  });
}

export async function getUatCoverageLink(id: string): Promise<UatCoverageLink> {
  return dv.get<UatCoverageLink>(COVERAGE_SET, id, COVERAGE_SELECT);
}

export async function createUatCoverageLink(payload: UatCoverageLinkCreate): Promise<UatCoverageLink> {
  return dv.create<UatCoverageLink>(COVERAGE_SET, payload);
}

export async function updateUatCoverageLink(id: string, payload: UatCoverageLinkUpdate): Promise<void> {
  return dv.update(COVERAGE_SET, id, payload);
}

/**
 * A HARD delete, unlike every other delete in this feature, and the exception is
 * load-bearing.
 *
 * Removing coverage is what unblocks deleting a test case. The platform's Restrict
 * check counts EXISTING rows regardless of statecode, so a deactivated link would
 * still block the delete -- while disappearing from every list here, all of which
 * filter statecode eq 0. Invisible and still blocking is the worst of both, so this
 * removes the row. See progress.md finding 17.
 */
export async function deleteUatCoverageLink(id: string): Promise<void> {
  return dv.remove(COVERAGE_SET, id);
}

// ── Tags ────────────────────────────────────────────────────────────────────

export async function listUatTags(): Promise<UatTag[]> {
  return dv.list<UatTag>(TAG_SET, {
    $select: TAG_SELECT,
    $filter: 'statecode eq 0',
    $orderby: 'pmo_name asc',
  });
}

export async function getUatTag(id: string): Promise<UatTag> {
  return dv.get<UatTag>(TAG_SET, id, TAG_SELECT);
}

export async function createUatTag(payload: UatTagCreate): Promise<UatTag> {
  return dv.create<UatTag>(TAG_SET, payload);
}

export async function updateUatTag(id: string, payload: Partial<UatTagCreate>): Promise<void> {
  return dv.update(TAG_SET, id, payload);
}

export async function listUatTagLinksForTestCase(testCaseId: string): Promise<UatTagLink[]> {
  return dv.list<UatTagLink>(TAG_LINK_SET, {
    $select: TAG_LINK_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and statecode eq 0`,
  });
}
