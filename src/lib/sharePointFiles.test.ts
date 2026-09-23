/**
 * T030 — the document module now reaches the seven UAT parent kinds, and its reads page.
 *
 * What these tests are for, in order of what would actually go wrong:
 *
 *  1. **The five original record kinds must read and write EXACTLY as before.** Intake,
 *     program, project, task and feedback documents are in production through this
 *     module. Phase 6 is additive-only, so "unchanged" is asserted, not assumed — the
 *     read filter and the upload parameter set are both pinned.
 *  2. **A UAT read must not pick up ordinary documents.** T029 made the upload process
 *     persist RecordId for every record type, so a project's charter now carries
 *     `RecordID = <projectId>` too. A UAT Project read filtered on RecordID alone would
 *     return it as UAT evidence. The RecordType half of that filter is load-bearing.
 *  3. **Paging must actually page** (FR-033a), and must not spin or silently cap when
 *     the connector ignores `skip`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const retrieveMultipleRecordsAsync = vi.fn();
const deleteRecordAsync = vi.fn();
const updateRecordAsync = vi.fn();

vi.mock('@microsoft/power-apps/data', () => ({
  getClient: () => ({
    retrieveMultipleRecordsAsync: (...a: unknown[]) => retrieveMultipleRecordsAsync(...a),
    deleteRecordAsync: (...a: unknown[]) => deleteRecordAsync(...a),
    updateRecordAsync: (...a: unknown[]) => updateRecordAsync(...a),
  }),
}));

const executeAction = vi.fn();
vi.mock('./dataverseClient', () => ({
  ALL_SOURCES: ['sp'],
  executeAction: (...a: unknown[]) => executeAction(...a),
}));

vi.mock('./sharePointConfig', () => ({ SP_DATASOURCE: 'AppDocuments' }));

import {
  listRecordDocuments,
  listRecordDocumentsPaged,
  uploadRecordDocument,
  isUatRecordType,
  spTypeForEntity,
  spTypeForUatEntity,
  type SpRecordType,
} from './sharePointFiles';

/** N library rows with sequential ids, starting at `from`. */
function rows(from: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    ID: String(from + i),
    '{FilenameWithExtension}': `file-${from + i}.png`,
    '{Link}': `https://sp/AppDocuments/file-${from + i}.png`,
  }));
}

const ok = (data: Record<string, unknown>[]) => ({ success: true, data });

/** The `filter` string the module passed on call `n` (0-based). */
function filterOf(n: number): string {
  return (retrieveMultipleRecordsAsync.mock.calls[n][1] as { filter: string }).filter;
}

const UAT_TYPES: SpRecordType[] = [
  'UAT Test Case', 'UAT Test Run', 'UAT Defect', 'UAT Requirement',
  'UAT Cycle', 'UAT Project', 'UAT Import Batch',
];
const ORIGINAL_TYPES: SpRecordType[] = [
  'Intake Request', 'Program', 'Project', 'Task', 'Feedback', 'PayerIssue',
];

beforeEach(() => {
  vi.clearAllMocks();
  retrieveMultipleRecordsAsync.mockResolvedValue(ok([]));
  executeAction.mockResolvedValue({});
});

describe('the UAT record kinds are registered on the existing map', () => {
  it('registers all seven, each keyed on the RecordID column', () => {
    expect(UAT_TYPES).toHaveLength(7);
    for (const type of UAT_TYPES) expect(isUatRecordType(type)).toBe(true);
  });

  it('leaves every original kind keyed on its own id column', () => {
    for (const type of ORIGINAL_TYPES) expect(isUatRecordType(type)).toBe(false);
  });

  it('resolves each of the seven through the entity mapping', () => {
    expect(spTypeForUatEntity('pmo_uattestcase')).toBe('UAT Test Case');
    expect(spTypeForUatEntity('pmo_uattestrun')).toBe('UAT Test Run');
    expect(spTypeForUatEntity('pmo_uatdefect')).toBe('UAT Defect');
    expect(spTypeForUatEntity('pmo_uatrequirement')).toBe('UAT Requirement');
    expect(spTypeForUatEntity('pmo_uatcycle')).toBe('UAT Cycle');
    expect(spTypeForUatEntity('pmo_uatimportbatch')).toBe('UAT Import Batch');
    expect(spTypeForUatEntity('pmo_project')).toBe('UAT Project');
    expect(spTypeForUatEntity('msdyn_project')).toBe('UAT Project');
  });

  it('does not hijack the existing project mapping — the same logical name still means Project there', () => {
    // The one clause that makes the two functions necessary rather than tidy: a
    // project's charter and a project's UAT evidence are different buckets of files.
    expect(spTypeForEntity('pmo_project')).toBe('Project');
    expect(spTypeForEntity('msdyn_project')).toBe('Project');
    expect(spTypeForEntity('pmo_userfeedback')).toBe('Feedback');
    expect(spTypeForEntity('cr87a_payerissue')).toBe('PayerIssue');
    // And the UAT names are NOT resolvable through the original mapping, so a caller
    // cannot accidentally file UAT evidence as an ordinary document.
    expect(spTypeForEntity('pmo_uattestcase')).toBeUndefined();
    expect(spTypeForEntity('pmo_uatdefect')).toBeUndefined();
  });
});

