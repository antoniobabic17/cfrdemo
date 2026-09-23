/**
 * useUatAttachments — the read shape, and the write order.
 *
 * The claim under test that a component test cannot make: **one** library read per record,
 * whatever the row count (FR-032 / T032). A per-row round trip would still render the same
 * panel, at ten times the cost, and the only way to notice is to count the calls.
 *
 * The write-order tests exist because the order is not reversible. Upload then record means
 * a metadata row only ever describes a file that is really there. The opposite order
 * produces a phantom attachment whenever the upload fails, which looks like evidence.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';

vi.mock('./useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../lib/errorLog', () => ({ logAppError: vi.fn() }));
vi.mock('../lib/taskSource', () => ({
  useDataSource: () => 'custom',
  usesCustomTables: (s: string) => s === 'custom' || s === 'sharepoint',
}));

const listUatAttachmentsByParent = vi.fn();
const createUatAttachment = vi.fn();
const deleteUatAttachment = vi.fn();
vi.mock('../api/uatProjectSettings.api', () => ({
  listUatAttachmentsByParent: (...a: unknown[]) => listUatAttachmentsByParent(...a),
  createUatAttachment: (...a: unknown[]) => createUatAttachment(...a),
  deleteUatAttachment: (...a: unknown[]) => deleteUatAttachment(...a),
}));

const listUatEvidence = vi.fn();
const uploadUatEvidence = vi.fn();
const deleteUatEvidence = vi.fn();
vi.mock('../features/uat/lib/uatEvidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/uat/lib/uatEvidence')>();
  return {
    ...actual,
    listUatEvidence: (...a: unknown[]) => listUatEvidence(...a),
    uploadUatEvidence: (...a: unknown[]) => uploadUatEvidence(...a),
    deleteUatEvidence: (...a: unknown[]) => deleteUatEvidence(...a),
  };
});

import { useUatEvidence, useAttachUatEvidence, useDetachUatEvidence } from './useUatAttachments';
import { UAT_ATTACHMENT_CATEGORY, UAT_PARENT_TYPE } from '../lib/uatOptionSets';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
}

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  pmo_uatattachmentid: `a-${n}`,
  pmo_filename: `shot-${n}.png`,
  pmo_filesizebytes: 100 * n,
  pmo_category: UAT_ATTACHMENT_CATEGORY.Screenshot,
  pmo_sharepointitemid: null,
  pmo_sharepointweburl: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  listUatAttachmentsByParent.mockResolvedValue([]);
  listUatEvidence.mockResolvedValue({ documents: [], truncated: false });
  createUatAttachment.mockResolvedValue({ pmo_uatattachmentid: 'a-new' });
  uploadUatEvidence.mockResolvedValue({
    document: { itemId: '', fileName: 'shot.png' },
    metadata: {
      pmo_filename: 'shot.png',
      pmo_parenttype: UAT_PARENT_TYPE.TestCase,
      pmo_category: UAT_ATTACHMENT_CATEGORY.Screenshot,
      pmo_uploadedon: '2026-08-31T00:00:00.000Z',
    },
  });
});

describe('reading a record\'s evidence', () => {
  it('reads the library ONCE for twelve rows — no per-row round trip', async () => {
    listUatAttachmentsByParent.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => row(i + 1)),
    );
    listUatEvidence.mockResolvedValue({
      documents: Array.from({ length: 12 }, (_, i) => ({
        itemId: String(100 + i), fileName: `shot-${i + 1}.png`, link: `https://sp/${i + 1}.png`,
      })),
      truncated: false,
    });

    const { result } = renderHook(() => useUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(12));

    expect(listUatEvidence).toHaveBeenCalledTimes(1);
    expect(listUatAttachmentsByParent).toHaveBeenCalledTimes(1);
    // And each row got its link from that one read.
    expect(result.current.items.every((i) => !!i.link)).toBe(true);
    expect(result.current.items[0].itemId).toBe('100');
  });

  it('filters by the parent\'s lookup value column, not by the parent-type key', async () => {
    renderHook(() => useUatEvidence('Defect', 'd-1'), { wrapper: wrapper() });
    await waitFor(() => expect(listUatAttachmentsByParent).toHaveBeenCalled());
    expect(listUatAttachmentsByParent).toHaveBeenCalledWith('_pmo_defect_value', 'd-1');
  });

  it('uses the project sentinel for a project parent, so either lookup matches', async () => {
    renderHook(() => useUatEvidence('Project', 'p-1'), { wrapper: wrapper() });
    await waitFor(() => expect(listUatAttachmentsByParent).toHaveBeenCalled());
    expect(listUatAttachmentsByParent).toHaveBeenCalledWith('project', 'p-1');
  });

  it('prefers a row\'s own stored item id and URL over the library match', async () => {
    listUatAttachmentsByParent.mockResolvedValue([
      row(1, { pmo_sharepointitemid: '999', pmo_sharepointweburl: 'https://sp/stored.png' }),
    ]);
    listUatEvidence.mockResolvedValue({
      documents: [{ itemId: '111', fileName: 'shot-1.png', link: 'https://sp/library.png' }],
      truncated: false,
    });
    const { result } = renderHook(() => useUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].itemId).toBe('999');
    expect(result.current.items[0].link).toBe('https://sp/stored.png');
  });

  it('still lists the rows when the library read fails, and says the links are gone', async () => {
    // A library outage must not read as "nothing is attached". The correct file names with
    // open unavailable is strictly better than an empty panel.
    listUatAttachmentsByParent.mockResolvedValue([row(1), row(2)]);
    listUatEvidence.mockRejectedValue(new Error('SharePoint 503'));
    const { result } = renderHook(() => useUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.linksUnavailable).toBe(true));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.isError).toBe(false);
    expect(result.current.items[0].link).toBeUndefined();
  });

  it('queries nothing until the parent record has an id', () => {
    renderHook(() => useUatEvidence('TestCase', undefined), { wrapper: wrapper() });
    expect(listUatAttachmentsByParent).not.toHaveBeenCalled();
    expect(listUatEvidence).not.toHaveBeenCalled();
  });
});

describe('attaching', () => {
  it('uploads the bytes BEFORE recording the row, and binds exactly one parent', async () => {
    const order: string[] = [];
    uploadUatEvidence.mockImplementation(async () => {
      order.push('upload');
      return { document: { itemId: '', fileName: 'shot.png' }, metadata: { pmo_filename: 'shot.png' } };
    });
    createUatAttachment.mockImplementation(async () => { order.push('record'); return {}; });

    const { result } = renderHook(() => useAttachUatEvidence('TestCase', 'tc-1', 'p-1'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        file: new File([new Uint8Array(4)], 'shot.png', { type: 'image/png' }),
        category: UAT_ATTACHMENT_CATEGORY.Screenshot,
      });
    });

    expect(order).toEqual(['upload', 'record']);
    const payload = createUatAttachment.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['pmo_TestCase@odata.bind']).toBe('/pmo_uattestcases(tc-1)');
    expect(Object.keys(payload).filter((k) => k.endsWith('@odata.bind'))).toHaveLength(1);
  });

  it('never records a row when the upload fails — no phantom attachment', async () => {
    uploadUatEvidence.mockRejectedValue(new Error('SharePoint 503'));
    const { result } = renderHook(() => useAttachUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync({
        file: new File([new Uint8Array(4)], 'shot.png'),
        category: UAT_ATTACHMENT_CATEGORY.Screenshot,
      })).rejects.toThrow('SharePoint 503');
    });
    expect(createUatAttachment).not.toHaveBeenCalled();
  });

  it('binds a project parent through the shared mode-aware helper', async () => {
    const { result } = renderHook(() => useAttachUatEvidence('Project', 'p-1'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        file: new File([new Uint8Array(4)], 'shot.png'),
        category: UAT_ATTACHMENT_CATEGORY.SignOff,
      });
    });
    const payload = createUatAttachment.mock.calls[0][0] as Record<string, unknown>;
    // 'custom' mode is stubbed above, so the pmo_project-targeted lookup is the right one.
    expect(payload['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(p-1)');
    expect(payload['pmo_Project@odata.bind']).toBeUndefined();
  });
});

describe('detaching', () => {
  it('deactivates the row BEFORE deleting the file, so a failure never leaves a dead link', async () => {
    const order: string[] = [];
    deleteUatAttachment.mockImplementation(async () => { order.push('row'); });
    deleteUatEvidence.mockImplementation(async () => { order.push('file'); });

    const { result } = renderHook(() => useDetachUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ row: row(1) as never, itemId: '77' });
    });
    expect(order).toEqual(['row', 'file']);
    expect(deleteUatEvidence).toHaveBeenCalledWith('77');
  });

  it('detaches a row whose library item never resolved rather than stranding it', async () => {
    const { result } = renderHook(() => useDetachUatEvidence('TestCase', 'tc-1'), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ row: row(1) as never, itemId: '' });
    });
    expect(deleteUatAttachment).toHaveBeenCalledWith('a-1');
    expect(deleteUatEvidence).not.toHaveBeenCalled();
  });
});
