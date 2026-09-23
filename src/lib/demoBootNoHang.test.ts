/**
 * TEMP verification: demo mode must never await a Power Apps host that will never
 * reply. getContext() here NEVER settles (mimics a static Azure host with no host
 * frame). Each boot-path identity/context call must still resolve in demo mode.
 * If any of these hang, the test times out — proving the boot-hang regression.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// getContext that NEVER resolves or rejects — exactly the static-host failure mode.
vi.mock('@microsoft/power-apps/app', () => ({
  getContext: () => new Promise(() => { /* never settles */ }),
}));
vi.mock('@microsoft/power-apps/data', () => ({
  getClient: () => ({
    retrieveMultipleRecordsAsync: () => new Promise(() => {}),
    retrieveRecordAsync: () => new Promise(() => {}),
    createRecordAsync: () => new Promise(() => {}),
    updateRecordAsync: () => new Promise(() => {}),
    deleteRecordAsync: () => new Promise(() => {}),
    executeAsync: () => new Promise(() => {}),
  }),
}));

import * as demoMode from './demoMode';
import { initDeepLinkContext, readDeepLinkParams, isDeepLinkAvailable } from './deepLink';
import { getCurrentUserEmail } from './sharePointConfig';
import { resolveCurrentUserId } from './dataverseClient';

beforeAll(() => {
  vi.spyOn(demoMode, 'isDemoActive').mockReturnValue(true);
  vi.spyOn(demoMode, 'isDemoModeActive').mockReturnValue(true);
});

const withTimeout = <T>(p: Promise<T>, ms = 1000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('HANG: did not settle')), ms))]);

describe('demo boot never hangs on a host that never replies', () => {
  it('initDeepLinkContext resolves without a host', async () => {
    await expect(withTimeout(initDeepLinkContext())).resolves.toBeUndefined();
    expect(isDeepLinkAvailable()).toBe(false);
  });

  it('readDeepLinkParams resolves to null without a host', async () => {
    await expect(withTimeout(readDeepLinkParams())).resolves.toBeNull();
  });

  it('getCurrentUserEmail resolves to a fake identity', async () => {
    await expect(withTimeout(getCurrentUserEmail())).resolves.toBe('demo.user@demo.example');
  });

  it('resolveCurrentUserId resolves to the seeded demo user', async () => {
    await expect(withTimeout(resolveCurrentUserId())).resolves.toBe('demo-user-1-0000-0000-000000000001');
  });
});
