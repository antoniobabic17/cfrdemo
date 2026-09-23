export interface ProjectBaseline {
  pmo_projectbaselineid: string;
  pmo_name: string;
  pmo_captureddate: string;
  pmo_baselinestart?: string;
  pmo_finish?: string;
  pmo_budget?: number;
  pmo_baselineeffort?: number;
  pmo_snapshotjson?: string;
  pmo_notes?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_project_value'?: string;
}

export type ProjectBaselineCreate = {
  pmo_name: string;
  pmo_captureddate: string;
  pmo_baselinestart?: string;
  pmo_finish?: string;
  pmo_budget?: number;
  pmo_baselineeffort?: number;
  pmo_snapshotjson?: string;
  pmo_notes?: string;
  'pmo_Project@odata.bind': string;
};
