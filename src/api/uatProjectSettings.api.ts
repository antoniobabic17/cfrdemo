/**
 * UAT per-project settings, attachments metadata, and import staging services.
 *
 * ABSENCE OF A SETTINGS ROW MEANS INHERIT. listUatProjectSetting returning an empty
 * array is the normal case, not an error — it is why this table could be introduced
 * against ~2,026 existing projects without touching any of them. Callers must treat
 * "no row" as "inherit the organisation and team toggles", never as "disabled".
 */
import * as dv from '../lib/dataverseClient';
import { projectBind, projectMatch } from '../lib/projectLookupRef';
import type { DataSource } from '../lib/taskSource';
import { UAT_ENTITY_SETS } from '../features/uat/lib/uatEntitySets';
import { UAT_PARENT_BIND_KEYS, UAT_PARENT_TYPE_FOR_BIND } from '../features/uat/lib/uatEvidence';
import type {
  UatProjectSetting,
  UatProjectSettingCreate,
  UatProjectSettingUpdate,
  UatAttachment,
  UatAttachmentCreate,
  UatImportBatch,
  UatImportBatchCreate,
  UatImportBatchUpdate,
  UatImportRow,
  UatImportRowCreate,
  UatImportRowUpdate,
} from '../models/uatDefect.model';

const SETTING_SET = UAT_ENTITY_SETS.projectSetting;
const ATTACHMENT_SET = UAT_ENTITY_SETS.attachment;
const BATCH_SET = UAT_ENTITY_SETS.importBatch;
const ROW_SET = UAT_ENTITY_SETS.importRow;

const SETTING_SELECT: string[] = [
  'pmo_uatprojectsettingid',
  'pmo_name',
  'pmo_uatenabled',
  'pmo_itprnumber',
  '_pmo_defaulttemplate_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'pmo_bypassuat',
  '_pmo_bypassdecidedby_value',
  'pmo_bypassdecidedon',
  'pmo_bypassriskid',
  'pmo_bypassdecisionid',
  'statecode',
  'statuscode',
  'createdon',
  'modifiedon',
];

const SETTING_DETAIL_SELECT: string[] = [
  ...SETTING_SELECT,
  'pmo_bypassreason',
  'pmo_bypassqaevidence',
];

const ATTACHMENT_SELECT: string[] = [
  'pmo_uatattachmentid',
  'pmo_filename',
  'pmo_filesizebytes',
  'pmo_contenttype',
  'pmo_parenttype',
  'pmo_category',
  'pmo_sharepointitemid',
  'pmo_sharepointserverrelativeurl',
  'pmo_sharepointweburl',
  '_pmo_uploadedby_value',
  'pmo_uploadedon',
  '_pmo_testcase_value',
  '_pmo_testrun_value',
  '_pmo_defect_value',
  '_pmo_requirement_value',
  '_pmo_cycle_value',
  '_pmo_importbatch_value',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'statecode',
  'statuscode',
  'createdon',
];

const BATCH_SELECT: string[] = [
  'pmo_uatimportbatchid',
  'pmo_name',
  'pmo_filename',
  '_pmo_uploadedby_value',
  'pmo_uploadedon',
  'pmo_status',
  'pmo_rowcount',
  'pmo_createdcount',
  'pmo_skippedcount',
  'pmo_failedcount',
  'pmo_idempotencykey',
  '_pmo_project_value',
  '_pmo_projectref_value',
  'statecode',
  'statuscode',
  'createdon',
];

const BATCH_DETAIL_SELECT: string[] = [...BATCH_SELECT, 'pmo_columnmapping'];

const ROW_SELECT: string[] = [
  'pmo_uatimportrowid',
  'pmo_name',
  '_pmo_batch_value',
  'pmo_sourcerownumber',
  'pmo_status',
  '_pmo_createdtestcase_value',
  'statecode',
  'statuscode',
  'createdon',
];

