/**
 * Document library backed by Dataverse annotations.
 *
 * Historically this file wrapped a Power Automate flow
 * (pmo_UploadDocumentToSharePoint) that uploaded to a real SharePoint
 * library. That flow was left in Draft state and never activated, so
 * every upload silently no-op'd -- the app fabricated a SharePoint
 * URL that 404'd on click. Rather than depend on the flow (which
 * requires an activated flow + bound connection references + SharePoint
 * permissions the app user may not have), we now use the built-in
 * Dataverse annotation table -- the same mechanism the intake wizard
 * screenshot uploads and User Feedback bug reports have used for
 * months without issue.
 *
 * annotation is polymorphic: its objectid lookup points at any entity
 * whose HasNotes = True. We bind via nav property objectid_<entity>@
 * odata.bind. Verified True for msdyn_project, msdyn_projecttask,
 * msdyn_projectprogram (see scripts/probe-hasrelatednotes.py).
 *
 * Reuses:
 *   - createAttachment       (src/api/intakeAttachments.api.ts)
 *   - openAnnotationDocument (src/api/intakeAttachments.api.ts)
 *
 * The pmo_documentlink table is retired -- rows are no longer created
 * or read. The table itself stays in the Dataverse solution for now
 * until PROD's rows are triaged in a separate cleanup pass.
 */
import * as dv from './dataverseClient';
import {
  createAttachment,
  openAnnotationDocument,
  type AnnotationAttachment,
} from '../api/intakeAttachments.api';
import {
  listRecordDocuments, uploadRecordDocument, deleteRecordDocument,
  openRecordDocument, canDeleteDocument as spCanDelete,
  type SpRecordType, type SpDocument,
} from './sharePointFiles';
import { getCurrentUserEmail } from './sharePointConfig';
import { getCachedFileSource } from './fileSource';
import { isDemoActive } from './demoMode';
import { touchCustomProject } from '../api/customProjects.api';

export type RecordType = 'Intake Request' | 'Program' | 'Project' | 'Task' | 'Feedback' | 'PayerIssue';

/** Maximum annotation body size (default Dataverse cap). Files above this
 *  are rejected client-side with a friendly toast. Org admins can lift
 *  the cap in System Settings → Email tab if needed. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface DocumentItem {
  /** Dataverse annotationid GUID (annotation source) OR SharePoint list item id
   *  (sharepoint source). Primary key for delete + open. */
  annotationId: string;
  /** Which backend this doc lives in. Governs open/delete routing. */
  source?: 'annotation' | 'sharepoint';
  /** SharePoint direct URL ({Link}) for the sharepoint source. */
  link?: string;
  /** Lower-cased creator emails (sharepoint source) for delete gating. */
  authorEmail?: string;
  uploadedByEmail?: string;
  fileName: string;
  mimetype?: string;
  created: string;
  modified: string;
  fileSizeBytes: number;
  recordType: string;
  /** Set on rows whose annotation is scoped to a msdyn_projecttask.
   *  Enables grouping + task-name chip in the project's task-docs
   *  rollup column. */
  taskId?: string;
  /** Program-level roll-up context: identifies the child project this
   *  row was aggregated from. Lets the UI show a 'From: <Project>' chip
   *  and suppress destructive actions on rows the program doesn't own. */
  sourceProjectId?: string;
  sourceProjectName?: string;
}

export interface DocumentFilter {
  recordType: RecordType;
  recordId: string;
}

const RECORD_TYPE_TO_ENTITY: Record<RecordType, { logical: string; set: string }> = {
  'Project':        { logical: 'msdyn_project',        set: 'msdyn_projects' },
  'Task':           { logical: 'msdyn_projecttask',    set: 'msdyn_projecttasks' },
  'Program':        { logical: 'msdyn_projectprogram', set: 'msdyn_projectprograms' },
  'Intake Request': { logical: 'pmo_projectrequest',   set: 'pmo_projectrequests' },
  'Feedback':       { logical: 'pmo_userfeedback',     set: 'pmo_userfeedbacks' },
  'PayerIssue':     { logical: 'cr87a_payerissue',     set: 'cr87a_payerissues' },
};

