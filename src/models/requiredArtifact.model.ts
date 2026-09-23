/** pmo_requiredartifact — artifact definitions required by project category */
export interface RequiredArtifact {
  pmo_requiredartifactid: string;
  pmo_name: string;
  pmo_artifacttype: number;
  pmo_cfrcategory?: number;
  pmo_isrequired: boolean;
  pmo_description?: string;
  statecode?: 0 | 1;
}

export type RequiredArtifactCreate = Pick<
  RequiredArtifact,
  'pmo_name' | 'pmo_artifacttype' | 'pmo_isrequired' | 'pmo_cfrcategory' | 'pmo_description'
>;

/** pmo_projectartifactstatus — per-project artifact completion tracking */
export interface ProjectArtifactStatus {
  pmo_projectartifactstatusid: string;
  pmo_name?: string;
  pmo_status: number;
  pmo_completeddate?: string;
  pmo_notes?: string;
  statecode?: 0 | 1;
  '_pmo_project_value'?: string;
  '_pmo_requiredartifact_value'?: string;
  '_pmo_documentlink_value'?: string;
}

export type ProjectArtifactStatusCreate = {
  pmo_status: number;
  pmo_notes?: string;
  'pmo_Project@odata.bind': string;
  'pmo_RequiredArtifact@odata.bind': string;
  'pmo_DocumentLink@odata.bind'?: string;
};

export type ProjectArtifactStatusUpdate = Partial<
  Pick<ProjectArtifactStatus, 'pmo_status' | 'pmo_completeddate' | 'pmo_notes'>
> & { 'pmo_DocumentLink@odata.bind'?: string | null };
