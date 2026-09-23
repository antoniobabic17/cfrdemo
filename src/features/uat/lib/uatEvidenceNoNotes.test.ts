/**
 * T033's behavioural half: attaching six files writes ZERO notes.
 *
 * The source scan in uatEvidence.test.ts proves no module NAMES an annotation. This proves
 * the running path does not create one — a different claim, and the one SC-005 actually
 * makes. It drives the real attach hook six times and inspects every Dataverse write that
 * results: the entity set each one targeted, and every key in its payload.
 *
 * Separate file because it mocks `lib/dataverseClient` wholesale, and the scan file must
 * import the REAL modules it scans.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';

vi.mock('../../../hooks/useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../lib/errorLog', () => ({ logAppError: vi.fn() }));
vi.mock('../../../lib/taskSource', () => ({ useDataSource: () => 'custom' }));

const dvCreate = vi.fn();
const dvList = vi.fn();
const dvUpdate = vi.fn();
const dvDeactivate = vi.fn();
vi.mock('../../../lib/dataverseClient', () => ({
  ALL_SOURCES: ['sp'],
  executeAction: vi.fn(),
  create: (...a: unknown[]) => dvCreate(...a),
  list: (...a: unknown[]) => dvList(...a),
  get: vi.fn(),
  update: (...a: unknown[]) => dvUpdate(...a),
  deactivate: (...a: unknown[]) => dvDeactivate(...a),
}));

// The SharePoint half is stubbed: this test is about what reaches DATAVERSE. The bytes
// reaching SharePoint intact is Test-UatEvidenceByteIntegrity.ps1's job, against DEV.
const uploadRecordDocument = vi.fn();
vi.mock('../../../lib/sharePointFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/sharePointFiles')>();
  return {
    ...actual,
    uploadRecordDocument: (...a: unknown[]) => uploadRecordDocument(...a),
    listRecordDocumentsPaged: vi.fn(async () => ({ documents: [], truncated: false })),
    deleteRecordDocument: vi.fn(),
  };
});

import { useAttachUatEvidence } from '../../../hooks/useUatAttachments';
import { UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';
import { UAT_ENTITY_SETS } from './uatEntitySets';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  dvCreate.mockResolvedValue({ pmo_uatattachmentid: 'a-1' });
  dvList.mockResolvedValue([]);
  uploadRecordDocument.mockImplementation(async (_t: string, _id: string, file: File) => ({
    itemId: '', fileName: file.name, fileSizeBytes: file.size,
  }));
});

describe('attaching six files creates zero annotation rows', () => {
  it('writes six rows, all to pmo_uatattachment, and nothing to any note table', async () => {
    const { result } = renderHook(
      () => useAttachUatEvidence('TestCase', 'tc-1', 'p-1'),
      { wrapper: wrapper() },
    );

    for (let n = 1; n <= 6; n++) {
      await act(async () => {
        await result.current.mutateAsync({
          file: new File([new Uint8Array(8)], `shot-${n}.png`, { type: 'image/png' }),
          category: UAT_ATTACHMENT_CATEGORY.Screenshot,
        });
      });
    }

    // Six files in, six rows out. Six is the number that matters: the legacy ceiling was
    // five, so a cap would show here as five.
    expect(uploadRecordDocument).toHaveBeenCalledTimes(6);
    expect(dvCreate).toHaveBeenCalledTimes(6);

    const entitySets = dvCreate.mock.calls.map((c) => c[0] as string);
    expect(new Set(entitySets)).toEqual(new Set([UAT_ENTITY_SETS.attachment]));
    // Named explicitly as well: a future rename of the entity-set constant to 'annotations'
    // would satisfy the line above and violate the requirement.
    expect(entitySets.every((set) => !/annotation/i.test(set))).toBe(true);

    for (const call of dvCreate.mock.calls) {
      const payload = call[1] as Record<string, unknown>;
      const keys = Object.keys(payload).join(' ');
      expect(keys).not.toMatch(/documentbody|notetext|isdocument|mimetype|annotation/i);
      // And the bytes are not smuggled in under any key: no value is a long string.
      for (const value of Object.values(payload)) {
        if (typeof value === 'string') expect(value.length).toBeLessThan(300);
      }
    }
  });

  it('writes nothing at all to Dataverse when SharePoint refuses', async () => {
    // The failure mode the facade turns into a note. Here it must leave no row of any kind.
    uploadRecordDocument.mockRejectedValue(new Error('SharePoint 503'));
    const { result } = renderHook(
      () => useAttachUatEvidence('TestCase', 'tc-1'),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await expect(result.current.mutateAsync({
        file: new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' }),
        category: UAT_ATTACHMENT_CATEGORY.Screenshot,
      })).rejects.toThrow('SharePoint 503');
    });
    expect(dvCreate).not.toHaveBeenCalled();
    expect(dvUpdate).not.toHaveBeenCalled();
  });
});
