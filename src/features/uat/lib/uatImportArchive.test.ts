/**
 * T041 — the uploaded file is kept with its batch, through the evidence path.
 *
 * Two claims, and the second is the one that matters more:
 *
 *  1. It goes through the SAME evidence path as everything else — `uploadUatEvidence`, the
 *     `pmo_uatattachment` row, parented on the import batch, categorised Import Source. Not a
 *     second upload mechanism (FR-031a), which is why T033's guards still hold after this.
 *  2. **A failed archive never fails an import.** The rows are already staged and countable
 *     when this runs. Losing the source copy is a real loss and a much smaller one than
 *     refusing an import the operator has already reviewed, so the function returns an
 *     outcome and the caller says so on screen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const uploadUatEvidence = vi.fn();
vi.mock('./uatEvidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./uatEvidence')>();
  return { ...actual, uploadUatEvidence: (...a: unknown[]) => uploadUatEvidence(...a) };
});

const createUatAttachment = vi.fn();
vi.mock('../../../api/uatProjectSettings.api', () => ({
  createUatAttachment: (...a: unknown[]) => createUatAttachment(...a),
}));

import { archiveImportSource } from './uatImportArchive';
import { UAT_ATTACHMENT_CATEGORY, UAT_PARENT_TYPE } from '../../../lib/uatOptionSets';
import { UAT_MAX_FILE_BYTES } from './uatEvidence';

const csv = (name = 'cases.csv') => new File(['Title\nA\n'], name, { type: 'text/csv' });

beforeEach(() => {
  vi.clearAllMocks();
  uploadUatEvidence.mockResolvedValue({
    document: { itemId: '', fileName: 'cases.csv' },
    metadata: {
      pmo_filename: 'cases.csv',
      pmo_parenttype: UAT_PARENT_TYPE.ImportBatch,
      pmo_category: UAT_ATTACHMENT_CATEGORY.ImportSource,
      pmo_uploadedon: '2026-08-31T00:00:00.000Z',
    },
  });
  createUatAttachment.mockResolvedValue({ pmo_uatattachmentid: 'a-1' });
});

describe('the source file is attached to its batch', () => {
  it('uploads through the evidence path, as the batch\'s Import Source', async () => {
    const outcome = await archiveImportSource({ batchId: 'b-1', file: csv(), dataSource: 'custom' });

    expect(outcome).toEqual({ archived: true });
    expect(uploadUatEvidence).toHaveBeenCalledWith({
      parent: 'ImportBatch',
      parentId: 'b-1',
      file: expect.any(File),
      category: UAT_ATTACHMENT_CATEGORY.ImportSource,
    });
  });

  it('records exactly one parent — the batch', async () => {
    await archiveImportSource({ batchId: 'b-1', file: csv(), dataSource: 'custom' });
    const payload = createUatAttachment.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['pmo_ImportBatch@odata.bind']).toBe('/pmo_uatimportbatchs(b-1)');
    expect(Object.keys(payload).filter((k) => k.endsWith('@odata.bind'))).toHaveLength(1);
    expect(payload.pmo_category).toBe(UAT_ATTACHMENT_CATEGORY.ImportSource);
    expect(payload.pmo_parenttype).toBe(UAT_PARENT_TYPE.ImportBatch);
    // Says what it is, so a batch with a screenshot on it too is not ambiguous.
    expect(String(payload.pmo_description)).toMatch(/this import was created from/i);
  });
});

describe('a failed archive never fails an import', () => {
  it('returns the reason rather than throwing when the upload fails', async () => {
    uploadUatEvidence.mockRejectedValue(new Error('SharePoint 503'));
    const outcome = await archiveImportSource({ batchId: 'b-1', file: csv(), dataSource: 'custom' });
    expect(outcome).toEqual({ archived: false, reason: 'SharePoint 503' });
    expect(createUatAttachment).not.toHaveBeenCalled();
  });

  it('returns the reason when the metadata row cannot be written', async () => {
    createUatAttachment.mockRejectedValue(new Error('Dataverse 403'));
    const outcome = await archiveImportSource({ batchId: 'b-1', file: csv(), dataSource: 'custom' });
    expect(outcome).toMatchObject({ archived: false });
  });

  it('refuses an over-size file with the shared evidence message, before uploading', async () => {
    // The parser reuses this same cap, which is why a file an import accepted can always be
    // archived — the two numbers cannot drift apart because there is one number.
    const huge = Object.defineProperty(csv('huge.csv'), 'size', { value: UAT_MAX_FILE_BYTES + 1 });
    const outcome = await archiveImportSource({ batchId: 'b-1', file: huge, dataSource: 'custom' });
    expect(outcome.archived).toBe(false);
    expect((outcome as { reason: string }).reason).toContain('The limit is');
    expect(uploadUatEvidence).not.toHaveBeenCalled();
  });

  it('binds through the shell lookup in pss mode, like every other project-scoped write', async () => {
    // The batch bind itself is not project-scoped, so the mode must not change it.
    await archiveImportSource({ batchId: 'b-1', file: csv(), dataSource: 'pss' });
    const payload = createUatAttachment.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['pmo_ImportBatch@odata.bind']).toBe('/pmo_uatimportbatchs(b-1)');
  });
});
