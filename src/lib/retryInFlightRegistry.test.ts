import { describe, it, expect, beforeEach } from 'vitest';
import {
  markRetryInFlight,
  clearRetryInFlight,
  isRetryInFlight,
  _resetRetryInFlight_forTests,
} from './retryInFlightRegistry';

describe('retryInFlightRegistry', () => {
  beforeEach(() => { _resetRetryInFlight_forTests(); });

  it('returns false for an unknown task', () => {
    expect(isRetryInFlight('task-a')).toBe(false);
  });

  it('marks a task in-flight and reports it', () => {
    markRetryInFlight('task-a');
    expect(isRetryInFlight('task-a')).toBe(true);
    expect(isRetryInFlight('task-b')).toBe(false);
  });

  it('clears a task', () => {
    markRetryInFlight('task-a');
    clearRetryInFlight('task-a');
    expect(isRetryInFlight('task-a')).toBe(false);
  });

  it('is idempotent on mark + clear', () => {
    markRetryInFlight('task-a');
    markRetryInFlight('task-a');
    expect(isRetryInFlight('task-a')).toBe(true);
    clearRetryInFlight('task-a');
    clearRetryInFlight('task-a');
    expect(isRetryInFlight('task-a')).toBe(false);
  });

  it('ignores empty ids', () => {
    markRetryInFlight('');
    expect(isRetryInFlight('')).toBe(false);
    clearRetryInFlight(''); // no throw
  });

  it('handles multiple in-flight tasks independently', () => {
    markRetryInFlight('a');
    markRetryInFlight('b');
    markRetryInFlight('c');
    clearRetryInFlight('b');
    expect(isRetryInFlight('a')).toBe(true);
    expect(isRetryInFlight('b')).toBe(false);
    expect(isRetryInFlight('c')).toBe(true);
  });
});
