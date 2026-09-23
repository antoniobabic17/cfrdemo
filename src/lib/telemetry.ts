export interface MiraMutationFailureTelemetry {
  eventName: 'mira.mutation.failed';
  telemetryId: string;
  topicId: 'report-bug' | 'suggest-enhancement' | 'submit-intake-request';
  requestType: string;
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
  createdBy: string;
  createdAt: string;
  occurredAt: string;
  errorMessage: string;
}

export function emitBrowserTelemetryEvent(eventType: string, detail: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventType, { detail }));
}

export function trackMiraMutationFailure(payload: MiraMutationFailureTelemetry): void {
  // Central sink for mutation failure telemetry while backend transport is pending.
  console.error('[mira-telemetry]', payload);
  emitBrowserTelemetryEvent('mira-mutation-failure', payload);
}