// Option-C custom source: on the custom task path a task's GUID lives in
// pmo_task (not msdyn_projecttask), so annotations must bind to pmo_task or
// the AnnotationService 404s (ObjectDoesNotExist). pmo_task has HasNotes=true.
// The annotation mirror plugin keeps msdyn<->pmo notes in sync for P4W parity.
const CUSTOM_TASK_ENTITY = { logical: 'pmo_task', set: 'pmo_tasks' };
// Same for the project: a custom project has NO msdyn_project shell, so document
// annotations must bind to pmo_project (HasNotes=true, enabled during the
// decoupling). Binding to msdyn_project 404s with ObjectDoesNotExist.
const CUSTOM_PROJECT_ENTITY = { logical: 'pmo_project', set: 'pmo_projects' };

/** Resolve the annotation target entity for a record type, honoring the
 *  Option-C custom data source. Task -> pmo_task and Project -> pmo_project
 *  when custom (neither has an msdyn shell in custom mode). */
function resolveEntity(
  recordType: RecordType,
  customSource: boolean,
): { logical: string; set: string } {
  if (customSource && recordType === 'Task') return CUSTOM_TASK_ENTITY;
  if (customSource && recordType === 'Project') return CUSTOM_PROJECT_ENTITY;
  return RECORD_TYPE_TO_ENTITY[recordType];
}

/** Upload a file to SharePoint (AppDocuments), tagged with the record's
 *  metadata. Falls back to a Dataverse annotation if the SharePoint connector
 *  is unavailable, so uploads never hard-fail. */
export async function uploadDocument(
  file: File,
  target: { recordType: RecordType; recordId: string },
  customTaskSource = false,
): Promise<DocumentItem> {
  // Bump the parent project modifiedon/by when a document is attached to a
  // project, so the SLA report reflects the change (best-effort).
  if (target.recordType === 'Project') void touchCustomProject(target.recordId);
  // Deterministic routing on the pmo.file_source admin flag so uploads + links
  // always land in ONE place. 'sharepoint' => AppDocuments library; 'dataverse'
  // => Dataverse annotation. SharePoint keeps an annotation soft-fallback so an
  // upload never hard-fails if the connector is momentarily unavailable.
  if (getCachedFileSource() === 'sharepoint') {
    try {
      const doc = await uploadRecordDocument(target.recordType as SpRecordType, target.recordId, file);
      return spToItem(doc, target.recordType);
    } catch (spErr) {
      console.warn('[sharePointClient] SharePoint upload failed; falling back to annotation.', spErr);
    }
  }
  return uploadDocumentAsAnnotation(file, target, customTaskSource);
}

/**
 * Upload + confirm. SharePoint writes are async (custom API -> flow), so the
 * file does not exist the instant uploadDocument() resolves. This helper uploads
 * and then, for the SharePoint path only, polls listDocuments until the file
 * actually lands (or a timeout). Annotation writes are synchronous, so they are
 * reported confirmed immediately. Callers use `confirmed` to drive an honest
 * toast + any gating (e.g. intake Submit must wait for confirmed).
 *
 * Returns { doc, confirmed }. `confirmed=false` means the upload was accepted but
 * the file had not appeared within the budget — it will likely show up shortly.
 */
export async function uploadDocumentAndConfirm(
  file: File,
  target: { recordType: RecordType; recordId: string },
  customTaskSource = false,
  timeoutMs = 60_000,
): Promise<{ doc: DocumentItem; confirmed: boolean }> {
  const doc = await uploadDocument(file, target, customTaskSource);
  if (doc.source !== 'sharepoint') return { doc, confirmed: true };
  // Demo mode: the SharePoint write lands synchronously in the in-memory doc
  // store, so there is nothing to wait for. Confirm on a single immediate
  // re-list instead of polling with 3s sleeps (which made demo uploads feel
  // broken / slow).
  if (isDemoActive()) {
    try {
      const docs = await listDocuments(target, customTaskSource);
      const wantedNow = (file.name || '').toLowerCase();
      return { doc, confirmed: docs.some((d) => (d.fileName || '').toLowerCase() === wantedNow) };
    } catch {
      return { doc, confirmed: true };
    }
  }
  const deadline = Date.now() + timeoutMs;
  const wanted = (file.name || '').toLowerCase();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      const docs = await listDocuments(target, customTaskSource);
      if (docs.some((d) => (d.fileName || '').toLowerCase() === wanted)) return { doc, confirmed: true };
    } catch { /* keep polling */ }
  }
  return { doc, confirmed: false };
}

