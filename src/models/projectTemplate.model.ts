/** pmo_projecttemplate — project template definitions with WBS task payloads */
export interface ProjectTemplate {
  pmo_projecttemplateid: string;
  pmo_name: string;
  pmo_description?: string;
  pmo_cfrcategory?: number;
  pmo_taskpayload: string;
  pmo_issystemdefault?: boolean;
  statecode?: 0 | 1;
  createdon?: string;
  modifiedon?: string;
}

export type ProjectTemplateCreate = Pick<
  ProjectTemplate,
  'pmo_name' | 'pmo_description' | 'pmo_cfrcategory' | 'pmo_taskpayload'
> & {
  pmo_issystemdefault?: boolean;
};

export type ProjectTemplateUpdate = Partial<ProjectTemplateCreate>;
