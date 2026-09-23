import {
  createBugReportRecord,
  createEnhancementSuggestionRecord,
  prepareBugReportMutation,
  prepareEnhancementSuggestionMutation,
  prepareRetryMutation,
} from './mutations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BugReportDraft, EnhancementSuggestionDraft } from './contracts';
import { REQUEST_TYPE, REQUEST_PRIORITY, SOURCE_SYSTEM } from '../lib/constants';

vi.mock('../api/projectRequests.api', () => ({
  createProjectRequest: vi.fn(),
}));

import { createProjectRequest } from '../api/projectRequests.api';

function buildBugDraft(): BugReportDraft {
  return {
    topicId: 'report-bug',
    mode: 'draft',
    sourceRoute: '/projects/p1',
    sourceEntityId: 'p1',
    sourceEntityType: 'project',
    userDescription: 'Bug details',
    structuredDraft: 'Title: Bug in timeline\nSteps: ...',
    sourceStatus: [{ source: 'Project', state: 'ok' }],
    confidence: 'high',
    generatedAt: '2026-04-19T12:00:00.000Z',
  };
}

function buildEnhancementDraft(): EnhancementSuggestionDraft {
  return {
    topicId: 'suggest-enhancement',
    mode: 'draft',
    sourceRoute: '/programs/prg1',
    sourceEntityId: 'prg1',
    sourceEntityType: 'program',
    userDescription: 'Enhancement details',
    structuredDraft: 'Title: Better risk summary\nRequest: ...',
    sourceStatus: [{ source: 'Program', state: 'ok' }],
    confidence: 'medium',
    generatedAt: '2026-04-19T12:00:00.000Z',
  };
}

