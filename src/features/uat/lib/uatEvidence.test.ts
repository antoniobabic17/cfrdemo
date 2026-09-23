/**
 * uatEvidence — the wrapper's own contract (T030).
 *
 * The entity mapping is deliberately NOT mocked: `spTypeForUatEntity` runs for real, so
 * these tests fail if the wrapper's parent list and the document module's map ever drift
 * apart. Mocking it would turn the one thing worth proving into a tautology.
 *
 * T033's negative constraints — no annotation, no documentbody, no direct connector
 * call, no fetch — are asserted at the bottom of this file, over the whole feature tree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const uploadRecordDocument = vi.fn();
const listRecordDocumentsPaged = vi.fn();
const deleteRecordDocument = vi.fn();
const openRecordDocument = vi.fn();

vi.mock('../../../lib/sharePointFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/sharePointFiles')>();
  return {
    ...actual,
    uploadRecordDocument: (...a: unknown[]) => uploadRecordDocument(...a),
    listRecordDocumentsPaged: (...a: unknown[]) => listRecordDocumentsPaged(...a),
    deleteRecordDocument: (...a: unknown[]) => deleteRecordDocument(...a),
    openRecordDocument: (...a: unknown[]) => openRecordDocument(...a),
  };
});

import {
  UAT_EVIDENCE_PARENTS,
  UAT_MAX_FILE_BYTES,
  UAT_PARENT_TYPE_VALUE,
  spTypeForParent,
  evidenceRejectionReason,
  formatBytes,
  uploadUatEvidence,
  listUatEvidence,
  deleteUatEvidence,
  openUatEvidence,
  UatEvidenceRejectedError,
} from './uatEvidence';
import { UAT_PARENT_TYPE, UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';

const png = (name = 'shot.png', size = 4) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

/** A file of a stated size without allocating it — only .size is read before upload. */
const sized = (bytes: number, name = 'big.png'): File =>
  Object.defineProperty(new File([], name, { type: 'image/png' }), 'size', { value: bytes });

beforeEach(() => {
  vi.clearAllMocks();
  uploadRecordDocument.mockResolvedValue({ itemId: '77', fileName: 'shot.png', link: 'https://sp/shot.png' });
  listRecordDocumentsPaged.mockResolvedValue({ documents: [], truncated: false });
});

describe('all seven parents resolve through the document module', () => {
  it('covers exactly the seven parent kinds', () => {
    expect([...UAT_EVIDENCE_PARENTS]).toEqual([
      'TestCase', 'TestRun', 'Defect', 'Requirement', 'Cycle', 'Project', 'ImportBatch',
    ]);
  });

  it('resolves every one to a distinct SharePoint record type', () => {
    const types = UAT_EVIDENCE_PARENTS.map(spTypeForParent);
    expect(types).toEqual([
      'UAT Test Case', 'UAT Test Run', 'UAT Defect', 'UAT Requirement',
      'UAT Cycle', 'UAT Project', 'UAT Import Batch',
    ]);
    // Distinct matters: two parents sharing a record type would make one parent's
    // evidence appear on the other, since RecordType is half the read filter.
    expect(new Set(types).size).toBe(7);
  });

  it('carries the platform-assigned parent-type integer for each, never a literal', () => {
    expect(UAT_PARENT_TYPE_VALUE.TestCase).toBe(UAT_PARENT_TYPE.TestCase);
    expect(UAT_PARENT_TYPE_VALUE.ImportBatch).toBe(UAT_PARENT_TYPE.ImportBatch);
    expect(new Set(Object.values(UAT_PARENT_TYPE_VALUE)).size).toBe(7);
  });
});

describe('size rejection is one function, so every entry point says the same thing (FR-035)', () => {
  it('holds the cap recorded in research.md §2.2', () => {
    expect(UAT_MAX_FILE_BYTES).toBe(10_485_760);
  });

  it('accepts a file at the cap and rejects the byte after it', () => {
    expect(evidenceRejectionReason(sized(UAT_MAX_FILE_BYTES))).toBeNull();
    expect(evidenceRejectionReason(sized(UAT_MAX_FILE_BYTES + 1))).toContain('The limit is');
  });

  it('names the file, its size and the limit in the message', () => {
    const reason = evidenceRejectionReason(sized(15 * 1024 * 1024, 'recording.mp4'));
    expect(reason).toContain('recording.mp4');
    expect(reason).toContain('15 MB');
    expect(reason).toContain('10 MB');
  });

  it('rejects an empty file — the failure mode of a cancelled OS screen capture', () => {
    expect(evidenceRejectionReason(sized(0, 'shot.png'))).toContain('empty');
  });

  it('gives byte-identical text for the same file whatever handed it over', () => {
    // Drag, browse and paste all call this one function; there is no second message to
    // drift. Asserted by the value being a function of the file alone.
    const file = sized(20_000_000, 'evidence.zip');
    expect(evidenceRejectionReason(file)).toBe(evidenceRejectionReason(file));
  });

  it('formats sizes the way the message reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(10_485_760)).toBe('10 MB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });
});

