import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { TelemetryEvent, TelemetryEventCreate } from '../models/telemetryEvent.model';

const SET = ENTITY_SETS.telemetryEvent;

export async function createTelemetryEvent(payload: TelemetryEventCreate): Promise<TelemetryEvent> {
  return dv.create<TelemetryEvent>(SET, payload);
}

export async function listTelemetryEvents(filter?: string): Promise<TelemetryEvent[]> {
  return dv.list<TelemetryEvent>(SET, {
    $select: ['pmo_telemetryeventid', 'pmo_eventtype', 'pmo_severity', 'pmo_payload', 'pmo_source', 'createdon', '_pmo_project_value', '_createdby_value'],
    $filter: filter ?? 'statecode eq 0',
    $orderby: 'createdon desc',
    $top: 500,
  });
}

/** Convenience: list only AppError rows, newest first. Used by the Error Log page. */
export async function listAppErrorEvents(): Promise<TelemetryEvent[]> {
  return listTelemetryEvents("pmo_eventtype eq 'AppError' and statecode eq 0");
}
