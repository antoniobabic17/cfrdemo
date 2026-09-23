import { describe, it, expect } from 'vitest';
import { parseAppErrorPayload } from './errorLog';

describe('parseAppErrorPayload', () => {
  it('returns empty object for undefined input', () => {
    expect(parseAppErrorPayload(undefined)).toEqual({});
  });

  it('falls back to { message } if JSON parse fails', () => {
    expect(parseAppErrorPayload('not-json')).toEqual({ message: 'not-json' });
  });

  it('round-trips core fields', () => {
    const payload = JSON.stringify({
      kind: 'AppError',
      message: 'Save failed.',
      rawError: 'raw...',
      route: '#/projects/abc',
      action: 'staging update task',
      entityType: 'task',
      entityId: 'task-1',
      userAgent: 'Mozilla/5.0',
    });
    const out = parseAppErrorPayload(payload);
    expect(out.message).toBe('Save failed.');
    expect(out.rawError).toBe('raw...');
    expect(out.route).toBe('#/projects/abc');
    expect(out.action).toBe('staging update task');
    expect(out.entityType).toBe('task');
    expect(out.entityId).toBe('task-1');
    expect(out.userAgent).toBe('Mozilla/5.0');
  });

  it('round-trips retry-lifecycle fields (attempt/outcome/stagingRowId)', () => {
    const payload = JSON.stringify({
      kind: 'AppError',
      message: 'Task update succeeded on attempt 3.',
      attempt: 3,
      outcome: 'succeeded',
      stagingRowId: 'stg-abc-123',
    });
    const out = parseAppErrorPayload(payload);
    expect(out.attempt).toBe(3);
    expect(out.outcome).toBe('succeeded');
    expect(out.stagingRowId).toBe('stg-abc-123');
  });

  it('preserves outcome=gave-up-auto-retry', () => {
    const payload = JSON.stringify({ outcome: 'gave-up-auto-retry', attempt: 5 });
    expect(parseAppErrorPayload(payload).outcome).toBe('gave-up-auto-retry');
  });

  it('preserves outcome=abandoned', () => {
    const payload = JSON.stringify({ outcome: 'abandoned', attempt: 2 });
    expect(parseAppErrorPayload(payload).outcome).toBe('abandoned');
  });

  it('omits new fields when absent from payload', () => {
    const payload = JSON.stringify({ message: 'plain' });
    const out = parseAppErrorPayload(payload);
    expect(out.attempt).toBeUndefined();
    expect(out.outcome).toBeUndefined();
    expect(out.stagingRowId).toBeUndefined();
  });
});
