import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTimeout, DEFAULT_TIMEOUT_MS } from './withTimeout';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves with the inner value when the inner promise resolves in time', async () => {
    const inner = Promise.resolve(42);
    const result = await withTimeout(inner, 'ok', 1000);
    expect(result).toBe(42);
  });

  it('rejects with the inner error, not the timeout, when the inner rejects', async () => {
    const inner = Promise.reject(new Error('inner boom'));
    await expect(withTimeout(inner, 'label', 1000)).rejects.toThrow('inner boom');
  });

  it('rejects with a Timeout error after the deadline for a never-settling promise', async () => {
    const inner = new Promise(() => { /* never resolves */ });
    const p = withTimeout(inner as Promise<number>, 'operation X', 5_000);
    vi.advanceTimersByTime(5_001);
    await expect(p).rejects.toThrow(/Timeout after 5s: operation X/);
  });

  it('DEFAULT_TIMEOUT_MS is 60 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(60_000);
  });
});
