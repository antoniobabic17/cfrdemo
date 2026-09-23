import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectTemplate, ProjectTemplateCreate, ProjectTemplateUpdate } from '../models/projectTemplate.model';

const SET = ENTITY_SETS.projectTemplate;
const FIELDS: (keyof ProjectTemplate)[] = [
  'pmo_projecttemplateid', 'pmo_name', 'pmo_description',
  'pmo_cfrcategory', 'pmo_taskpayload', 'pmo_issystemdefault',
  'statecode', 'createdon', 'modifiedon',
];

export async function listTemplates(): Promise<ProjectTemplate[]> {
  return dv.list<ProjectTemplate>(SET, {
    $select: FIELDS,
    $filter: 'statecode eq 0',
    $orderby: 'pmo_name asc',
  });
}

export async function getTemplate(id: string): Promise<ProjectTemplate> {
  return dv.get<ProjectTemplate>(SET, id, FIELDS);
}

export async function createTemplate(payload: ProjectTemplateCreate): Promise<ProjectTemplate> {
  return dv.create<ProjectTemplate>(SET, payload);
}

export async function updateTemplate(id: string, payload: ProjectTemplateUpdate): Promise<void> {
  return dv.update(SET, id, payload);
}

export async function deactivateTemplate(id: string): Promise<void> {
  return dv.deactivate(SET, id);
}