describe('read filters', () => {
  it('filters a UAT read on BOTH RecordID and RecordType', async () => {
    await listRecordDocumentsPaged('UAT Test Case', 'AAA-111');
    expect(filterOf(0)).toBe("RecordID eq 'aaa-111' and RecordType eq 'UatTestCase'");
  });

  it('separates UAT Project evidence from the project\'s ordinary documents', async () => {
    // Same GUID, two buckets. Without the RecordType half these two filters would be
    // identical and a project's charter would surface as UAT evidence.
    await listRecordDocumentsPaged('UAT Project', 'p-1');
    await listRecordDocuments('Project', 'p-1');
    expect(filterOf(0)).toBe("RecordID eq 'p-1' and RecordType eq 'UatProject'");
    expect(filterOf(1)).toBe("ProjectID eq 'p-1'");
    expect(filterOf(0)).not.toBe(filterOf(1));
  });

  it('leaves each original kind\'s filter exactly as it was — id column alone', async () => {
    await listRecordDocuments('Intake Request', 'i-1');
    await listRecordDocuments('Program', 'g-1');
    await listRecordDocuments('Task', 't-1');
    await listRecordDocuments('Feedback', 'f-1');
    expect(filterOf(0)).toBe("IntakeID eq 'i-1'");
    expect(filterOf(1)).toBe("ProgramID eq 'g-1'");
    expect(filterOf(2)).toBe("TaskID eq 't-1'");
    expect(filterOf(3)).toBe("DocumentCategory eq 'f-1'");
  });

  it('escapes a quote in the record id rather than letting it close the literal', async () => {
    await listRecordDocumentsPaged('UAT Defect', "d'1");
    expect(filterOf(0)).toBe("RecordID eq 'd''1' and RecordType eq 'UatDefect'");
  });

  it('still asks for one page of 200 on the original path', async () => {
    await listRecordDocuments('Project', 'p-1');
    expect(retrieveMultipleRecordsAsync.mock.calls[0][1]).toEqual({
      filter: "ProjectID eq 'p-1'", top: 200,
    });
    expect(retrieveMultipleRecordsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('paging past the fixed page size (FR-033a)', () => {
  it('returns all 450 documents of a record that has more than one page', async () => {
    retrieveMultipleRecordsAsync
      .mockResolvedValueOnce(ok(rows(1, 200)))
      .mockResolvedValueOnce(ok(rows(201, 200)))
      .mockResolvedValueOnce(ok(rows(401, 50)));

    const page = await listRecordDocumentsPaged('UAT Test Case', 'tc-1');

    // The number is the assertion. 200 here would be the exact defect FR-033a names.
    expect(page.documents).toHaveLength(450);
    expect(page.truncated).toBe(false);
    expect(page.documents[449].fileName).toBe('file-450.png');
    expect(retrieveMultipleRecordsAsync).toHaveBeenCalledTimes(3);
    const skips = retrieveMultipleRecordsAsync.mock.calls.map((c) => (c[1] as { skip: number }).skip);
    expect(skips).toEqual([0, 200, 400]);
  });

  it('follows a skipToken when the SDK returns one, and stops sending skip', async () => {
    // The mechanism dv.list already depends on for Dataverse. Sending both an offset
    // and a continuation token is how a caller gets a silently wrong page.
    retrieveMultipleRecordsAsync
      .mockResolvedValueOnce({ success: true, data: rows(1, 200), skipToken: 'tok-1' })
      .mockResolvedValueOnce({ success: true, data: rows(201, 30), skipToken: '' });

    const page = await listRecordDocumentsPaged('UAT Cycle', 'c-1');

    expect(page.documents).toHaveLength(230);
    expect(page.truncated).toBe(false);
    const second = retrieveMultipleRecordsAsync.mock.calls[1][1] as Record<string, unknown>;
    expect(second.skipToken).toBe('tok-1');
    expect(second).not.toHaveProperty('skip');
  });

  it('stops on the first short page and reports no truncation', async () => {
    retrieveMultipleRecordsAsync.mockResolvedValueOnce(ok(rows(1, 6)));
    const page = await listRecordDocumentsPaged('UAT Test Case', 'tc-1');
    expect(page.documents).toHaveLength(6);
    expect(page.truncated).toBe(false);
    expect(retrieveMultipleRecordsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not spin, and does NOT report success, when the connector ignores skip', async () => {
    // A connector that returns page 1 forever. Looping would hang the panel; returning
    // 200 quietly would put the invisible cap back. Neither is acceptable.
    retrieveMultipleRecordsAsync.mockResolvedValue(ok(rows(1, 200)));
    const page = await listRecordDocumentsPaged('UAT Test Case', 'tc-1');
    expect(page.documents).toHaveLength(200);
    expect(page.truncated).toBe(true);
    expect(retrieveMultipleRecordsAsync).toHaveBeenCalledTimes(2);
  });

  it('drops folder rows from every page', async () => {
    retrieveMultipleRecordsAsync.mockResolvedValueOnce(ok([
      { ID: '1', '{FilenameWithExtension}': 'a.png' },
      { ID: '2', '{IsFolder}': true, '{Name}': 'a folder' },
    ]));
    const page = await listRecordDocumentsPaged('UAT Test Run', 'tr-1');
    expect(page.documents.map((d) => d.fileName)).toEqual(['a.png']);
  });

  it('throws a connector failure rather than returning an empty list', async () => {
    retrieveMultipleRecordsAsync.mockResolvedValueOnce({ success: false, error: new Error('403') });
    await expect(listRecordDocumentsPaged('UAT Defect', 'd-1')).rejects.toThrow('403');
  });
});

describe('uploads', () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });

  /** The parameter bag handed to pmo_UploadDocumentToSharePoint on call 0. */
  function params(): Record<string, unknown> {
    return executeAction.mock.calls[0][2] as Record<string, unknown>;
  }

  it('sends no per-parent id parameter for a UAT kind — RecordId is the id', async () => {
    await uploadRecordDocument('UAT Test Case', 'TC-1', png(), 'UAT Screenshot');
    const p = params();
    expect(p.RecordType).toBe('UatTestCase');
    expect(p.RecordId).toBe('tc-1');
    expect(p.DocumentCategory).toBe('UAT Screenshot');
    // No new action input, and none of the existing per-type ones repurposed.
    for (const key of ['IntakeId', 'ProgramId', 'ProjectId', 'TaskId']) {
      expect(p).not.toHaveProperty(key);
    }
  });

  it('keeps DocumentCategory free for UAT\'s own categories on every UAT kind', async () => {
    for (const type of UAT_TYPES) {
      executeAction.mockClear();
      await uploadRecordDocument(type, 'x-1', png(), 'UAT Import Source');
      expect((executeAction.mock.calls[0][2] as Record<string, unknown>).DocumentCategory)
        .toBe('UAT Import Source');
    }
  });

  it('leaves an existing record type\'s parameters exactly as they were', async () => {
    await uploadRecordDocument('Project', 'P-1', png(), 'Charter');
    const p = params();
    expect(p.RecordType).toBe('Project');
    expect(p.ProjectId).toBe('p-1');       // still sent
    expect(p.RecordId).toBe('p-1');        // still sent
    expect(p.FileName).toBe('shot.png');
    expect(p.RecordName).toBe('shot.png');
    expect(p.DocumentCategory).toBe('Charter');
    expect(p.FileContent).toBe('iVBORw==');  // base64 of the 4 PNG magic bytes
    expect(executeAction).toHaveBeenCalledWith('msdyn_projects', 'pmo_UploadDocumentToSharePoint', p);
  });

  it('still folds Feedback\'s owning id into DocumentCategory, not RecordID', async () => {
    await uploadRecordDocument('Feedback', 'F-1', png(), 'ignored');
    const p = params();
    expect(p.DocumentCategory).toBe('f-1');
    expect(p.RecordType).toBe('Feedback');
  });

  it('reads every page when checking a UAT record for a filename collision', async () => {
    // The 201st file must not be handed a name the 1st already has.
    retrieveMultipleRecordsAsync
      .mockResolvedValueOnce(ok(rows(1, 200)))
      .mockResolvedValueOnce(ok([{ ID: '201', '{FilenameWithExtension}': 'shot.png' }]));
    const doc = await uploadRecordDocument('UAT Test Case', 'tc-1', png());
    expect(retrieveMultipleRecordsAsync).toHaveBeenCalledTimes(2);
    expect(doc.fileName).toBe('shot (1).png');
  });
});
