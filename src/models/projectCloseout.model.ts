/** pmo_projectcloseout — project closeout checklist and completion tracking */
export interface ProjectCloseout {
  pmo_projectcloseoutid: string;
  pmo_name: string;
  pmo_checklistitem: string;
  pmo_iscomplete: boolean;
  pmo_completeddate?: string;
  pmo_notes?: string;
  pmo_lessonslearned?: string;
  pmo_outcomesummary?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_pmo_completedby_value'?: string;
  '_pmo_completedby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

export type ProjectCloseoutCreate = {
  pmo_name: string;
  pmo_checklistitem: string;
  pmo_iscomplete?: boolean;
  pmo_notes?: string;
  'pmo_Project@odata.bind': string;
};

export type ProjectCloseoutUpdate = Partial<
  Pick<ProjectCloseout, 'pmo_iscomplete' | 'pmo_completeddate' | 'pmo_notes' | 'pmo_lessonslearned' | 'pmo_outcomesummary'>
> & { 'pmo_CompletedBy@odata.bind'?: string | null };
