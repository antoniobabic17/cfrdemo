import { describe, expect, it, vi } from 'vitest';
import { emitBrowserTelemetryEvent, trackMiraMutationFailure } from './telemetry';

describe('telemetry sink utility', () => {
  it('dispatches browser telemetry events', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    emitBrowserTelemetryEvent('custom-event', { hello: 'world' });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('custom-event');
    expect(event.detail).toEqual({ hello: 'world' });

    dispatchSpy.mockRestore();
  });

  it('tracks Mira mutation failures through central sink', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    trackMiraMutationFailure({
      eventName: 'mira.mutation.failed',
      telemetryId: 'mira-mut-123',
      topicId: 'report-bug',
      requestType: 'Bug Report',
      sourceRoute: '/projects/p1',
      sourceEntityId: 'p1',
      sourceEntityType: 'project',
      createdBy: 'user-1',
      createdAt: '2026-04-19T12:00:00.000Z',
      occurredAt: '2026-04-19T12:01:00.000Z',
      errorMessage: 'Dataverse failure',
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('mira-mutation-failure');
    expect(event.detail.eventName).toBe('mira.mutation.failed');
    expect(event.detail.errorMessage).toBe('Dataverse failure');

    dispatchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
