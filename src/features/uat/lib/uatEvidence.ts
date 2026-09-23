/**
 * UAT evidence — a thin wrapper over the app's EXISTING document path.
 *
 * This module owns no upload mechanism. Every byte moves through
 * `lib/sharePointFiles.ts`, which calls the `pmo_UploadDocumentToSharePoint`
 * action — the same path intake, program, project, task and feedback documents
 * have used in production. FR-031a forbids a second one, and T033 asserts the
 * absence by grep rather than trusting this comment.
 *
 * THREE THINGS THIS MODULE MUST NEVER DO, each for a measured reason:
 *
 *  1. **Call the SharePoint connector's file-create operation directly.** That route
 *     stores the request body as text. The recorded symptom in this codebase is
 *     "text files worked but PNGs didn't" — disqualifying for a feature whose primary
 *     evidence type is a screenshot (FR-031b).
 *
 *  2. **Call `lib/sharePointClient.ts`'s `uploadDocument` / `listDocuments` facade.**
 *     That facade catches ANY SharePoint upload error, emits a console.warn, and
 *     writes a Dataverse annotation instead; `listDocuments` then merges both sources
 *     so the file still appears and nothing looks wrong. For UAT that silent
 *     degradation breaches FR-031, SC-005 and T033's zero-annotation assertion —
 *     intermittently, and only when SharePoint is briefly unhappy. A SharePoint
 *     failure here MUST surface to the tester as a failure.
 *
 *  3. **Reach the network itself** — no fetch, no XMLHttpRequest, no axios
 *     (constitution §V). Data access goes through the SDK client.
 *
 * Rejection (FR-035) is a PURE function, deliberately separate from the upload, so the
 * drag, browse and paste entry points cannot drift into three different messages for
 * the same file. There is one message per reason and one place it comes from.
 */