describe('upload', () => {
  it('refuses an over-cap file before reading a byte of it', async () => {
    await expect(uploadUatEvidence({
      parent: 'TestCase', parentId: 'tc-1', file: sized(UAT_MAX_FILE_BYTES + 1),
      category: UAT_ATTACHMENT_CATEGORY.Screenshot,
    })).rejects.toThrow(UatEvidenceRejectedError);
    expect(uploadRecordDocument).not.toHaveBeenCalled();
  });

  it('routes through the document path with the resolved record type', async () => {
    await uploadUatEvidence({
      parent: 'TestRun', parentId: 'tr-1', file: png(),
      category: UAT_ATTACHMENT_CATEGORY.TestEvidence,
    });
    expect(uploadRecordDocument).toHaveBeenCalledWith('UAT Test Run', 'tr-1', expect.any(File), 'UAT Test Evidence');
  });

  it('returns the metadata row for the caller to write, and writes nothing itself', async () => {
    const { metadata } = await uploadUatEvidence({
      parent: 'Defect', parentId: 'd-1', file: png('crash.png', 2048),
      category: UAT_ATTACHMENT_CATEGORY.DefectEvidence,
    });
    expect(metadata.pmo_filename).toBe('shot.png');           // the name SharePoint gave it
    expect(metadata.pmo_filesizebytes).toBe(2048);
    expect(metadata.pmo_contenttype).toBe('image/png');
    expect(metadata.pmo_parenttype).toBe(UAT_PARENT_TYPE.Defect);
    expect(metadata.pmo_category).toBe(UAT_ATTACHMENT_CATEGORY.DefectEvidence);
    expect(metadata.pmo_sharepointitemid).toBe('77');
    expect(metadata.pmo_sharepointweburl).toBe('https://sp/shot.png');
    expect(metadata.pmo_uploadedon).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // No parent bind: which lookup to set is the service layer's call (T032), and
    // exactly one of them must be set.
    expect(Object.keys(metadata).filter((k) => k.includes('@odata.bind'))).toEqual([]);
  });

  it('stores an unknown content type as null rather than an empty string', async () => {
    const noType = new File([new Uint8Array(4)], 'blob', { type: '' });
    const { metadata } = await uploadUatEvidence({
      parent: 'Cycle', parentId: 'c-1', file: noType,
      category: UAT_ATTACHMENT_CATEGORY.Other,
    });
    expect(metadata.pmo_contenttype).toBeNull();
  });

  it('lets a SharePoint failure through — it must never degrade into a note', async () => {
    uploadRecordDocument.mockRejectedValueOnce(new Error('SharePoint 503'));
    await expect(uploadUatEvidence({
      parent: 'TestCase', parentId: 'tc-1', file: png(),
      category: UAT_ATTACHMENT_CATEGORY.Screenshot,
    })).rejects.toThrow('SharePoint 503');
  });
});

describe('list, open and delete delegate without reinterpreting', () => {
  it('lists through the paged reader and passes the truncation flag out', async () => {
    listRecordDocumentsPaged.mockResolvedValueOnce({
      documents: [{ itemId: '1', fileName: 'a.png' }], truncated: true,
    });
    const page = await listUatEvidence('Requirement', 'r-1');
    expect(listRecordDocumentsPaged).toHaveBeenCalledWith('UAT Requirement', 'r-1');
    expect(page.truncated).toBe(true);
  });

  it('deletes by list item id and opens by link', async () => {
    await deleteUatEvidence('99');
    expect(deleteRecordDocument).toHaveBeenCalledWith('99');
    openUatEvidence({ itemId: '99', fileName: 'a.png', link: 'https://sp/a.png' });
    expect(openRecordDocument).toHaveBeenCalledWith({ itemId: '99', fileName: 'a.png', link: 'https://sp/a.png' });
  });
});

