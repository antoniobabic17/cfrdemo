// Shared types used across all entity models

export interface EntityRef {
  id: string;
  logicalName: string;
  name?: string;
}

export interface OptionSetValue {
  value: number;
  label: string;
}

export interface ActiveState {
  statecode: 0 | 1; // 0 = Active, 1 = Inactive
  statuscode: number;
}

export interface ODataListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

export interface ODataParams {
  $select?: string[];
  $filter?: string;
  $orderby?: string;
  $top?: number;
  $expand?: string[];
  $skiptoken?: string;
}

export interface DataverseError {
  code: string;
  message: string;
  innererror?: {
    message: string;
    type: string;
    stacktrace: string;
  };
}
