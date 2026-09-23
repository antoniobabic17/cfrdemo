/**
 * Tracking Labels API — backed by the `pmo_tracking` Dataverse table.
 *
 * pmo_tracking is a polymorphic, cross-team-writable join table: one row per
 * (record, label) pair. The CFR PMO Team role has Global CRUD on this table, so
 * ANY authenticated user can read and write tracking rows on ANY record — the
 * one deliberate exception to the per-project team-share write model. This is by
 * design: tracking labels are a personal observation tool, not a project-owned
 * field, and the table carries no sensitive project data.
 *
 * Current surfaces: Projects. Future: any entity type — just pass a different
 * recordType string. Zero schema change needed for new entity types.
 *
 * Filter convention (matches the actual Dataverse column names):
 *   pmo_recordtype — plain string, e.g. 'Project'
 *   pmo_recordid   — GUID as plain text (no braces, lowercase)
 *   pmo_label      — the tag value, e.g. 'Business Process'
 */
import * as dv from '../lib/dataverseClient';

const SET = 'pmo_trackings';

export interface TrackingLabel {
  pmo_trackingid: string;
  pmo_label: string;
  pmo_recordtype: string;
  pmo_recordid: string;
  statecode?: 0 | 1;
  createdon?: string;
  _createdby_value?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const SELECT: string[] = [
  'pmo_trackingid', 'pmo_label', 'pmo_recordtype', 'pmo_recordid',
  'statecode', 'createdon', '_createdby_value',
];

const norm = (id: string) => id.replace(/[{}]/g, '').toLowerCase();

/** List active tracking rows for a specific record (e.g. one project). */
export async function listTrackingLabels(
  recordType: string,
  recordId: string,
): Promise<TrackingLabel[]> {
  const safeType = recordType.replace(/'/g, "''");
  const safeId   = norm(recordId).replace(/'/g, "''");
  return dv.list<TrackingLabel>(SET, {
    $select: SELECT,
    $filter: `pmo_recordtype eq '${safeType}' and pmo_recordid eq '${safeId}' and statecode eq 0`,
    $orderby: 'pmo_label asc',
  });
}

/**
 * Bulk-list ALL active tracking rows for a record type (e.g. all Projects).
 * Used by the Projects gallery to avoid N+1 queries — loads once, grouped
 * client-side into a Map<recordId, string[]>.
 */
export async function listAllTrackingLabelsForType(
  recordType: string,
): Promise<TrackingLabel[]> {
  const safeType = recordType.replace(/'/g, "''");
  return dv.list<TrackingLabel>(SET, {
    $select: SELECT,
    $filter: `pmo_recordtype eq '${safeType}' and statecode eq 0`,
    $orderby: 'pmo_label asc',
  });
}

/**
 * Group the result of listAllTrackingLabelsForType into a Map<recordId, label[]>
 * keyed by lower-cased, brace-stripped GUID.
 */
export function groupByRecord(rows: TrackingLabel[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const row of rows) {
    const id = norm(row.pmo_recordid);
    const arr = m.get(id);
    if (arr) arr.push(row.pmo_label);
    else m.set(id, [row.pmo_label]);
  }
  return m;
}

/** Add a tracking label to a record. */
export async function addTrackingLabel(
  recordType: string,
  recordId: string,
  label: string,
): Promise<TrackingLabel> {
  const id = norm(recordId);
  return dv.create<TrackingLabel>(SET, {
    pmo_name: label,           // primary-name column (required by Dataverse)
    pmo_label: label,
    pmo_recordtype: recordType,
    pmo_recordid: id,
  });
}

/**
 * Remove a tracking label by its row ID.
 * Hard delete — pmo_tracking rows are tiny join records with no historical value;
 * soft-deactivate would leave orphan rows on a label rename.
 */
export async function removeTrackingLabel(trackingId: string): Promise<void> {
  return dv.remove(SET, trackingId);
}