/** Legacy annotation upload — retained as the SharePoint soft-fallback. */
async function uploadDocumentAsAnnotation(
  file: File,
  target: { recordType: RecordType; recordId: string },
  customTaskSource = false,
): Promise<DocumentItem> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB; limit is ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB. ` +
      `Ask an admin to raise Dataverse's attachment size cap if you need to upload larger files.`,
    );
  }
  const { logical, set } = resolveEntity(target.recordType, customTaskSource);
  const row = await createAttachment(logical, set, target.recordId, file);
  return annotationToItem(row, target.recordType);  // source:'annotation'
}

/** List a record's documents from the ACTIVE source ONLY.
 *  pmo.file_source is the single source of truth: 'sharepoint' shows only
 *  AppDocuments files; 'dataverse' shows only Dataverse annotations. We do NOT
 *  merge or fall back across sources — after the SharePoint cutover, migrated
 *  files live in BOTH places (until the Phase-4 annotation delete), so merging
 *  would show every file twice and mix open/delete routing. Showing exactly the
 *  active source keeps the view consistent with where writes go. */
export async function listDocuments(filter: DocumentFilter, customTaskSource = false): Promise<DocumentItem[]> {
  const docs = getCachedFileSource() === 'sharepoint'
    ? await listSharePointDocuments(filter).catch((e) => {
        console.warn('[sharePointClient] SharePoint list failed.', e);
        return [] as DocumentItem[];
      })
    : await listAnnotationDocuments(filter, customTaskSource).catch(() => [] as DocumentItem[]);
  return docs.sort((a, b) => {
    const at = a.modified ? Date.parse(a.modified) : 0;
    const bt = b.modified ? Date.parse(b.modified) : 0;
    return bt - at;
  });
}

async function listSharePointDocuments(filter: DocumentFilter): Promise<DocumentItem[]> {
  const docs = await listRecordDocuments(filter.recordType as SpRecordType, filter.recordId);
  return docs.map((d) => spToItem(d, filter.recordType));
}

async function listAnnotationDocuments(filter: DocumentFilter, customTaskSource = false): Promise<DocumentItem[]> {
  const { logical } = resolveEntity(filter.recordType, customTaskSource);
  const rows = await dv.list<AnnotationAttachment & { objecttypecode?: string }>(
    'annotations',
    {
      $select: ['annotationid', 'filename', 'mimetype', 'filesize', 'createdon', 'modifiedon', '_objectid_value', 'objecttypecode'],
      $filter: `_objectid_value eq ${filter.recordId} and objecttypecode eq '${logical}' and isdocument eq true`,
      $orderby: 'createdon desc',
    },
  );
  return rows.map((r) => annotationToItem(r, filter.recordType));
}

/**
 * Roll-up reader for the project Documents tab. Returns every attachment
 * annotation on any task in the supplied list. Callers pass the project's
 * task ids so we build a single chunked OR clause (Dataverse has no IN).
 *
 * Mirrors the shape of listNotesForTasks in projectNotes.api.ts.
 */
