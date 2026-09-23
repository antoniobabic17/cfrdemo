/**
 * UAT defect service.
 *
 * pmo_category and pmo_assignedteam are absent from every select list here because the
 * COLUMNS DO NOT EXIST. data-model.md names both as carry-across sets
 * (cr87a_defectcategory's 13 values, cr87a_defectteam's 7) but lists no members, and
 * those live in the PROD cr87a solution — see progress.md finding 27. Adding them to a
 * $select before the columns exist fails the query with 0x80060888, so they are left
 * out rather than optimistically included.
 */
import * as dv from '../lib/dataverseClient';
import { projectMatch } from '../lib/projectLookupRef';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import type { ODataParams } from '../models/common.model';
import type { UatDefect, UatDefectCreate, UatDefectUpdate } from '../models/uatDefect.model';

const SET = UAT_ENTITY_SETS.defect;

const LIST_SELECT: string[] = [
  'pmo_uatdefectid',
  'pmo_name',
  'pmo_summary',
  'pmo_status',
  'pmo_severity',
  'pmo_priority',
  'pmo_retestoutcome',
  '_pmo_testcase_value',
  '_pmo_testrun_value',
  '_pmo_requirement_value',
  '_pmo_assignedto_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'pmo_reportedon',
  'pmo_resolvedon',
  'pmo_retestedon',
  'pmo_closedon',
  'pmo_externalsystem',
  'pmo_externalkey',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

const DETAIL_SELECT: string[] = [
  ...LIST_SELECT,
  'pmo_details',
  'pmo_externalid',
  'pmo_externalurl',
  'pmo_externalstatus',
  'pmo_externalsyncedon',
];

export async function listUatDefects(params?: ODataParams): Promise<UatDefect[]> {
  return dv.list<UatDefect>(SET, {
    $select: LIST_SELECT,
    $orderby: 'createdon desc',
    ...params,
  });
}

export async function listUatDefectsByProject(projectId: string): Promise<UatDefect[]> {
  return dv.list<UatDefect>(SET, {
    $select: LIST_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

/**
 * Defects raised against one test case.
 *
 * Note these SURVIVE the test case being deleted, with the lookup nulled — every
 * defect lookup is RemoveLink and the table has no parental relationship, because a
 * defect must outlive the run that found it. So this list is "currently linked", not
 * "every defect this case ever produced".
 */
export async function listUatDefectsByTestCase(testCaseId: string): Promise<UatDefect[]> {
  return dv.list<UatDefect>(SET, {
    $select: LIST_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function listUatDefectsByTestRun(testRunId: string): Promise<UatDefect[]> {
  return dv.list<UatDefect>(SET, {
    $select: LIST_SELECT,
    $filter: `_pmo_testrun_value eq '${testRunId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function getUatDefect(id: string): Promise<UatDefect> {
  return dv.get<UatDefect>(SET, id, DETAIL_SELECT);
}

export async function createUatDefect(payload: UatDefectCreate): Promise<UatDefect> {
  return dv.create<UatDefect>(SET, payload);
}

export async function updateUatDefect(id: string, payload: UatDefectUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function deleteUatDefect(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
