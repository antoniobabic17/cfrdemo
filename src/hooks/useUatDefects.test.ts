/**
 * T019's behavioural half: a forced failure in a REAL UAT hook surfaces a toast and
 * writes a telemetry row rather than failing silently.
 *
 * useAppMutation.test.ts already proves the wrapper does this in isolation. That is a
 * different claim. A UAT hook could import useAppMutation, pass an options object, and
 * still be miswired — an `action` omitted, the error swallowed by a caller onError, or
 * the write not actually going through the wrapper at all. Those tests would stay
 * green. This drives a real hook and asserts what the user and the admin would see.
 *
 * useUatDefects was picked because a defect write is the one a tester makes when
 * something has already gone wrong; silent failure there is the worst case.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';

vi.mock('./useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../lib/errorLog', async () => ({
  logAppError: vi.fn(),
}));

// useDataSource subscribes to the app-settings query; stub it so the hook can render
// without a ConfigurationProvider or Dataverse.
vi.mock('../lib/taskSource', () => ({
  useDataSource: () => 'custom',
  usesCustomTables: (s: string) => s === 'custom' || s === 'sharepoint',
}));

const createUatDefect = vi.fn();
const deleteUatDefect = vi.fn();
vi.mock('../api/uatDefects.api', () => ({
  listUatDefectsByProject: vi.fn(),
  listUatDefectsByTestCase: vi.fn(),
  listUatDefectsByTestRun: vi.fn(),
  getUatDefect: vi.fn(),
  createUatDefect: (...args: unknown[]) => createUatDefect(...args),
  updateUatDefect: vi.fn(),
  deleteUatDefect: (...args: unknown[]) => deleteUatDefect(...args),
}));

vi.mock('../api/uatProjectSettings.api', () => ({
  listUatProjectSetting: vi.fn(),
  createUatProjectSetting: vi.fn(),
  updateUatProjectSetting: vi.fn(),
}));

import { toast } from './useToast';
import { useCreateUatDefect, useDeleteUatDefect } from './useUatDefects';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUatDefects failure handling (T019)', () => {
  it('surfaces a toast AND an error-log context when the write fails', async () => {
    // A permission denial — the exact class that failed silently in the PROD incident
    // useAppMutation was created for.
    createUatDefect.mockRejectedValue(new Error('Principal user is missing prvCreate'));

    const { result } = renderHook(() => useCreateUatDefect(PROJECT_ID), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({ pmo_summary: 'probe' }).catch(() => undefined);
    });

    expect(toast.error).toHaveBeenCalledTimes(1);

    const [message, ctx] = vi.mocked(toast.error).mock.calls[0];
    // The message must name what the user was trying to do, not just echo the error.
    expect(message).toContain('raise UAT defect');
    // And the log row must be attributable, or Admin > Error Log is unusable.
    expect(ctx).toMatchObject({
      action: 'raise UAT defect',
      entityType: 'pmo_uatdefect',
      parentProjectId: PROJECT_ID,
    });
    expect(ctx?.rawError).toBeTruthy();
  });

  it('does not toast when the write succeeds', async () => {
    createUatDefect.mockResolvedValue({ pmo_uatdefectid: 'x' });

    const { result } = renderHook(() => useCreateUatDefect(PROJECT_ID), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ pmo_summary: 'probe' });
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejects rather than resolving, so callers can branch on failure', async () => {
    deleteUatDefect.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeleteUatDefect(PROJECT_ID), { wrapper: wrapper() });

    let threw = false;
    await act(async () => {
      await result.current.mutateAsync('some-id').catch(() => {
        threw = true;
      });
    });

    // Swallowing the rejection inside the hook would leave a caller unable to tell a
    // refused delete from a successful one.
    expect(threw).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('carries the entity id into the log context for a delete', async () => {
    deleteUatDefect.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeleteUatDefect(PROJECT_ID), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync('def-42').catch(() => undefined);
    });

    const [, ctx] = vi.mocked(toast.error).mock.calls[0];
    expect(ctx).toMatchObject({ entityId: 'def-42', entityType: 'pmo_uatdefect' });
  });
});