export async function listTaskDocumentsForProject(taskIds: string[], customTaskSource = false): Promise<DocumentItem[]> {
  if (taskIds.length === 0) return [];
  const sortByModified = (docs: DocumentItem[]) => docs.sort((a, b) => {
    const at = a.modified ? Date.parse(a.modified) : 0;
    const bt = b.modified ? Date.parse(b.modified) : 0;
    return bt - at;
  });

  // Active-source-only, same rule as listDocuments: sharepoint => AppDocuments
  // (filtered by TaskID per task), dataverse => annotations bound to each task.
  if (getCachedFileSource() === 'sharepoint') {
    const lists = await Promise.all(
      taskIds.map((id) =>
        listRecordDocuments('Task', id)
          .then((docs) => docs.map((d) => ({ ...spToItem(d, 'Task'), taskId: id.replace(/[{}]/g, '').toLowerCase() })))
          .catch(() => [] as DocumentItem[]),
      ),
    );
    return sortByModified(lists.flat());
  }

  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += CHUNK) chunks.push(taskIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const taskTypeCode = customTaskSource ? 'pmo_task' : 'msdyn_projecttask';
      const orClause = chunk.map((id) => `_objectid_value eq ${id}`).join(' or ');
      return dv.list<AnnotationAttachment & { objecttypecode?: string }>('annotations', {
        $select: ['annotationid', 'filename', 'mimetype', 'filesize', 'createdon', 'modifiedon', '_objectid_value', 'objecttypecode'],
        $filter: `(${orClause}) and objecttypecode eq '${taskTypeCode}' and isdocument eq true`,
        $orderby: 'createdon desc',
      });
    }),
  );
  return sortByModified(results.flat().map((r) => annotationToItem(r, 'Task')));
}

/** Delete a document. Routes by source: SharePoint list item vs Dataverse
 *  annotation. Permission (creator-or-admin) is enforced by the UI via
 *  canDeleteDoc() before calling this. */
export async function deleteDocument(doc: DocumentItem | string): Promise<void> {
  // Back-compat: a bare string is a legacy annotation id.
  if (typeof doc === 'string') { await dv.remove('annotations', doc); return; }
  if (doc.source === 'sharepoint') { await deleteRecordDocument(doc.annotationId); return; }
  await dv.remove('annotations', doc.annotationId);
}

/** Open a document in a new tab. SharePoint docs open via their {Link};
 *  annotations open via a blob URL. */
export async function openDocument(doc: DocumentItem | string): Promise<void> {
  if (typeof doc === 'string') { await openAnnotationDocument(doc); return; }
  if (doc.source === 'sharepoint') { openRecordDocument({ itemId: doc.annotationId, fileName: doc.fileName, link: doc.link }); return; }
  await openAnnotationDocument(doc.annotationId);
}

/** UI delete-permission check (creator-or-admin). SharePoint docs use the
 *  captured author emails; annotation docs were owner-gated by Dataverse, so
 *  keep prior behavior (allow — server enforces). */
export async function canDeleteDoc(doc: DocumentItem, isAdmin: boolean): Promise<boolean> {
  if (doc.source !== 'sharepoint') return true; // Dataverse enforced ownership
  const email = await getCurrentUserEmail();
  return spCanDelete(
    { itemId: doc.annotationId, fileName: doc.fileName, authorEmail: doc.authorEmail, uploadedByEmail: doc.uploadedByEmail },
    email,
    isAdmin,
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── SharePoint <-> DocumentItem mapping ───

function spToItem(d: SpDocument, recordType: RecordType, taskId?: string): DocumentItem {
  return {
    annotationId: d.itemId,
    source: 'sharepoint',
    link: d.link,
    authorEmail: d.authorEmail,
    uploadedByEmail: d.uploadedByEmail,
    fileName: d.fileName,
    created: d.created ?? '',
    modified: d.modified ?? '',
    fileSizeBytes: d.fileSizeBytes ?? 0,
    recordType,
    taskId,
  };
}

// ─── internals ───

function annotationToItem(
  r: AnnotationAttachment & { objecttypecode?: string },
  recordType: RecordType | 'Task',
): DocumentItem {
  return {
    annotationId: r.annotationid,
    fileName: r.filename ?? '(unnamed)',
    mimetype: r.mimetype,
    created: r.createdon ?? '',
    modified: r.modifiedon ?? r.createdon ?? '',
    fileSizeBytes: r.filesize ?? 0,
    recordType,
    source: 'annotation',
    taskId: (r.objecttypecode === 'msdyn_projecttask' || r.objecttypecode === 'pmo_task') ? r['_objectid_value'] : undefined,
  };
}