// pmo_rawdata is the whole parsed row and pmo_failurereason can be long; both are
// detail-only so a 500-row staging grid stays inside the gateway URL limit.
const ROW_DETAIL_SELECT: string[] = [...ROW_SELECT, 'pmo_rawdata', 'pmo_failurereason'];

// ── Project settings ────────────────────────────────────────────────────────

/**
 * The settings row for one project, or an EMPTY ARRAY if none exists.
 *
 * Matches either half of the dual project reference. Returns an array rather than
 * `UatProjectSetting | null` so the "no row" case cannot be mistaken for a failed
 * lookup by a caller that forgot to null-check.
 */
export async function listUatProjectSetting(projectId: string): Promise<UatProjectSetting[]> {
  return dv.list<UatProjectSetting>(SETTING_SET, {
    $select: SETTING_DETAIL_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $top: 1,
  });
}

export async function getUatProjectSetting(id: string): Promise<UatProjectSetting> {
  return dv.get<UatProjectSetting>(SETTING_SET, id, SETTING_DETAIL_SELECT);
}

/**
 * Create a settings row.
 *
 * The platform refuses a second row for the same project through an alternate key, so
 * a duplicate surfaces as 0x80060892 rather than as two conflicting rows. Callers
 * should read first and update if a row exists; the key is the backstop, not the flow.
 */
export async function createUatProjectSetting(
  payload: UatProjectSettingCreate,
): Promise<UatProjectSetting> {
  return dv.create<UatProjectSetting>(SETTING_SET, payload);
}

export async function updateUatProjectSetting(
  id: string,
  payload: UatProjectSettingUpdate,
): Promise<void> {
  return dv.update(SETTING_SET, id, payload);
}

/** The platform error a duplicate settings row raises — T011 measured it. */
const DUPLICATE_KEY_ERROR = '0x80060892';

/**
 * Write one project's settings, whether or not a row exists yet.
 *
 * **A double submit cannot create a second row, and the guarantor is the PLATFORM, not this
 * code.** T011 proved two single-column alternate keys on the project lookups, both index-Active,
 * and measured the error a duplicate raises: `0x80060892` — *"Entity Key Project (custom)
 * violated"*. So the sequence is read, then create-or-update, and if the create loses a race it
 * is REPLAYED as an update against the row that won. A pre-check alone would be the race; the
 * key is what closes it, and this recovers rather than pretending the race cannot happen.
 *
 * Absence of a row means inherit. This function is the only writer, so "no row" stays a
 * meaningful state rather than something a caller creates by accident.
 */
export async function upsertUatProjectSetting(
  projectId: string,
  dataSource: DataSource,
  payload: UatProjectSettingUpdate,
): Promise<string> {
  const existing = await listUatProjectSetting(projectId);
  if (existing.length > 0) {
    await updateUatProjectSetting(existing[0].pmo_uatprojectsettingid, payload);
    return existing[0].pmo_uatprojectsettingid;
  }

  try {
    const created = await createUatProjectSetting({
      ...payload,
      ...projectBind(projectId, dataSource),
    });
    return created.pmo_uatprojectsettingid;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(DUPLICATE_KEY_ERROR)) throw error;
    // Someone else's create won. Re-read and apply this caller's intent to the row that
    // exists — the operator pressed save and their change must land.
    const raced = await listUatProjectSetting(projectId);
    if (raced.length === 0) throw error;      // the key fired but no row: not ours to explain
    await updateUatProjectSetting(raced[0].pmo_uatprojectsettingid, payload);
    return raced[0].pmo_uatprojectsettingid;
  }
}

// ── Attachments (metadata only — bytes live in SharePoint) ──────────────────

