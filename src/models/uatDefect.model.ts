/**
 * UAT defect, attachment metadata, per-project settings, and import staging.
 *
 * A DEFECT OUTLIVES THE RUN THAT FOUND IT. Every lookup on pmo_uatdefect is
 * RemoveLink and the table has no parental relationship at all: deleting a test case
 * must not erase the evidence that it failed.
 */
import type { ActiveState } from './common.model';
import type { UatExternalTrackerFields, UatProjectReferenceFields } from './uatRequirement.model';

export interface UatDefect extends ActiveState, UatExternalTrackerFields, UatProjectReferenceFields {
  pmo_uatdefectid: string;
  /** Autonumber, DEF-00000. */
  pmo_name: string;
  pmo_summary: string;
  pmo_details: string | null;
  /** Global pmo_uatdefectstatus set — the eleven states the legacy mapping produces. */
  pmo_status: number | null;
  /** Global pmo_uatdefectseverity set. Severity is how bad; priority is when. */
  pmo_severity: number | null;
  /** Global pmo_uatpriority set, shared with requirement and test case. */
  pmo_priority: number | null;
  /** Global pmo_uatoutcome set — the same vocabulary as a run result, by design. */
  pmo_retestoutcome: number | null;
  _pmo_testcase_value: string | null;
  _pmo_testrun_value: string | null;
  _pmo_requirement_value: string | null;
  _pmo_assignedto_value: string | null;
  pmo_reportedon: string | null;
  pmo_resolvedon: string | null;
  pmo_retestedon: string | null;
  pmo_closedon: string | null;
  createdon: string;
  modifiedon: string;
  /**
   * pmo_category and pmo_assignedteam are DELIBERATELY ABSENT. data-model.md names
   * both as carry-across sets (cr87a_defectcategory's 13 values, cr87a_defectteam's
   * 7) but lists no members, and those live in the PROD cr87a solution — see
   * progress.md finding 27. The columns do not exist. Any UI must omit those fields
   * rather than render an empty picker, and no speculative field belongs here.
   */
}

export interface UatDefectUpdate {
  pmo_summary?: string;
  pmo_details?: string | null;
  pmo_status?: number | null;
  pmo_severity?: number | null;
  pmo_priority?: number | null;
  pmo_retestoutcome?: number | null;
  pmo_reportedon?: string | null;
  pmo_resolvedon?: string | null;
  pmo_retestedon?: string | null;
  pmo_closedon?: string | null;
  pmo_externalsystem?: number | null;
  pmo_externalkey?: string | null;
  pmo_externalid?: string | null;
  pmo_externalurl?: string | null;
  pmo_externalstatus?: string | null;
  pmo_externalsyncedon?: string | null;
  'pmo_TestCase@odata.bind'?: string | null;
  'pmo_TestRun@odata.bind'?: string | null;
  'pmo_Requirement@odata.bind'?: string | null;
  'pmo_AssignedTo@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export interface UatDefectCreate extends UatDefectUpdate {
  pmo_summary: string;
}

/**
 * Metadata and a SharePoint pointer. NO file bytes live in Dataverse: the table has
 * no File column, no Image column, and HasNotes is false — so the annotation fallback
 * in sharePointClient.ts cannot land here whatever a caller attempts.
 *
 * EXACTLY ONE parent lookup is set per row, enforced in the service layer.
 *
 * pmo_sharepointserverrelativeurl points at a FLAT library-root path. The existing
 * upload process hard-codes folderPath "/AppDocuments", so no folder hierarchy exists
 * and nothing may derive meaning from this path.
 */
export interface UatAttachment extends ActiveState, UatProjectReferenceFields {
  pmo_uatattachmentid: string;
  pmo_filename: string;
  pmo_filesizebytes: number | null;
  pmo_contenttype: string | null;
  pmo_description: string | null;
  /** Global pmo_uatparenttype set. A denormalized FILTER key, not the source of truth. */
  pmo_parenttype: number | null;
  /** Global pmo_uatattachmentcategory set. */
  pmo_category: number | null;
  pmo_sharepointitemid: string | null;
  pmo_sharepointserverrelativeurl: string | null;
  pmo_sharepointweburl: string | null;
  _pmo_uploadedby_value: string | null;
  pmo_uploadedon: string | null;
  _pmo_testcase_value: string | null;
  _pmo_testrun_value: string | null;
  _pmo_defect_value: string | null;
  _pmo_requirement_value: string | null;
  _pmo_cycle_value: string | null;
  _pmo_importbatch_value: string | null;
  createdon: string;
}

