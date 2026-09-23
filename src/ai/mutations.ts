/**
 * Wave 3 Mutation Operations — Record creation with approval gates.
 * No silent writes. All outputs shown to user before Dataverse commit.
 * User must explicitly confirm before record creation proceeds.
 */

import type {
  BugReportDraft, BugReportMutation,
  EnhancementSuggestionDraft, EnhancementSuggestionMutation,
  IntakeRequestMutation,
} from './contracts';
import { serializeError } from '../lib/utils';
import { trackMiraMutationFailure, type MiraMutationFailureTelemetry } from '../lib/telemetry';
import { createProjectRequest } from '../api/projectRequests.api';
import { REQUEST_TYPE, REQUEST_PRIORITY, SOURCE_SYSTEM } from '../lib/constants';

interface MutationCreateOptions {
  createRecord?: () => Promise<string>;
}

/**
 * Prepare a bug report mutation payload from draft.
 * This validates the draft and creates the mutation payload but does NOT write to Dataverse.
 * User must confirm before calling createBugReportRecord().
 */
export function prepareBugReportMutation(
  draft: BugReportDraft,
  userId: string
): BugReportMutation {
  const severity = determineBugSeverity(draft.confidence);
  const affectedEntityRef = draft.sourceEntityId
    ? `${draft.sourceEntityType || 'other'}:${draft.sourceEntityId}`
    : 'other';

  return {
    topicId: 'report-bug',
    mode: 'mutation',
    sourceRoute: draft.sourceRoute,
    sourceEntityId: draft.sourceEntityId,
    sourceEntityType: draft.sourceEntityType,
    userDescription: draft.userDescription,
    structuredDraft: draft.structuredDraft,
    requestType: 'Bug Report',
    title: extractTitleFromDraft(draft.structuredDraft, 'Bug'),
    description: draft.userDescription,
    reproductionStepsUrl: draft.sourceRoute,
    affectedEntityRef,
    severity,
    status: 'New',
    createdBy: userId,
    createdAt: new Date().toISOString(),
    creationResult: 'pending',
    sourceStatus: draft.sourceStatus,
    confidence: draft.confidence,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Prepare an enhancement suggestion mutation payload from draft.
 * This validates the draft and creates the mutation payload but does NOT write to Dataverse.
 * User must confirm before calling createEnhancementSuggestionRecord().
 */
export function prepareEnhancementSuggestionMutation(
  draft: EnhancementSuggestionDraft,
  userId: string
): EnhancementSuggestionMutation {
  const priority = determineEnhancementPriority(draft.confidence);
  const affectedEntityRef = draft.sourceEntityId
    ? `${draft.sourceEntityType || 'other'}:${draft.sourceEntityId}`
    : 'other';

  return {
    topicId: 'suggest-enhancement',
    mode: 'mutation',
    sourceRoute: draft.sourceRoute,
    sourceEntityId: draft.sourceEntityId,
    sourceEntityType: draft.sourceEntityType,
    userDescription: draft.userDescription,
    structuredDraft: draft.structuredDraft,
    requestType: 'Enhancement Request',
    title: extractTitleFromDraft(draft.structuredDraft, 'Enhancement'),
    description: draft.userDescription,
    suggestedFeatureUrl: draft.sourceRoute,
    affectedEntityRef,
    priority,
    status: 'New',
    createdBy: userId,
    createdAt: new Date().toISOString(),
    creationResult: 'pending',
    sourceStatus: draft.sourceStatus,
    confidence: draft.confidence,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Create a bug report record in Dataverse after user confirmation.
 * This is a WRITE operation — only call after explicit user approval.
 * Returns the mutation payload with recordId and creationResult populated.
 */
export async function createBugReportRecord(
  mutation: BugReportMutation,
  options?: MutationCreateOptions
): Promise<BugReportMutation> {
  try {
    const doCreate = options?.createRecord ?? (async () => {
      const record = await createProjectRequest({
        pmo_name: mutation.title,
        pmo_description: `${mutation.description}\n\n${mutation.structuredDraft}`,
        pmo_requesttype: REQUEST_TYPE.Support,
        pmo_priority: toRequestPriority(mutation.severity),
        pmo_sourcesystem: SOURCE_SYSTEM.CfrPmo,
        pmo_submissiontext: mutation.userDescription,
      });
      return record.pmo_projectrequestid;
    });
    const recordId = await doCreate();

    return {
      ...mutation,
      recordId,
      creationResult: 'success',
      failureReason: undefined,
      failureCode: undefined,
      telemetryId: undefined,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const telemetry = buildFailureTelemetry(mutation, error);
    trackMiraMutationFailure(telemetry);
    return {
      ...mutation,
      creationResult: 'failed',
      failureReason: telemetry.errorMessage,
      failureCode: 'BUG_REPORT_CREATE_FAILED',
      telemetryId: telemetry.telemetryId,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Create an enhancement suggestion record in Dataverse after user confirmation.
 * This is a WRITE operation — only call after explicit user approval.
 * Returns the mutation payload with recordId and creationResult populated.
 */
export async function createEnhancementSuggestionRecord(
  mutation: EnhancementSuggestionMutation,
  options?: MutationCreateOptions
): Promise<EnhancementSuggestionMutation> {
  try {
    const doCreate = options?.createRecord ?? (async () => {
      const record = await createProjectRequest({
        pmo_name: mutation.title,
        pmo_description: `${mutation.description}\n\n${mutation.structuredDraft}`,
        pmo_requesttype: REQUEST_TYPE.Enhancement,
        pmo_priority: toRequestPriority(mutation.priority),
        pmo_sourcesystem: SOURCE_SYSTEM.CfrPmo,
        pmo_submissiontext: mutation.userDescription,
      });
      return record.pmo_projectrequestid;
    });
    const recordId = await doCreate();

    return {
      ...mutation,
      recordId,
      creationResult: 'success',
      failureReason: undefined,
      failureCode: undefined,
      telemetryId: undefined,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const telemetry = buildFailureTelemetry(mutation, error);
    trackMiraMutationFailure(telemetry);
    return {
      ...mutation,
      creationResult: 'failed',
      failureReason: telemetry.errorMessage,
      failureCode: 'ENHANCEMENT_CREATE_FAILED',
      telemetryId: telemetry.telemetryId,
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Create a pmo_projectrequest record from Mira's CreateIntakeRecord action output.
 * Called after Copilot Studio topic completes field extraction and user confirms.
 */
export async function createIntakeRequestRecord(
  mutation: IntakeRequestMutation
): Promise<IntakeRequestMutation> {
  try {
    const payload: Parameters<typeof createProjectRequest>[0] = {
      pmo_name: mutation.extractedTitle,
      pmo_submissiontext: mutation.submissionText,
      pmo_routingconfidence: mutation.routingConfidence,
      pmo_routingrecommendation: mutation.routingRecommendation,
      pmo_extractedfieldsjson: mutation.extractedFieldsJson,
      pmo_lineofbusiness: mutation.lineOfBusiness,
    };
    if (mutation.targetTeamId) payload['pmo_TargetTeam@odata.bind'] = `/teams(${mutation.targetTeamId})`;

    const record = await createProjectRequest(payload);

    return {
      ...mutation,
      recordId: record.pmo_projectrequestid,
      creationResult: 'success',
      failureReason: undefined,
      failureCode: undefined,
      telemetryId: undefined,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const telemetryId = `mira-mut-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    trackMiraMutationFailure({
      eventName: 'mira.mutation.failed',
      telemetryId,
      topicId: 'submit-intake-request',
      requestType: 'Intake Request',
      sourceRoute: '/',
      sourceEntityId: undefined,
      sourceEntityType: 'other',
      createdBy: '',
      createdAt: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      errorMessage: serializeError(error),
    });
    return {
      ...mutation,
      creationResult: 'failed',
      failureReason: serializeError(error),
      failureCode: 'INTAKE_REQUEST_CREATE_FAILED',
      telemetryId,
      generatedAt: new Date().toISOString(),
    };
  }
}

export function prepareRetryMutation(
  mutation: BugReportMutation | EnhancementSuggestionMutation
): BugReportMutation | EnhancementSuggestionMutation {
  return {
    ...mutation,
    creationResult: 'pending',
    failureReason: undefined,
    failureCode: undefined,
    telemetryId: undefined,
  };
}

/* Private helpers */

function toRequestPriority(label: 'High' | 'Medium' | 'Low'): number {
  switch (label) {
    case 'High': return REQUEST_PRIORITY.High;
    case 'Medium': return REQUEST_PRIORITY.Medium;
    case 'Low': return REQUEST_PRIORITY.Low;
  }
}

function determineBugSeverity(confidence: 'high' | 'medium' | 'low'): 'High' | 'Medium' | 'Low' {
  switch (confidence) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
    default:
      return 'Low';
  }
}

function determineEnhancementPriority(confidence: 'high' | 'medium' | 'low'): 'High' | 'Medium' | 'Low' {
  // For enhancements, confidence reflects user conviction
  switch (confidence) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
    default:
      return 'Low';
  }
}

function extractTitleFromDraft(draft: string, type: 'Bug' | 'Enhancement'): string {
  // Extract first line or use a default
  const lines = draft.split('\n');
  const titleLine = lines.find(l => l.includes('Title:'));
  if (titleLine) {
    return titleLine.replace('Title:', '').trim();
  }
  return `[${type}] PMO App Feedback`;
}

function buildFailureTelemetry(
  mutation: BugReportMutation | EnhancementSuggestionMutation,
  error: unknown
): MiraMutationFailureTelemetry {
  return {
    eventName: 'mira.mutation.failed',
    telemetryId: `mira-mut-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    topicId: mutation.topicId,
    requestType: mutation.requestType,
    sourceRoute: mutation.sourceRoute,
    sourceEntityId: mutation.sourceEntityId,
    sourceEntityType: mutation.sourceEntityType,
    createdBy: mutation.createdBy,
    createdAt: mutation.createdAt,
    occurredAt: new Date().toISOString(),
    errorMessage: serializeError(error),
  };
}