import {
  listRecordDocumentsPaged,
  uploadRecordDocument,
  deleteRecordDocument,
  openRecordDocument,
  spTypeForUatEntity,
  type SpDocument,
  type SpDocumentPage,
  type SpRecordType,
} from '../../../lib/sharePointFiles';
import { UAT_PARENT_TYPE, UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';
import type { UatParentTypeValue, UatAttachmentCategoryValue } from '../../../lib/uatOptionSets';
import { projectBind } from '../../../lib/projectLookupRef';
import type { DataSource } from '../../../lib/taskSource';
import { UAT_ENTITY_SETS } from './uatEntitySets';
import type { UatAttachmentCreate } from '../../../models/uatDefect.model';

/** The seven record kinds that can own UAT evidence (FR-030). */
export type UatEvidenceParent =
  | 'TestCase' | 'TestRun' | 'Defect' | 'Requirement' | 'Cycle' | 'Project' | 'ImportBatch';

export const UAT_EVIDENCE_PARENTS: readonly UatEvidenceParent[] = [
  'TestCase', 'TestRun', 'Defect', 'Requirement', 'Cycle', 'Project', 'ImportBatch',
] as const;

/**
 * Per-file ceiling: 10 MB (10,485,760 bytes), set by T002 and recorded in research.md
 * §2.2 with its reasoning. Double the 5 MB annotation cap the rest of the app enforces,
 * and enforced CLIENT-SIDE because the connector cannot chunk — an over-cap file has to
 * be refused before the transfer, not discovered as a failure mid-transfer (FR-035).
 */
export const UAT_MAX_FILE_BYTES = 10_485_760;

/** The Dataverse logical name of each parent kind — the input to the entity mapping. */
export const UAT_PARENT_LOGICAL_NAME: Record<UatEvidenceParent, string> = {
  TestCase:    'pmo_uattestcase',
  TestRun:     'pmo_uattestrun',
  Defect:      'pmo_uatdefect',
  Requirement: 'pmo_uatrequirement',
  Cycle:       'pmo_uatcycle',
  Project:     'pmo_project',
  ImportBatch: 'pmo_uatimportbatch',
};

/**
 * The `pmo_uatparenttype` integer for each kind — a denormalized FILTER key on
 * pmo_uatattachment, never the source of truth for which parent is set. The lookups
 * are. Resolved from the generated option-set module, never written as a literal.
 */
export const UAT_PARENT_TYPE_VALUE: Record<UatEvidenceParent, UatParentTypeValue> = {
  TestCase:    UAT_PARENT_TYPE.TestCase,
  TestRun:     UAT_PARENT_TYPE.TestRun,
  Defect:      UAT_PARENT_TYPE.Defect,
  Requirement: UAT_PARENT_TYPE.Requirement,
  Cycle:       UAT_PARENT_TYPE.Cycle,
  Project:     UAT_PARENT_TYPE.Project,
  ImportBatch: UAT_PARENT_TYPE.ImportBatch,
};

/**
 * Resolve a UAT parent kind to its SharePoint record type through the document
 * module's own entity mapping — `logical name → SpRecordType` — rather than holding a
 * second, parallel map here. If the two ever disagree the failure is a compile error
 * (undefined is not assignable), not a file filed under a type nothing reads back.
 */
export function spTypeForParent(parent: UatEvidenceParent): SpRecordType {
  const type = spTypeForUatEntity(UAT_PARENT_LOGICAL_NAME[parent]);
  if (!type) {
    // Unreachable while the two maps agree, which the T030 test asserts for all seven.
    throw new Error(`No SharePoint record type for UAT parent '${parent}'.`);
  }
  return type;
}

/**
 * The `_..._value` column each parent kind is read back through.
 *
 * `'project'` is a sentinel, not a column: pmo_uatattachment carries BOTH project
 * lookups (pmo_Project to the msdyn shell, pmo_ProjectRef to pmo_project), so a project
 * read has to match either one. The api layer turns this sentinel into projectMatch().
 */
export const UAT_PARENT_VALUE_COLUMN: Record<UatEvidenceParent, string> = {
  TestCase:    '_pmo_testcase_value',
  TestRun:     '_pmo_testrun_value',
  Defect:      '_pmo_defect_value',
  Requirement: '_pmo_requirement_value',
  Cycle:       '_pmo_cycle_value',
  Project:     'project',
  ImportBatch: '_pmo_importbatch_value',
};

/** The lookup navigation property each non-project parent binds through. */
const UAT_PARENT_BIND_PROPERTY: Record<Exclude<UatEvidenceParent, 'Project'>, string> = {
  TestCase:    'pmo_TestCase',
  TestRun:     'pmo_TestRun',
  Defect:      'pmo_Defect',
  Requirement: 'pmo_Requirement',
  Cycle:       'pmo_Cycle',
  ImportBatch: 'pmo_ImportBatch',
};

/** The entity set each non-project parent's bind target lives in. */
const UAT_PARENT_ENTITY_SET: Record<Exclude<UatEvidenceParent, 'Project'>, string> = {
  TestCase:    UAT_ENTITY_SETS.testCase,
  TestRun:     UAT_ENTITY_SETS.testRun,
  Defect:      UAT_ENTITY_SETS.defect,
  Requirement: UAT_ENTITY_SETS.requirement,
  Cycle:       UAT_ENTITY_SETS.cycle,
  ImportBatch: UAT_ENTITY_SETS.importBatch,
};

/**
 * Every `@odata.bind` key that parents an attachment row — eight, because the project
 * parent has two (the msdyn shell and pmo_project) and a row uses whichever the current
 * data-source mode dictates.
 *
 * Exported so the SERVICE LAYER can enforce "exactly one" against this list rather than
 * against its own copy. Two copies of a lookup inventory is how a table gains a ninth
 * parent that one of them does not know about — and the guard would then pass a row with
 * two parents set.
 */
export const UAT_PARENT_BIND_KEYS: readonly string[] = [
  'pmo_TestCase@odata.bind',
  'pmo_TestRun@odata.bind',
  'pmo_Defect@odata.bind',
  'pmo_Requirement@odata.bind',
  'pmo_Cycle@odata.bind',
  'pmo_ImportBatch@odata.bind',
  'pmo_Project@odata.bind',
  'pmo_ProjectRef@odata.bind',
];

/**
 * The `pmo_parenttype` integer each bind key implies.
 *
 * `pmo_parenttype` is a denormalized filter key — the model says so — and a denormalized
 * key that disagrees with the lookup it summarises is worse than no key at all, because
 * every report reads the key and every panel reads the lookup. The service layer checks
 * the pair, so the two cannot be written out of step.
 */
export const UAT_PARENT_TYPE_FOR_BIND: Readonly<Record<string, UatParentTypeValue>> = {
  'pmo_TestCase@odata.bind': UAT_PARENT_TYPE.TestCase,
  'pmo_TestRun@odata.bind': UAT_PARENT_TYPE.TestRun,
  'pmo_Defect@odata.bind': UAT_PARENT_TYPE.Defect,
  'pmo_Requirement@odata.bind': UAT_PARENT_TYPE.Requirement,
  'pmo_Cycle@odata.bind': UAT_PARENT_TYPE.Cycle,
  'pmo_ImportBatch@odata.bind': UAT_PARENT_TYPE.ImportBatch,
  'pmo_Project@odata.bind': UAT_PARENT_TYPE.Project,
  'pmo_ProjectRef@odata.bind': UAT_PARENT_TYPE.Project,
};

/**
 * The ONE parent bind for an attachment row — a single-key object to spread into the
 * create payload (FR-033).
 *
 * Returning one key is what makes "exactly one parent" structural rather than reviewed:
 * there is no path through this function that produces two. The project case delegates
 * to the app's shared projectBind so UAT behaves identically to every other
 * project-scoped sidecar table in both data-source modes.
 */
export function uatParentBind(
  parent: UatEvidenceParent,
  parentId: string,
  dataSource: DataSource,
): Record<string, string> {
  if (parent === 'Project') return projectBind(parentId, dataSource);
  const property = UAT_PARENT_BIND_PROPERTY[parent];
  return { [`${property}@odata.bind`]: `/${UAT_PARENT_ENTITY_SET[parent]}(${parentId})` };
}

/** Bytes → "1.4 MB", for the rejection message and the file list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Why this file cannot be attached, or null if it can (FR-035).
 *
 * One function, so drag, browse and paste give the SAME message for the same file —
 * which is an explicit acceptance clause in T031, not an implementation preference.
 * Pure and synchronous: it must run before any byte is read.
 */
export function evidenceRejectionReason(file: File): string | null {
  if (file.size === 0) {
    return `"${file.name}" is empty (0 bytes) and was not attached.`;
  }
  if (file.size > UAT_MAX_FILE_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)}. The limit is `
      + `${formatBytes(UAT_MAX_FILE_BYTES)} per file — attach a smaller file or link to it instead.`;
  }
  return null;
}

/** Thrown by uploadUatEvidence when the file fails evidenceRejectionReason. */
export class UatEvidenceRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UatEvidenceRejectedError';
  }
}

export interface UatEvidenceUpload {
  parent: UatEvidenceParent;
  parentId: string;
  file: File;
  category: UatAttachmentCategoryValue;
}

/**
 * The result of a successful upload: what SharePoint holds, plus the metadata row the
 * caller must create. The metadata write is NOT done here — it belongs to a mutation
 * hook so it inherits useAppMutation's timeout, retry, toast and telemetry, and so this
 * module stays a pure wrapper over the document path with no Dataverse writes of its own.
 */
export interface UatEvidenceUploaded {
  document: SpDocument;
  /** Everything for the pmo_uatattachment row except the parent bind. */
  metadata: Omit<UatAttachmentCreate, 'pmo_uploadedon'> & { pmo_uploadedon: string };
}

/** The SharePoint DocumentCategory text for each UAT category integer. */
const CATEGORY_TEXT: Record<number, string> = {
  [UAT_ATTACHMENT_CATEGORY.Screenshot]: 'UAT Screenshot',
  [UAT_ATTACHMENT_CATEGORY.TestEvidence]: 'UAT Test Evidence',
  [UAT_ATTACHMENT_CATEGORY.DefectEvidence]: 'UAT Defect Evidence',
  [UAT_ATTACHMENT_CATEGORY.ImportSource]: 'UAT Import Source',
  [UAT_ATTACHMENT_CATEGORY.SignOff]: 'UAT Sign-off',
  [UAT_ATTACHMENT_CATEGORY.Other]: 'UAT Other',
};

/**
 * Upload one evidence file and return the metadata row to record for it.
 *
 * Rejection first, then the upload — nothing is read from an over-cap file. A
 * SharePoint failure propagates: the caller runs inside useAppMutation, which turns it
 * into an error toast and a telemetry row. It must NOT be caught and downgraded here.
 */
export async function uploadUatEvidence(input: UatEvidenceUpload): Promise<UatEvidenceUploaded> {
  const reason = evidenceRejectionReason(input.file);
  if (reason) throw new UatEvidenceRejectedError(reason);

  const document = await uploadRecordDocument(
    spTypeForParent(input.parent),
    input.parentId,
    input.file,
    CATEGORY_TEXT[input.category],
  );

  return {
    document,
    metadata: {
      pmo_filename: document.fileName,
      pmo_filesizebytes: input.file.size,
      // A pasted screenshot's Blob carries its MIME type but no name; the panel names
      // it. An OS drag of a file with no recognised extension can carry '' — stored as
      // null rather than an empty string so a reader can tell "unknown" from "empty".
      pmo_contenttype: input.file.type || null,
      pmo_parenttype: UAT_PARENT_TYPE_VALUE[input.parent],
      pmo_category: input.category,
      pmo_sharepointitemid: document.itemId || null,
      pmo_sharepointweburl: document.link ?? null,
      pmo_uploadedon: new Date().toISOString(),
    },
  };
}

/**
 * Every evidence file on one record — all pages of it (FR-033a).
 *
 * Returns the page object rather than a bare array so a caller can render the
 * `truncated` flag. Dropping it would restore the invisible cap in the one place a
 * user would have seen it.
 */
export function listUatEvidence(
  parent: UatEvidenceParent,
  parentId: string,
): Promise<SpDocumentPage> {
  return listRecordDocumentsPaged(spTypeForParent(parent), parentId);
}

/** Delete one evidence file from the library by its list item id. */
export function deleteUatEvidence(itemId: string): Promise<void> {
  return deleteRecordDocument(itemId);
}

/** Open one evidence file's SharePoint link in a new tab. */
export function openUatEvidence(doc: SpDocument): void {
  openRecordDocument(doc);
}

export type { SpDocument, SpDocumentPage };