export interface UatAttachmentCreate {
  pmo_filename: string;
  pmo_filesizebytes?: number | null;
  pmo_contenttype?: string | null;
  pmo_description?: string | null;
  pmo_parenttype?: number | null;
  pmo_category?: number | null;
  pmo_sharepointitemid?: string | null;
  pmo_sharepointserverrelativeurl?: string | null;
  pmo_sharepointweburl?: string | null;
  pmo_uploadedon?: string | null;
  'pmo_UploadedBy@odata.bind'?: string | null;
  /** Exactly one of these eight, enforced by the service layer. */
  'pmo_TestCase@odata.bind'?: string | null;
  'pmo_TestRun@odata.bind'?: string | null;
  'pmo_Defect@odata.bind'?: string | null;
  'pmo_Requirement@odata.bind'?: string | null;
  'pmo_Cycle@odata.bind'?: string | null;
  'pmo_ImportBatch@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

/**
 * Zero-or-one row per project. ABSENCE OF A ROW MEANS INHERIT, which is why this
 * table could be introduced against ~2,026 existing projects without touching any.
 *
 * Uniqueness is enforced by the PLATFORM through two single-column alternate keys —
 * one per half of the dual project reference. Not one composite: a Dataverse alternate
 * key does not enforce where a key column is null, and exactly one of the pair is ever
 * populated. See progress.md finding 22.
 */
export interface UatProjectSetting extends ActiveState, UatProjectReferenceFields {
  pmo_uatprojectsettingid: string;
  pmo_name: string | null;
  /** Third resolution step, after the organisation toggle and the team override. */
  pmo_uatenabled: boolean | null;
  /**
   * The corporate IT project number, typed by a PMO user. Externally owned: there is
   * NO system to validate or sync against, and no sync affordance may ever be added
   * (FR-044/FR-045, G-ITPR).
   */
  pmo_itprnumber: string | null;
  _pmo_defaulttemplate_value: string | null;
  pmo_bypassuat: boolean | null;
  pmo_bypassreason: string | null;
  pmo_bypassqaevidence: string | null;
  _pmo_bypassdecidedby_value: string | null;
  pmo_bypassdecidedon: string | null;
  /** 36-char GUID strings: uniqueidentifier is not a creatable custom column type. */
  pmo_bypassriskid: string | null;
  pmo_bypassdecisionid: string | null;
  createdon: string;
  modifiedon: string;
}

export interface UatProjectSettingUpdate {
  pmo_name?: string | null;
  pmo_uatenabled?: boolean | null;
  pmo_itprnumber?: string | null;
  pmo_bypassuat?: boolean | null;
  pmo_bypassreason?: string | null;
  pmo_bypassqaevidence?: string | null;
  pmo_bypassdecidedon?: string | null;
  pmo_bypassriskid?: string | null;
  pmo_bypassdecisionid?: string | null;
  'pmo_DefaultTemplate@odata.bind'?: string | null;
  'pmo_BypassDecidedBy@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export type UatProjectSettingCreate = UatProjectSettingUpdate;

/**
 * Import staging. pmo_createdtestcase IS THE IDEMPOTENCY MECHANISM: a staged row that
 * already produced a test case is skipped on re-commit, which is what makes committing
 * the same spreadsheet twice a no-op. The legacy import's sentinel was never cleared,
 * so every press of the button re-created the same 7 rows.
 *
 * Both status columns are LOCAL option sets and share their integers with each other
 * and with the global sets. Always read them through UAT_IMPORT_BATCH_STATUS /
 * UAT_IMPORT_ROW_STATUS, never by value.
 */
export interface UatImportBatch extends ActiveState, UatProjectReferenceFields {
  pmo_uatimportbatchid: string;
  /** Autonumber, IMP-00000. */
  pmo_name: string;
  pmo_filename: string | null;
  _pmo_uploadedby_value: string | null;
  pmo_uploadedon: string | null;
  /** LOCAL set: use UAT_IMPORT_BATCH_STATUS. */
  pmo_status: number | null;
  pmo_rowcount: number | null;
  pmo_createdcount: number | null;
  pmo_skippedcount: number | null;
  pmo_failedcount: number | null;
  /** The operator's hand-built header-to-field map, kept with the batch. */
  pmo_columnmapping: string | null;
  pmo_idempotencykey: string | null;
  createdon: string;
}

export interface UatImportBatchUpdate {
  pmo_filename?: string | null;
  pmo_uploadedon?: string | null;
  pmo_status?: number | null;
  pmo_rowcount?: number | null;
  pmo_createdcount?: number | null;
  pmo_skippedcount?: number | null;
  pmo_failedcount?: number | null;
  pmo_columnmapping?: string | null;
  pmo_idempotencykey?: string | null;
  'pmo_UploadedBy@odata.bind'?: string | null;
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export type UatImportBatchCreate = UatImportBatchUpdate;

export interface UatImportRow extends ActiveState {
  pmo_uatimportrowid: string;
  pmo_name: string | null;
  _pmo_batch_value: string;
  /** The row number in the operator's OWN file. Every failure must be reportable against it. */
  pmo_sourcerownumber: number | null;
  pmo_rawdata: string | null;
  /** LOCAL set: use UAT_IMPORT_ROW_STATUS. */
  pmo_status: number | null;
  pmo_failurereason: string | null;
  /** Set once this row produced a case. A row with this set is skipped on re-commit. */
  _pmo_createdtestcase_value: string | null;
  createdon: string;
}

export interface UatImportRowUpdate {
  pmo_name?: string | null;
  pmo_sourcerownumber?: number | null;
  pmo_rawdata?: string | null;
  pmo_status?: number | null;
  pmo_failurereason?: string | null;
  'pmo_CreatedTestCase@odata.bind'?: string | null;
}

export interface UatImportRowCreate extends UatImportRowUpdate {
  /** '/pmo_uatimportbatchs(<guid>)'. Cascade parent: required. Note: batchs, not batches. */
  'pmo_Batch@odata.bind': string;
}