describe('Wave 3 mutation telemetry', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('captures bug mutation failures with telemetry and failure metadata', async () => {
    const mutation = prepareBugReportMutation(buildBugDraft(), 'user-1');

    const result = await createBugReportRecord(mutation, {
      createRecord: async () => {
        throw new Error('Dataverse unavailable');
      },
    });

    expect(result.creationResult).toBe('failed');
    expect(result.failureCode).toBe('BUG_REPORT_CREATE_FAILED');
    expect(result.failureReason).toContain('Dataverse unavailable');
    expect(result.telemetryId).toBeTruthy();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('mira-mutation-failure');
    expect(event.detail.eventName).toBe('mira.mutation.failed');
    expect(event.detail.topicId).toBe('report-bug');
    expect(event.detail.errorMessage).toContain('Dataverse unavailable');
  });

  it('captures enhancement mutation failures with telemetry and failure metadata', async () => {
    const mutation = prepareEnhancementSuggestionMutation(buildEnhancementDraft(), 'user-2');

    const result = await createEnhancementSuggestionRecord(mutation, {
      createRecord: async () => {
        throw new Error('Create request rejected');
      },
    });

    expect(result.creationResult).toBe('failed');
    expect(result.failureCode).toBe('ENHANCEMENT_CREATE_FAILED');
    expect(result.failureReason).toContain('Create request rejected');
    expect(result.telemetryId).toBeTruthy();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('mira-mutation-failure');
    expect(event.detail.eventName).toBe('mira.mutation.failed');
    expect(event.detail.topicId).toBe('suggest-enhancement');
    expect(event.detail.errorMessage).toContain('Create request rejected');
  });

  it('clears failure metadata on successful mutation', async () => {
    const mutation = {
      ...prepareBugReportMutation(buildBugDraft(), 'user-3'),
      creationResult: 'failed' as const,
      failureCode: 'BUG_REPORT_CREATE_FAILED',
      failureReason: 'Old failure',
      telemetryId: 'old-id',
    };

    const result = await createBugReportRecord(mutation, {
      createRecord: async () => 'bug-fixed-123',
    });

    expect(result.creationResult).toBe('success');
    expect(result.recordId).toBe('bug-fixed-123');
    expect(result.failureCode).toBeUndefined();
    expect(result.failureReason).toBeUndefined();
    expect(result.telemetryId).toBeUndefined();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('prepareRetryMutation', () => {
  it('resets failure state to pending for retry', () => {
    const failedMutation = {
      ...prepareEnhancementSuggestionMutation(buildEnhancementDraft(), 'user-4'),
      creationResult: 'failed' as const,
      failureCode: 'ENHANCEMENT_CREATE_FAILED',
      failureReason: 'Timed out',
      telemetryId: 'trace-1',
    };

    const retried = prepareRetryMutation(failedMutation);

    expect(retried.creationResult).toBe('pending');
    expect(retried.failureCode).toBeUndefined();
    expect(retried.failureReason).toBeUndefined();
    expect(retried.telemetryId).toBeUndefined();
    expect(retried.topicId).toBe('suggest-enhancement');
  });
});

describe('Dataverse write adapter payloads', () => {
  const mockCreateProjectRequest = vi.mocked(createProjectRequest);

  beforeEach(() => {
    mockCreateProjectRequest.mockReset();
  });

  it('createBugReportRecord sends priority, source system, and structured draft', async () => {
    mockCreateProjectRequest.mockResolvedValue({
      pmo_projectrequestid: 'bug-guid-001',
      pmo_name: 'Bug in timeline',
    });

    const mutation = prepareBugReportMutation(buildBugDraft(), 'user-5');
    const result = await createBugReportRecord(mutation);

    expect(result.creationResult).toBe('success');
    expect(result.recordId).toBe('bug-guid-001');
    expect(mockCreateProjectRequest).toHaveBeenCalledOnce();

    const payload = mockCreateProjectRequest.mock.calls[0][0];
    expect(payload.pmo_requesttype).toBe(REQUEST_TYPE.Support);
    expect(payload.pmo_priority).toBe(REQUEST_PRIORITY.High);
    expect(payload.pmo_sourcesystem).toBe(SOURCE_SYSTEM.CfrPmo);
    expect(payload.pmo_description).toContain('Title: Bug in timeline');
    expect(payload.pmo_submissiontext).toBe('Bug details');
  });

  it('createEnhancementSuggestionRecord sends priority, source system, and structured draft', async () => {
    mockCreateProjectRequest.mockResolvedValue({
      pmo_projectrequestid: 'enh-guid-001',
      pmo_name: 'Better risk summary',
    });

    const mutation = prepareEnhancementSuggestionMutation(buildEnhancementDraft(), 'user-6');
    const result = await createEnhancementSuggestionRecord(mutation);

    expect(result.creationResult).toBe('success');
    expect(result.recordId).toBe('enh-guid-001');
    expect(mockCreateProjectRequest).toHaveBeenCalledOnce();

    const payload = mockCreateProjectRequest.mock.calls[0][0];
    expect(payload.pmo_requesttype).toBe(REQUEST_TYPE.Enhancement);
    expect(payload.pmo_priority).toBe(REQUEST_PRIORITY.Medium);
    expect(payload.pmo_sourcesystem).toBe(SOURCE_SYSTEM.CfrPmo);
    expect(payload.pmo_description).toContain('Title: Better risk summary');
    expect(payload.pmo_submissiontext).toBe('Enhancement details');
  });

  it('maps low-confidence bug severity to REQUEST_PRIORITY.Low', async () => {
    mockCreateProjectRequest.mockResolvedValue({
      pmo_projectrequestid: 'bug-guid-002',
      pmo_name: 'Low bug',
    });

    const draft = { ...buildBugDraft(), confidence: 'low' as const };
    const mutation = prepareBugReportMutation(draft, 'user-7');
    await createBugReportRecord(mutation);

    const payload = mockCreateProjectRequest.mock.calls[0][0];
    expect(payload.pmo_priority).toBe(REQUEST_PRIORITY.Low);
  });
});
