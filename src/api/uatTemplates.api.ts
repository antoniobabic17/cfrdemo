/**
 * UAT template and template-question services.
 *
 * Follows app/src/api/projects.api.ts: LIST_SELECT for lists, DETAIL_SELECT for a
 * single record. That split is not cosmetic — projects.api.ts records that listing
 * long narrative columns on every row pushed the OData URL past the Power Apps host
 * gateway limit and produced 0x80060888 ($select truncation).
 *
 * FormattedValue annotations are returned by the SDK automatically and must NOT
 * appear in $select.
 */
import * as dv from '../lib/dataverseClient';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import type { ODataParams } from '../models/common.model';
import type {
  UatTemplate,
  UatTemplateCreate,
  UatTemplateUpdate,
  UatTemplateQuestion,
  UatTemplateQuestionCreate,
  UatTemplateQuestionUpdate,
} from '../models/uatTemplate.model';

const TEMPLATE_SET = UAT_ENTITY_SETS.template;
const QUESTION_SET = UAT_ENTITY_SETS.templateQuestion;

const TEMPLATE_LIST_SELECT: string[] = [
  'pmo_uattemplateid',
  'pmo_name',
  'pmo_version',
  'pmo_isactive',
  'pmo_defaultestimatedminutes',
  '_pmo_owner_value',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

// pmo_description is detail-only: it is the one narrative column on this table.
const TEMPLATE_DETAIL_SELECT: string[] = [
  ...TEMPLATE_LIST_SELECT,
  'pmo_description',
];

const QUESTION_LIST_SELECT: string[] = [
  'pmo_uattemplatequestionid',
  'pmo_questiontext',
  '_pmo_template_value',
  'pmo_sequence',
  'pmo_responsetype',
  'pmo_isrequired',
  'pmo_capturesobservedvalue',
  'pmo_observedvaluelabel',
  'pmo_allowscomment',
  'pmo_allowsattachment',
  'pmo_section',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

const QUESTION_DETAIL_SELECT: string[] = [
  ...QUESTION_LIST_SELECT,
  'pmo_helptext',
  'pmo_expectedresult',
];

export async function listUatTemplates(params?: ODataParams): Promise<UatTemplate[]> {
  return dv.list<UatTemplate>(TEMPLATE_SET, {
    $select: TEMPLATE_LIST_SELECT,
    $orderby: 'pmo_name asc',
    ...params,
  });
}

export async function listActiveUatTemplates(): Promise<UatTemplate[]> {
  return dv.list<UatTemplate>(TEMPLATE_SET, {
    $select: TEMPLATE_LIST_SELECT,
    $filter: 'statecode eq 0 and pmo_isactive eq true',
    $orderby: 'pmo_name asc',
  });
}

export async function getUatTemplate(id: string): Promise<UatTemplate> {
  return dv.get<UatTemplate>(TEMPLATE_SET, id, TEMPLATE_DETAIL_SELECT);
}

export async function createUatTemplate(payload: UatTemplateCreate): Promise<UatTemplate> {
  return dv.create<UatTemplate>(TEMPLATE_SET, payload);
}

export async function updateUatTemplate(id: string, payload: UatTemplateUpdate): Promise<void> {
  return dv.update(TEMPLATE_SET, id, payload);
}

/**
 * Questions for one template, in display order.
 *
 * Ordered by pmo_sequence, which a reorder REWRITES rather than moving rows — so the
 * sequence is the display contract and this ordering is the only correct one.
 */
export async function listUatTemplateQuestions(templateId: string): Promise<UatTemplateQuestion[]> {
  return dv.list<UatTemplateQuestion>(QUESTION_SET, {
    $select: QUESTION_DETAIL_SELECT,
    $filter: `_pmo_template_value eq '${templateId}' and statecode eq 0`,
    $orderby: 'pmo_sequence asc',
  });
}

export async function getUatTemplateQuestion(id: string): Promise<UatTemplateQuestion> {
  return dv.get<UatTemplateQuestion>(QUESTION_SET, id, QUESTION_DETAIL_SELECT);
}

export async function createUatTemplateQuestion(
  payload: UatTemplateQuestionCreate,
): Promise<UatTemplateQuestion> {
  return dv.create<UatTemplateQuestion>(QUESTION_SET, payload);
}

export async function updateUatTemplateQuestion(
  id: string,
  payload: UatTemplateQuestionUpdate,
): Promise<void> {
  return dv.update(QUESTION_SET, id, payload);
}

export async function deleteUatTemplateQuestion(id: string): Promise<void> {
  return dv.deactivate(QUESTION_SET, id);
}
