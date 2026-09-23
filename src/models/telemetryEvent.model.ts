export interface TelemetryEvent {
  pmo_telemetryeventid: string;
  pmo_name?: string;
  pmo_eventtype: string;
  pmo_severity: number;
  pmo_payload: string;
  pmo_source?: string;
  statecode?: 0 | 1;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

export type TelemetryEventCreate = {
  pmo_eventtype: string;
  pmo_severity: number;
  pmo_payload: string;
  pmo_source?: string;
  'pmo_Project@odata.bind'?: string;
};
