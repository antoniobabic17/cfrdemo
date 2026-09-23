/**
 * report-bug topic - Wave 2 draft output.
 * Produces a structured draft for user review only.
 * No record creation or mutation behavior.
 */

import type { BugReportDraft } from '../contracts';

export interface DraftContextInput {
  sourceRoute: string;
  sourceEntityId?: string;
  sourceEntityType?: 'project' | 'program' | 'other';
}

function classifyConfidence(description: string): 'high' | 'medium' | 'low' {
  const text = description.trim();
  if (!text) return 'low';
  if (text.length < 25) return 'medium';
  return 'high';
}

function normalizeEntityType(type?: 'project' | 'program' | 'other'): 'project' | 'program' | 'other' {
  return type ?? 'other';
}

function buildStructuredBugDraft(input: DraftContextInput, userDescription: string): string {
  const route = input.sourceRoute || '/';
  const entityType = normalizeEntityType(input.sourceEntityType);
  const entityId = input.sourceEntityId ?? 'Not provided';

  return [
    'Title: [Draft] Bug observed in PMO app',
    `Route: ${route}`,
    `Entity Type: ${entityType}`,
    `Entity Id: ${entityId}`,
    '',
    'Observed behavior:',
    userDescription.trim() || 'User did not provide a description.',
    '',
    'Expected behavior:',
    '[Add expected behavior before submitting.]',
    '',
    'Repro steps:',
    '1. [Add step 1]',
    '2. [Add step 2]',
    '3. [Add step 3]',
    '',
    'Impact:',
    '[Add business/user impact.]',
  ].join('\n');
}

export function reportBug(input: DraftContextInput, userDescription: string): BugReportDraft {
  return {
    topicId: 'report-bug',
    mode: 'draft',
    sourceRoute: input.sourceRoute || '/',
    sourceEntityId: input.sourceEntityId,
    sourceEntityType: normalizeEntityType(input.sourceEntityType),
    userDescription,
    structuredDraft: buildStructuredBugDraft(input, userDescription),
    sourceStatus: [{ source: 'route-context', state: 'ok' }],
    confidence: classifyConfidence(userDescription),
    generatedAt: new Date().toISOString(),
  };
}
