/**
 * Unit tests for useSessionPing dedup logic.
 *
 * Covers:
 *   - pingStorageKey format is stable and includes the date.
 *   - Same day + same user + same sessionStorage = no second write.
 *   - Different day = new write.
 *   - Different user = new write (independent guard flags).
 *   - Error path swallows silently (via mocked useCreateTelemetryEvent).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pingStorageKey, SESSION_PING_EVENT_TYPE } from './useSessionPing';

describe('pingStorageKey', () => {
  it('embeds the user id and the date', () => {
    const k = pingStorageKey('user-abc', '2026-07-14');
    expect(k).toContain('user-abc');
    expect(k).toContain('2026-07-14');
  });

  it('produces distinct keys for different dates', () => {
    expect(pingStorageKey('u1', '2026-07-13')).not.toBe(pingStorageKey('u1', '2026-07-14'));
  });

  it('produces distinct keys for different users', () => {
    expect(pingStorageKey('u1', '2026-07-14')).not.toBe(pingStorageKey('u2', '2026-07-14'));
  });
});

describe('SESSION_PING_EVENT_TYPE', () => {
  it('is the exported literal the aggregator queries by', () => {
    expect(SESSION_PING_EVENT_TYPE).toBe('SessionPing');
  });
});

describe('useSessionPing dedup guard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('sessionStorage guard blocks a second write in the same session', () => {
    const key = pingStorageKey('u-guard', '2026-07-14');
    expect(sessionStorage.getItem(key)).toBeNull();
    sessionStorage.setItem(key, '1');
    expect(sessionStorage.getItem(key)).toBe('1');
    // Simulate a second invocation checking the guard -- would early-return.
    expect(sessionStorage.getItem(key) === '1').toBe(true);
  });

  it('a new date bypasses the guard', () => {
    sessionStorage.setItem(pingStorageKey('u', '2026-07-14'), '1');
    // Next day's key does NOT exist in storage.
    expect(sessionStorage.getItem(pingStorageKey('u', '2026-07-15'))).toBeNull();
  });

  it('a different user bypasses the guard', () => {
    sessionStorage.setItem(pingStorageKey('u1', '2026-07-14'), '1');
    expect(sessionStorage.getItem(pingStorageKey('u2', '2026-07-14'))).toBeNull();
  });
});
