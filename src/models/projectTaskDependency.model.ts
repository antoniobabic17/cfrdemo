export interface ProjectTaskDependency {
  msdyn_projecttaskdependencyid: string;
  /** 0=FinishToStart, 1=FinishToFinish, 2=StartToStart, 3=StartToFinish */
  msdyn_linktype?: number;
  '_msdyn_successortask_value'?: string;
  '_msdyn_predecessortask_value'?: string;
  '_msdyn_project_value'?: string;
}