// ── T033 — no parallel path, and nothing in the platform database ────────────

/**
 * The scan's scope, and why it is WIDER than T033's words.
 *
 * T033 asks for assertions "under `app/src/features/uat/`". Taken literally that scope
 * misses the module most able to break the rule: `hooks/useUatAttachments.ts` is the code
 * that actually writes the metadata row, and it lives in `src/hooks/` because every other
 * UAT hook does. A guard that cannot see the writer is a guard that passes while the
 * violation ships. The UAT api services are included for the same reason.
 *
 * Test files are excluded — they name every forbidden token in order to forbid it.
 */
const UAT_SOURCES: Record<string, string> = {
  ...import.meta.glob('/src/features/uat/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/src/hooks/useUat*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/src/api/uat*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

/**
 * Comments stripped before scanning, for the reason the panel's own guard records: several
 * of these modules NAME the forbidden mechanisms in order to explain why they are avoided,
 * and a guard that cannot tell a prohibition from a call is one that gets worked around.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const UAT_CODE: [string, string][] = Object.entries(UAT_SOURCES)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, source]) => [path, codeOf(source)]);

/** Every file whose code matches — the message names them, so a failure is actionable. */
function filesMatching(pattern: RegExp): string[] {
  return UAT_CODE.filter(([, code]) => pattern.test(code)).map(([path]) => path);
}

describe('T033 — nothing in the platform database (FR-031, SC-005)', () => {
  it('scans a non-trivial number of real modules', () => {
    // A glob that silently matched nothing would make every assertion below vacuous — the
    // way a source guard turns green without guarding anything.
    expect(UAT_CODE.length).toBeGreaterThan(20);
    expect(UAT_CODE.some(([p]) => p.endsWith('/uatEvidence.ts'))).toBe(true);
    expect(UAT_CODE.some(([p]) => p.endsWith('/useUatAttachments.ts'))).toBe(true);
  });

  it('writes no annotation, anywhere', () => {
    // The facade's fallback writes one on ANY SharePoint error. Zero occurrences is the
    // only assertion that survives a future caller reaching for it "just for this case".
    expect(filesMatching(/annotation/i)).toEqual([]);
  });

  it('writes no documentbody or note text', () => {
    expect(filesMatching(/documentbody|notetext|isdocument/i)).toEqual([]);
  });

  it('writes no Dataverse File or Image column', () => {
    expect(filesMatching(/uploadFileToRecord|downloadFileFromRecord|downloadImageFromRecord|deleteFileOrImageFromRecord/)).toEqual([]);
  });
});

describe('T033 — no second upload path (FR-031a)', () => {
  it('never calls the connector\'s file-create route', () => {
    // The route that stores binary bodies as text. Its op-defs, its executeAsync entry
    // point and the connector data source are all absent from the UAT tree.
    expect(filesMatching(/sharePointFileOps|CreateFile|executeAsync|SP_DATASOURCE/)).toEqual([]);
  });

  it('never touches the sharePointClient facade', () => {
    expect(filesMatching(/sharePointClient|uploadDocumentAndConfirm|\buploadDocument\b|\blistDocuments\b/)).toEqual([]);
  });

  it('reaches the document module from EXACTLY ONE place', () => {
    // "A second module composing library paths or wrapping the connector directly is a
    // failure" — so the count is the assertion, not the absence of a name.
    const importers = filesMatching(/from '[^']*lib\/sharePointFiles'/);
    expect(importers).toHaveLength(1);
    expect(importers[0]).toMatch(/uatEvidence\.ts$/);
  });

  it('composes no library path or folder of its own', () => {
    // The upload process hard-codes /AppDocuments and there is no hierarchy to build. A
    // module deriving meaning from a path is the start of the second path.
    expect(filesMatching(/AppDocuments|sites\/Nexus-PMO|GetFileByServerRelativeUrl/)).toEqual([]);
  });
});

describe('T033 — no direct network access (constitution §V)', () => {
  it('calls no fetch, XMLHttpRequest or axios', () => {
    // `fetch(` with a boundary, so react-query's refetch() — which is everywhere — is not
    // mistaken for a network call. A guard that fires on refetch gets deleted within a week.
    expect(filesMatching(/(?<![A-Za-z0-9_$.])fetch\s*\(/)).toEqual([]);
    expect(filesMatching(/XMLHttpRequest|\baxios\b|navigator\.sendBeacon/)).toEqual([]);
  });
});
