import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { useAppMutation } from './useAppMutation';

// toast.error auto-logs to Dataverse via errorLog.ts. Both are heavy
// imports for a unit test -- mock them out and assert on the calls.
vi.mock('./useToast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// The suppress-toast path dynamically imports errorLog; mock that too
// so we can assert logAppError was called even when the toast was skipped.
vi.mock('../lib/errorLog', async () => ({
  logAppError: vi.fn(),
}));

import { toast } from './useToast';
import { logAppError } from '../lib/errorLog';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAppMutation', () => {
  it('resolves on success and does NOT fire a toast', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const { result } = renderHook(
      () => useAppMutation({ mutationFn: fn, action: 'do the thing' }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      await result.current.mutateAsync('vars' as unknown as never);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('fires toast.error + logAppError context on non-retryable failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('403 forbidden'));
    const { result } = renderHook(
      () => useAppMutation({
        mutationFn: fn,
        action: 'save widget',
        entityType: 'widget',
        entityId: (v: { id: string }) => v.id,
        parentProjectId: 'proj-123',
      }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      try { await result.current.mutateAsync({ id: 'wid-1' }); } catch { /* expected */ }
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [msg, ctx] = (toast.error as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0];
    expect(msg).toMatch(/save widget/);
    expect(msg).toMatch(/403 forbidden/);
    expect(ctx.action).toBe('save widget');
    expect(ctx.entityType).toBe('widget');
    expect(ctx.entityId).toBe('wid-1');
    expect(ctx.parentProjectId).toBe('proj-123');
  });

  it('retries transient errors then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('NOTEDITABLE'))
        .mockResolvedValueOnce('ok');
      const { result } = renderHook(
        () => useAppMutation({ mutationFn: fn, action: 'retry me' }),
        { wrapper: wrapper() },
      );
      let promise!: Promise<unknown>;
      act(() => {
        promise = result.current.mutateAsync('x' as unknown as never);
      });
      await vi.runAllTimersAsync();
      await promise;
      expect(fn).toHaveBeenCalledTimes(2);
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('errorMessage override wins over default', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => useAppMutation({
        mutationFn: fn,
        action: 'x',
        errorMessage: 'CUSTOM MESSAGE',
      }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      try { await result.current.mutateAsync('x' as unknown as never); } catch { /* expected */ }
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect((toast.error as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]).toBe('CUSTOM MESSAGE');
  });

  it('suppressToastPredicate skips the toast but still logs', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('already deleted'));
    const { result } = renderHook(
      () => useAppMutation({
        mutationFn: fn,
        action: 'delete widget',
        suppressToastPredicate: (err) => (err as Error).message.includes('already deleted'),
      }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      try { await result.current.mutateAsync('x' as unknown as never); } catch { /* expected */ }
    });
    // toast NOT called
    expect(toast.error).not.toHaveBeenCalled();
    // logAppError WAS called via the dynamic import path
    await waitFor(() => expect(logAppError).toHaveBeenCalledTimes(1));
  });

  it('retry:false disables retries even on transient error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('NOTEDITABLE'));
    const { result } = renderHook(
      () => useAppMutation({ mutationFn: fn, action: 'no-retry', retry: false }),
      { wrapper: wrapper() },
    );
    await act(async () => {
      try { await result.current.mutateAsync('x' as unknown as never); } catch { /* expected */ }
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
