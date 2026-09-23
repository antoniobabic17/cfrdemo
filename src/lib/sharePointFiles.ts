/**
 * SharePoint document store — Nexus-PMO / AppDocuments library.
 *
 * The app's document backend. Files are stored FLAT in the AppDocuments library
 * and linked to their owning record purely by metadata columns (querying):
 *
 *   columns: RecordType, {Intake|Program|Project|Task}ID, RecordID, DocumentCategory
 *
 * `RecordID` (added T029) holds the RecordId the upload action has always required and
 * used to discard. It is written for every record type, and it is what the seven UAT
 * parent kinds key on — so UAT needed no new column per parent and no new action input,
 * and DocumentCategory stays free to mean what it says.
 *
 * No folder structure is used: the SharePoint connector's list filters these
 * columns and does not recurse into subfolders, so nesting would hide files
 * from the read. Linking by immutable record id also makes reparenting safe.
 *
 * Mechanism (proven in the Phase A spike): the SharePoint connector is bound as
 * a tabular data source, which can't create files directly, BUT the SDK's
 * executeAsync can call the connector's CreateFile action (binary body) via the
 * hand-authored op-defs in sharePointFileOps.ts. Flow:
 *   1. executeAsync CreateFile  -> uploads bytes, returns ItemId
 *   2. updateRecordAsync         -> sets metadata columns on that item
 *   3. retrieveMultipleRecordsAsync(filter) -> read a record's files
 *   4. deleteRecordAsync(ItemId) -> delete
 * Open is via each item's {Link} (a direct SharePoint URL) — no download needed.
 */
import { getClient } from '@microsoft/power-apps/data';
import { isDemoActive } from './demoMode';
import { ALL_SOURCES, executeAction } from './dataverseClient';
import { SP_DATASOURCE } from './sharePointConfig';

function client() { return getClient(ALL_SOURCES); }

/** App record kinds that can own documents. */
export type SpRecordType =
  | 'Intake Request' | 'Program' | 'Project' | 'Task' | 'Feedback' | 'PayerIssue'
  // UAT parents (T030). Seven kinds, all keyed on the RecordID column T029 added.
  | 'UAT Test Case' | 'UAT Test Run' | 'UAT Defect' | 'UAT Requirement'
  | 'UAT Cycle' | 'UAT Project' | 'UAT Import Batch';

/** The library column a record kind's owning id is stored in. */
type SpIdColumn = 'IntakeID' | 'ProgramID' | 'ProjectID' | 'TaskID' | 'DocumentCategory' | 'RecordID';

interface SpRecordMeta {
  /** Value written to the library's RecordType column. */
  recordType: string;
  idColumn: SpIdColumn;
  /**
   * Add `RecordType eq '<recordType>'` to the read filter as well as the id column.
   *
   * Only the UAT kinds set this, and they must. All seven share one id column
   * (`RecordID`), and — because T029 made the upload process persist RecordId for
   * EVERY record type — an ordinary project document now also carries
   * `RecordID = <projectId>`. Filtering a UAT Project's evidence on RecordID alone
   * would therefore return the project's charter and status decks as UAT evidence.
   * The id column alone stays unambiguous for the five original kinds because each
   * has its own column, which is why they deliberately do NOT set this (see the
   * comment on listRecordDocuments).
   */
  alsoFilterRecordType?: true;
}

