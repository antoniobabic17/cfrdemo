/**
 * Payer Inquiry attachments — the legacy File-column half.
 *
 * cr87a_payerissue stores its ORIGINAL (model-driven app) attachments in seven
 * fixed Dataverse File-type columns, NOT annotations or SharePoint:
 *   cr87a_supportingdocumentation
 *   cr87a_patientdocument1 .. cr87a_patientdocument6
 * Each has an auto `<col>_name` companion that holds the file name (null when
 * the slot is empty). Selecting the File column itself returns only a GUID
 * pointer — the bytes come from the SDK's downloadFileFromRecord().
 *
 * These legacy files are surfaced READ / DOWNLOAD ONLY. New uploads go through
 * the app's document system (annotations now, SharePoint later) — see
 * usePayerIssueDocuments / createAttachment('cr87a_payerissue', …). We never
 * write these File columns from the new app.
 */
import { getClient } from '@microsoft/power-apps/data';
import { ALL_SOURCES } from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';

function client() { return getClient(ALL_SOURCES); }

/** The seven legacy File-type columns, in display order. */
export const LEGACY_FILE_COLUMNS: ReadonlyArray<{ col: string; label: string }> = [
  { col: 'cr87a_supportingdocumentation', label: 'Supporting Documentation' },
  { col: 'cr87a_patientdocument1', label: 'Patient Document 1' },
  { col: 'cr87a_patientdocument2', label: 'Patient Document 2' },
  { col: 'cr87a_patientdocument3', label: 'Patient Document 3' },
  { col: 'cr87a_patientdocument4', label: 'Patient Document 4' },
  { col: 'cr87a_patientdocument5', label: 'Patient Document 5' },
  { col: 'cr87a_patientdocument6', label: 'Patient Document 6' },
];

/** The `<col>_name` companions to $select so we know which slots are populated. */
export const LEGACY_FILE_NAME_COLUMNS: ReadonlyArray<string> =
  LEGACY_FILE_COLUMNS.map((c) => `${c.col}_name`);

export interface LegacyFileAttachment {
  /** The File column logical name (also the download key). */
  column: string;
  /** The column's slot label (e.g. "Patient Document 1"). */
  slotLabel: string;
  /** The stored file name from `<col>_name`. */
  fileName: string;
}

/** Given a payer-issue record (already fetched with the `_name` columns in
 *  $select), return the populated legacy file slots. Pure — no I/O. */
export function legacyFilesFromRecord(record: Record<string, unknown>): LegacyFileAttachment[] {
  const out: LegacyFileAttachment[] = [];
  for (const { col, label } of LEGACY_FILE_COLUMNS) {
    const name = record[`${col}_name`];
    if (typeof name === 'string' && name.trim()) {
      out.push({ column: col, slotLabel: label, fileName: name });
    }
  }
  return out;
}

/**
 * Download one legacy File-column attachment and open it in a new tab.
 * Uses the SDK's downloadFileFromRecord (returns raw bytes) — the app runs on
 * powerplatformusercontent.com so a constructed /api/data $value URL 404s.
 */
export async function openLegacyFile(
  payerIssueId: string,
  column: string,
  fileName: string,
): Promise<void> {
  const res = await client().downloadFileFromRecord(
    ENTITY_SETS.payerIssue, // entity set name (matches retrieveMultipleRecordsAsync usage)
    payerIssueId,
    column,
  );
  if (!res.success || !res.data) {
    throw res.error ?? new Error('Could not download the file.');
  }
  // Copy into a fresh Uint8Array so the BlobPart is backed by a plain
  // ArrayBuffer (the SDK's typing widens to ArrayBufferLike / SharedArrayBuffer).
  const bytes = new Uint8Array(res.data as Uint8Array);
  const blob = new Blob([bytes], { type: guessMime(fileName) });
  const url = URL.createObjectURL(blob);
  // Trigger a download with the original file name (open-in-tab loses it).
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Minimal extension → MIME guess for the download blob. */
function guessMime(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'txt': return 'text/plain';
    case 'csv': return 'text/csv';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls': return 'application/vnd.ms-excel';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'msg': return 'application/vnd.ms-outlook';
    default: return 'application/octet-stream';
  }
}