export async function listUatAttachmentsByTestRun(testRunId: string): Promise<UatAttachment[]> {
  return dv.list<UatAttachment>(ATTACHMENT_SET, {
    $select: ATTACHMENT_SELECT,
    $filter: `_pmo_testrun_value eq '${testRunId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function listUatAttachmentsByTestCase(testCaseId: string): Promise<UatAttachment[]> {
  return dv.list<UatAttachment>(ATTACHMENT_SET, {
    $select: ATTACHMENT_SELECT,
    $filter: `_pmo_testcase_value eq '${testCaseId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function listUatAttachmentsByDefect(defectId: string): Promise<UatAttachment[]> {
  return dv.list<UatAttachment>(ATTACHMENT_SET, {
    $select: ATTACHMENT_SELECT,
    $filter: `_pmo_defect_value eq '${defectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

/**
 * Every active attachment row on one parent, whichever of the seven kinds it is.
 *
 * The filter is built from the lookup VALUE column, not from `pmo_parenttype`. The
 * parent-type integer is a denormalized filter key that a bad write could leave stale
 * or unset; the lookup is the fact. Reading by the fact means a row with the wrong
 * parent-type still appears on the record that actually owns it.
 *
 * `pmo_uatattachment` carries both project lookups, so the Project kind matches EITHER
 * (projectMatch) — a row written in pss mode must be visible in custom mode and back.
 */
export async function listUatAttachmentsByParent(
  parentValueColumn: string,
  parentId: string,
): Promise<UatAttachment[]> {
  const match = parentValueColumn === 'project'
    ? projectMatch(parentId)
    : `${parentValueColumn} eq '${parentId}'`;
  return dv.list<UatAttachment>(ATTACHMENT_SET, {
    $select: ATTACHMENT_SELECT,
    $filter: `${match} and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function getUatAttachment(id: string): Promise<UatAttachment> {
  return dv.get<UatAttachment>(ATTACHMENT_SET, id, ATTACHMENT_SELECT);
}

/**
 * Record attachment METADATA. This never carries file bytes: the table has no File
 * column, no Image column, and HasNotes is false. The upload itself goes through
 * lib/sharePointFiles.ts, and Phase 6's uatEvidence.ts must call that directly rather
 * than sharePointClient.ts's facade, which silently falls back to writing a Dataverse
 * annotation on any SharePoint failure.
 */
export async function createUatAttachment(payload: UatAttachmentCreate): Promise<UatAttachment> {
  assertExactlyOneParent(payload);
  return dv.create<UatAttachment>(ATTACHMENT_SET, payload);
}

/**
 * FR-033 enforced here, in the service layer, rather than trusted to callers.
 *
 * Every attachment belongs to exactly one parent. The platform will not stop a row with
 * two lookups set — nothing in Dataverse expresses "exactly one of these eight" — so a
 * caller that spread two binds would produce a file that appears on two records and is
 * counted twice in every rollup. That is a data defect no later read can undo, which is
 * why the refusal is at the write and not in a reviewer's head.
 *
 * ZERO is refused as loudly as TWO. A parentless row is invisible on every panel and
 * still occupies the library — the quiet failure, and the one a caller reaches by
 * forgetting to spread the bind at all.
 *
 * The parent-type filter key is checked against the bind rather than being trusted or
 * silently overwritten: overwriting would hide a caller's confusion about which parent it
 * is writing, and that confusion is worth surfacing.
 */
function assertExactlyOneParent(payload: UatAttachmentCreate): void {
  const bag = payload as unknown as Record<string, unknown>;
  const present = UAT_PARENT_BIND_KEYS.filter((key) => {
    const value = bag[key];
    return value !== undefined && value !== null && value !== '';
  });

  if (present.length !== 1) {
    throw new Error(
      present.length === 0
        ? 'A UAT attachment must name exactly one parent record; none was set.'
        : `A UAT attachment must name exactly one parent record; ${present.length} were set `
          + `(${present.join(', ')}).`,
    );
  }

  const expected = UAT_PARENT_TYPE_FOR_BIND[present[0]];
  if (payload.pmo_parenttype !== undefined && payload.pmo_parenttype !== null
      && payload.pmo_parenttype !== expected) {
    throw new Error(
      `The attachment's parent type (${payload.pmo_parenttype}) does not match its parent `
      + `lookup ${present[0]} (${expected}).`,
    );
  }
}

export async function deleteUatAttachment(id: string): Promise<void> {
  return dv.deactivate(ATTACHMENT_SET, id);
}

/**
 * Resolve the tester names an import file actually names to user ids.
 *
 * Only the names PRESENT in the file are queried — reading every enabled user to build a map
 * would be a large read on every import for the sake of a handful of matches, and this
 * tenant's user table is not small. Names are matched on `fullname` or
 * `internalemailaddress`, which are the two things an operator would plausibly type.
 *
 * Batched, because an OData filter is a URL and a 200-name `or` chain is how a request
 * exceeds the length the platform accepts and fails as a 400 that looks like a data problem.
 */
export async function resolveTestersByName(names: string[]): Promise<Record<string, string>> {
  const wanted = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const resolved: Record<string, string> = {};
  const BATCH = 20;

  for (let start = 0; start < wanted.length; start += BATCH) {
    const slice = wanted.slice(start, start + BATCH);
    const clauses = slice.flatMap((name) => {
      const safe = name.replace(/'/g, "''");
      return [`fullname eq '${safe}'`, `internalemailaddress eq '${safe}'`];
    });
    const users = await dv.list<{
      systemuserid: string; fullname: string | null; internalemailaddress: string | null;
    }>('systemusers', {
      $select: ['systemuserid', 'fullname', 'internalemailaddress'],
      $filter: `(${clauses.join(' or ')}) and isdisabled eq false`,
    });
    for (const user of users) {
      // Both keys are recorded, so validation can match whichever the operator typed.
      if (user.fullname) resolved[user.fullname] = user.systemuserid;
      if (user.internalemailaddress) resolved[user.internalemailaddress] = user.systemuserid;
    }
  }
  return resolved;
}

// ── Import staging ──────────────────────────────────────────────────────────

export async function listUatImportBatchesByProject(projectId: string): Promise<UatImportBatch[]> {
  return dv.list<UatImportBatch>(BATCH_SET, {
    $select: BATCH_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'createdon desc',
  });
}

export async function getUatImportBatch(id: string): Promise<UatImportBatch> {
  return dv.get<UatImportBatch>(BATCH_SET, id, BATCH_DETAIL_SELECT);
}

export async function createUatImportBatch(payload: UatImportBatchCreate): Promise<UatImportBatch> {
  return dv.create<UatImportBatch>(BATCH_SET, payload);
}

export async function updateUatImportBatch(id: string, payload: UatImportBatchUpdate): Promise<void> {
  return dv.update(BATCH_SET, id, payload);
}

/**
 * Staged rows for one batch, in SOURCE-ROW order.
 *
 * Ordered by pmo_sourcerownumber, the number the operator sees in their own file — a
 * failure report keyed to a Dataverse GUID is not actionable by the person who has to
 * fix the spreadsheet.
 */
export async function listUatImportRows(batchId: string): Promise<UatImportRow[]> {
  return dv.list<UatImportRow>(ROW_SET, {
    $select: ROW_DETAIL_SELECT,
    $filter: `_pmo_batch_value eq '${batchId}' and statecode eq 0`,
    $orderby: 'pmo_sourcerownumber asc',
  });
}

export async function getUatImportRow(id: string): Promise<UatImportRow> {
  return dv.get<UatImportRow>(ROW_SET, id, ROW_DETAIL_SELECT);
}

export async function createUatImportRow(payload: UatImportRowCreate): Promise<UatImportRow> {
  return dv.create<UatImportRow>(ROW_SET, payload);
}

export async function updateUatImportRow(id: string, payload: UatImportRowUpdate): Promise<void> {
  return dv.update(ROW_SET, id, payload);
}