/** RecordType column value + the id column that holds the record guid. */
const RECORD_META: Record<SpRecordType, SpRecordMeta> = {
  'Intake Request': { recordType: 'Intake', idColumn: 'IntakeID' },
  'Program':        { recordType: 'Program', idColumn: 'ProgramID' },
  'Project':        { recordType: 'Project', idColumn: 'ProjectID' },
  'Task':           { recordType: 'Task',    idColumn: 'TaskID' },
  // Feedback (bug/enhancement screenshots) has no dedicated id column in the
  // library, so its owning record id lives in DocumentCategory. Filtering on
  // RecordType='Feedback' + DocumentCategory='<id>' keeps it queryable.
  'Feedback':       { recordType: 'Feedback', idColumn: 'DocumentCategory' },
  // Payer inquiries have no dedicated id column in the library (same as Feedback);
  // the owning cr87a_payerissue id lives in DocumentCategory. Filter on
  // RecordType='PayerIssue' + DocumentCategory='<id>'.
  'PayerIssue':     { recordType: 'PayerIssue', idColumn: 'DocumentCategory' },

  // ── UAT (T030) ────────────────────────────────────────────────────────────
  // Every UAT kind keys on RecordID — the general identifier column T029 added to
  // the library, written by the upload process from the RecordId input it already
  // required and previously discarded. That is what keeps DocumentCategory free to
  // hold UAT's OWN categories (Screenshot, Test Evidence, Import Source, …) rather
  // than being conscripted to hold a parent id the way Feedback and PayerIssue must.
  'UAT Test Case':    { recordType: 'UatTestCase',    idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Test Run':     { recordType: 'UatTestRun',     idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Defect':       { recordType: 'UatDefect',      idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Requirement':  { recordType: 'UatRequirement', idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Cycle':        { recordType: 'UatCycle',       idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Project':      { recordType: 'UatProject',     idColumn: 'RecordID', alsoFilterRecordType: true },
  'UAT Import Batch': { recordType: 'UatImportBatch', idColumn: 'RecordID', alsoFilterRecordType: true },
};

/** True for the seven UAT kinds — the ones keyed on RecordID. */
export function isUatRecordType(type: SpRecordType): boolean {
  return RECORD_META[type].idColumn === 'RecordID';
}

/** Map a Dataverse entity logical name to its SharePoint record type. */
export function spTypeForEntity(logicalName: string): SpRecordType | undefined {
  switch (logicalName) {
    case 'msdyn_project': case 'pmo_project':          return 'Project';
    case 'msdyn_projecttask': case 'pmo_task':          return 'Task';
    case 'msdyn_projectprogram': case 'pmo_program':    return 'Program';
    case 'pmo_projectrequest':                          return 'Intake Request';
    case 'pmo_userfeedback':                            return 'Feedback';
    case 'cr87a_payerissue':                            return 'PayerIssue';
    default:                                            return undefined;
  }
}

/**
 * Map a UAT parent's Dataverse entity logical name to its SharePoint record type.
 *
 * A SIBLING of spTypeForEntity rather than six more cases inside it, for one reason
 * that is not stylistic: `pmo_project` is already mapped there, to 'Project', and it
 * has to stay that way — that mapping is what puts a project's charter in the project
 * document library. A project's UAT evidence is a different bucket of files with a
 * different RecordType, so the same logical name has to resolve two ways depending on
 * which feature is asking. Overloading one function with a mode flag would make every
 * existing caller pass one; a second function makes the caller's intent the answer.
 *
 * The other six names are UAT-only and could safely have gone in either place; they
 * live here so all seven UAT parents are found in one list.
 */
export function spTypeForUatEntity(logicalName: string): SpRecordType | undefined {
  switch (logicalName) {
    case 'pmo_uattestcase':                             return 'UAT Test Case';
    case 'pmo_uattestrun':                              return 'UAT Test Run';
    case 'pmo_uatdefect':                               return 'UAT Defect';
    case 'pmo_uatrequirement':                          return 'UAT Requirement';
    case 'pmo_uatcycle':                                return 'UAT Cycle';
    case 'pmo_uatimportbatch':                          return 'UAT Import Batch';
    case 'msdyn_project': case 'pmo_project':           return 'UAT Project';
    default:                                            return undefined;
  }
}

export interface SpDocument {
  itemId: string;
  fileName: string;
  link?: string;
  created?: string;
  modified?: string;
  fileSizeBytes?: number;
  documentCategory?: string;
  /** Lower-cased email of the file's Author (creator) — for delete gating. */
  authorEmail?: string;
  /** Lower-cased email of UploadedBy — fallback creator identity. */
  uploadedByEmail?: string;
}

const norm = (id: string) => id.replace(/[{}]/g, '').toLowerCase();

/**
 * The custom API's id-parameter name for each record type.
 *
 * `null` for the UAT kinds, and that absence is the point of T029: the action's
 * `RecordId` input is required on EVERY call and is now persisted to the library's
 * RecordID column, so a UAT upload needs no second id parameter and no new action
 * input. Nothing was added to the action's signature.
 */
const CAPI_ID_PARAM: Record<SpRecordType, 'IntakeId' | 'ProgramId' | 'ProjectId' | 'TaskId' | 'DocumentCategory' | null> = {
  'Intake Request': 'IntakeId',
  'Program': 'ProgramId',
  'Project': 'ProjectId',
  'Task': 'TaskId',
  'Feedback': 'DocumentCategory',
  'PayerIssue': 'DocumentCategory',
  'UAT Test Case': null,
  'UAT Test Run': null,
  'UAT Defect': null,
  'UAT Requirement': null,
  'UAT Cycle': null,
  'UAT Project': null,
  'UAT Import Batch': null,
};


// Base64-encode file bytes. The CreateFile op declares body as format:binary,
// so the SDK sends this string as-is (no JSON.stringify) and the connector
// decodes it. Base64 is ASCII, so it survives the runtime's `new Blob([body])`
// UTF-8 wrapping intact — a raw/latin1 string is corrupted for bytes >= 128
// (which is why text files worked but PNGs didn't).
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function emailOf(v: unknown): string | undefined {
  const e = (v as { Email?: string } | undefined)?.Email;
  return e ? e.toLowerCase() : undefined;
}

function toDoc(row: Record<string, unknown>): SpDocument {
  return {
    itemId: String(row.ID ?? row.ItemInternalId ?? ''),
    fileName: (row['{FilenameWithExtension}'] as string) ?? (row['{Name}'] as string) ?? (row.Title as string) ?? '(unnamed)',
    link: row['{Link}'] as string | undefined,
    created: row.Created as string | undefined,
    modified: row.Modified as string | undefined,
    documentCategory: row.DocumentCategory as string | undefined,
    authorEmail: emailOf(row.Author),
    uploadedByEmail: emailOf(row.UploadedBy),
  };
}

/**
 * Delete permission — mirrors the prior annotation behavior: only the file's
 * original creator OR an admin may delete. (Dataverse enforced this via record
 * ownership; SharePoint doesn't, so the app gates it here.)
 */
export function canDeleteDocument(
  doc: SpDocument,
  currentUserEmail: string | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true;
  const me = currentUserEmail?.toLowerCase();
  if (!me) return false;
  return doc.authorEmail === me || doc.uploadedByEmail === me;
}

/**
 * The connector page size for one list read, and the historical ceiling.
 *
 * `listRecordDocuments` asks for one page of this size and returns it — which is
 * exactly the fixed cap FR-033a forbids for UAT evidence. It is left in place for the
 * five original record kinds because changing what they read is outside this feature's
 * additive-only obligation; UAT reads go through listRecordDocumentsPaged instead.
 */
const SP_PAGE_SIZE = 200;

/**
 * Hard ceiling on pages per read: 100 pages = 20,000 files for one record. A record
 * with more than that has a different problem than paging, and an unbounded loop
 * against a remote list is not something to leave in a UI render path.
 */
const SP_MAX_PAGES = 100;

// ─── Demo mode: in-memory document store (session-only, no SharePoint) ────────
const demoDocs = new Map<string, SpDocument[]>();
function demoKey(type: SpRecordType, recordId: string): string {
  return `${type}:${recordId.toLowerCase()}`;
}

/** The read filter for a record kind — see SpRecordMeta.alsoFilterRecordType. */
function recordFilter(type: SpRecordType, recordId: string): string {
  const meta = RECORD_META[type];
  const safe = norm(recordId).replace(/'/g, "''");
  const byId = `${meta.idColumn} eq '${safe}'`;
  return meta.alsoFilterRecordType
    ? `${byId} and RecordType eq '${meta.recordType}'`
    : byId;
}

/** List a record's documents (metadata-filtered). Throws on connector error. */
export async function listRecordDocuments(type: SpRecordType, recordId: string): Promise<SpDocument[]> {
  if (isDemoActive()) {
    return demoDocs.get(demoKey(type, recordId)) ?? [];
  }
  // Filter by the id column ALONE (not RecordType): each id column is
  // type-specific, so this is unambiguous, and it lets a doc carried from an
  // intake request (RecordType still 'Intake') show on the converted project/
  // program too once its ProjectID/ProgramID is stamped — "show on both".
  const res = await client().retrieveMultipleRecordsAsync<Record<string, unknown>>(SP_DATASOURCE, {
    filter: recordFilter(type, recordId),
    top: SP_PAGE_SIZE,
  });
  if (!res.success) throw res.error ?? new Error('SharePoint list failed');
  return (res.data ?? []).filter((r) => !r['{IsFolder}']).map(toDoc);
}

export interface SpDocumentPage {
  documents: SpDocument[];
  /**
   * True when the read stopped before the list was exhausted — the page ceiling was
   * hit, or a page failed to advance (see below). NEVER true merely because more than
   * one page was needed.
   *
   * It exists so a partial answer can be SHOWN as partial. FR-033a's prohibition is on
   * a page size silently capping what a record appears to have; returning 200 of 300
   * files with no signal is precisely that, and dropping the whole list on the floor
   * instead would be worse for the tester who wants to see the evidence.
   */
  truncated: boolean;
}

/**
 * Every document on a record, paged past the connector's fixed page size (FR-033a).
 *
 * Two things make this more than a `while` loop around the single-page read:
 *
 *  1. **De-duplication by item id.** A `skipToken` is used when the SDK returns one —
 *     the mechanism `dv.list` already relies on for Dataverse — and `skip` otherwise.
 *     A connector that honours neither returns page 1 forever; de-duplicating makes
 *     that harmless rather than a 20,000-row phantom list.
 *  2. **A non-advance stop with `truncated: true`.** If a page contributes no new item
 *     ids, paging is not working, and the honest result is "here is what we have, and
 *     it may not be all of it". Looping on would hang; returning silently would
 *     reintroduce the invisible cap this function exists to remove.
 */
export async function listRecordDocumentsPaged(
  type: SpRecordType,
  recordId: string,
): Promise<SpDocumentPage> {
  if (isDemoActive()) {
    return { documents: demoDocs.get(demoKey(type, recordId)) ?? [], truncated: false };
  }
  const filter = recordFilter(type, recordId);
  const c = client();
  const seen = new Set<string>();
  const documents: SpDocument[] = [];

  let skipToken: string | undefined;
  for (let page = 0; page < SP_MAX_PAGES; page++) {
    const res = await c.retrieveMultipleRecordsAsync<Record<string, unknown>>(SP_DATASOURCE, {
      filter,
      top: SP_PAGE_SIZE,
      // A continuation token when the SDK gave us one, an offset otherwise. Both are
      // sent for no page: passing `skip` alongside a token is how a caller gets a
      // silently wrong page out of an OData endpoint.
      ...(skipToken ? { skipToken } : { skip: page * SP_PAGE_SIZE }),
    });
    if (!res.success) throw res.error ?? new Error('SharePoint list failed');
    skipToken = (res as { skipToken?: string }).skipToken || undefined;
    const rows = (res.data ?? []).filter((r) => !r['{IsFolder}']);
    let added = 0;
    for (const row of rows) {
      const doc = toDoc(row);
      // An item with no id cannot be de-duplicated, opened or deleted. Counting it as
      // "added" would let a page of them loop; skipping it silently would lose a real
      // file. It is kept and counted once, keyed on its position.
      const key = doc.itemId || `${page}:${doc.fileName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      documents.push(doc);
      added++;
    }
    // A short page means the list is exhausted — the normal exit, and the only one
    // that is not truncation. Checked against the raw row count, not `added`, so a
    // full page of duplicates is treated as non-advance rather than as the end.
    if ((res.data ?? []).length < SP_PAGE_SIZE) return { documents, truncated: false };
    if (added === 0) return { documents, truncated: true };
  }
  return { documents, truncated: true };
}

/** Split 'report.pdf' -> {base:'report', ext:'.pdf'}; ext '' when none. */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
}

/**
 * Non-destructive file name for a record's folder. SharePoint CreateFile
 * OVERWRITES a same-path file by default, so if the record already has a file
 * with this name we auto-suffix "(1)", "(2)", ... to preserve the existing one.
 */
async function uniqueFileName(type: SpRecordType, recordId: string, fileName: string): Promise<string> {
  let existing: Set<string>;
  try {
    // UAT reads every page: a record whose 201st file is `screenshot.png` must not be
    // handed the same name again just because the collision check stopped at 200.
    const docs = isUatRecordType(type)
      ? (await listRecordDocumentsPaged(type, recordId)).documents
      : await listRecordDocuments(type, recordId);
    existing = new Set(docs.map((d) => d.fileName.toLowerCase()));
  } catch {
    return fileName; // if we can't list, don't block the upload
  }
  if (!existing.has(fileName.toLowerCase())) return fileName;
  const { base, ext } = splitName(fileName);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** Upload a file to a record's folder + tag it with the record's metadata. */
export async function uploadRecordDocument(
  type: SpRecordType,
  recordId: string,
  file: File,
  documentCategory?: string,
): Promise<SpDocument> {
  if (isDemoActive()) {
    const doc: SpDocument = {
      itemId: `demo-doc-${Date.now()}`,
      fileName: file.name,
      fileSizeBytes: file.size,
      documentCategory,
      created: new Date().toISOString(),
      authorEmail: 'demo.user@demo.example',
    };
    const key = demoKey(type, recordId);
    demoDocs.set(key, [...(demoDocs.get(key) ?? []), doc]);
    return doc;
  }
  const meta = RECORD_META[type];
  const uploadName = await uniqueFileName(type, recordId, file.name);
  const idParam = CAPI_ID_PARAM[type];
  // Upload via the pmo_UploadDocumentToSharePoint custom API (a Dataverse action
  // backed by the PMO Upload flow). The flow base64-decodes FileContent to real
  // bytes (@base64ToBinary) and sets the metadata columns — the ONLY reliable
  // way to write binary files from a Code App (the connector CreateFile path
  // stores the body as text; see docs plan). RecordId is required by the API.
  const params: Record<string, unknown> = {
    FileName: uploadName,
    FileContent: await fileToBase64(file),
    RecordType: meta.recordType,
    RecordId: norm(recordId),
    RecordName: uploadName,
  };
  // Null for the UAT kinds — RecordId above is the id, persisted to the library's
  // RecordID column by the process itself. See CAPI_ID_PARAM.
  if (idParam) params[idParam] = norm(recordId);
  if (documentCategory && idParam !== 'DocumentCategory') params.DocumentCategory = documentCategory;

  // Call through 'msdyn_projects' — the data source the SDK operation catalog
  // binds this (unbound) custom API to, matching pmo_FlushTaskStaging /
  // pmo_EtlBulkCatchup. Calling via 'pmo_projects' fails with 'Operation ...
  // not found in data source pmo_projects'.
  await executeAction('msdyn_projects', 'pmo_UploadDocumentToSharePoint', params);

  // The custom API returns no item metadata; the file is now in AppDocuments and
  // will surface on the next list. Return a lightweight record for the UI.
  return {
    itemId: '',
    fileName: uploadName,
    fileSizeBytes: file.size,
    documentCategory,
  };
}

/** Open a document's SharePoint link in a new tab. */
export function openRecordDocument(doc: SpDocument): void {
  if (isDemoActive()) return; // no real file behind a demo document
  if (!doc.link) throw new Error('Document has no link.');
  window.open(doc.link, '_blank', 'noopener,noreferrer');
}

/** Delete a document by its list item id. */
export async function deleteRecordDocument(itemId: string): Promise<void> {
  if (isDemoActive()) {
    for (const [k, docs] of demoDocs) {
      const next = docs.filter((d) => d.itemId !== itemId);
      if (next.length !== docs.length) demoDocs.set(k, next);
    }
    return;
  }
  await client().deleteRecordAsync(SP_DATASOURCE, itemId);
}


/**
 * Carry an intake request's documents onto the project/program created from it.
 * Re-tags each intake file IN PLACE: adds the new record's id column + keeps
 * RecordType='Project'|'Program' AND leaves the original IntakeID intact, so the
 * doc shows on BOTH the intake request and the new record. Best-effort per file;
 * a failure on one doc never blocks conversion.
 */
export async function carryIntakeDocsToRecord(
  intakeId: string,
  targetType: 'Project' | 'Program',
  targetId: string,
): Promise<{ carried: number; failed: number }> {
  const c = client();
  const meta = RECORD_META[targetType];
  let carried = 0, failed = 0;
  let docs: SpDocument[] = [];
  try {
    docs = await listRecordDocuments('Intake Request', intakeId);
  } catch {
    return { carried: 0, failed: 0 };
  }
  for (const d of docs) {
    try {
      // Keep RecordType as-is (still an Intake doc) but stamp the new record's
      // id column so the project/program filter also matches it.
      const res = await c.updateRecordAsync(SP_DATASOURCE, d.itemId, { [meta.idColumn]: norm(targetId) });
      if (res.success) carried++; else failed++;
    } catch { failed++; }
  }
  return { carried, failed };
}
