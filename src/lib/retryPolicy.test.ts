import { describe, it, expect, vi } from 'vitest';
import {
  isRetryableError,
  runWithRetry,
  RETRY_MAX_ATTEMPTS,
  RETRY_TRIGGER_SIGNATURES,
} from './retryPolicy';

describe('isRetryableError', () => {
  it('returns false for undefined / empty', () => {
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError('')).toBe(false);
  });

  it.each(RETRY_TRIGGER_SIGNATURES)('matches signature %s', (sig) => {
    expect(isRetryableError(`some prefix ${sig} some suffix`)).toBe(true);
  });

  it('returns false for a non-transient error', () => {
    expect(isRetryableError('Principal user is missing prvRead privilege')).toBe(false);
  });
});

describe('runWithRetry', () => {
  it('returns immediately on first-attempt success', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    expect(await runWithRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up immediately on a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('403 forbidden'));
    await expect(runWithRetry(fn)).rejects.toThrow('403 forbidden');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors up to RETRY_MAX_ATTEMPTS and eventually resolves', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('NOTEDITABLE'))
        .mockRejectedValueOnce(new Error('CorrelationId dup'))
        .mockResolvedValueOnce('ok');
      const p = runWithRetry(fn);
      await vi.runAllTimersAsync();
      expect(await p).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after RETRY_MAX_ATTEMPTS of transient errors', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn().mockRejectedValue(new Error('E_BATCHFAILED'));
      // Attach the catch BEFORE advancing timers so the eventual
      // terminal rejection has a handler and doesn't leak as
      // unhandled.
      const p = runWithRetry(fn).catch((err) => err);
      await vi.runAllTimersAsync();
      const settled = await p;
      expect(settled).toBeInstanceOf(Error);
      expect((settled as Error).message).toBe('E_BATCHFAILED');
      expect(fn).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
    } finally {
      vi.useRealTimers();
    }
  });
});
