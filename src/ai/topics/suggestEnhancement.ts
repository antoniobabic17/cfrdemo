/**
 * suggest-enhancement topic - Wave 2 draft output.
 * Produces a structured suggestion draft for user review only.
 * No record creation or mutation behavior.
 */

import type { EnhancementSuggestionDraft } from '../contracts';
import type { DraftContextInput } from './reportBug';

function classifyConfidence(description: string): 'high' | 'medium' | 'low' {
  const text = description.trim();
  if (!text) return 'low';
  if (text.length < 25) return 'medium';
  return 'high';
}

function normalizeEntityType(type?: 'project' | 'program' | 'other'): 'project' | 'program' | 'other' {
  return type ?? 'other';
}

function buildStructuredEnhancementDraft(input: DraftContextInput, userDescription: string): string {
  const route = input.sourceRoute || '/';
  const entityType = normalizeEntityType(input.sourceEntityType);
  const entityId = input.sourceEntityId ?? 'Not provided';

  return [
    'Title: [Draft] Enhancement suggestion for PMO app',
    `Route: ${route}`,
    `Entity Type: ${entityType}`,
    `Entity Id: ${entityId}`,
    '',
    'Suggestion:',
    userDescription.trim() || 'User did not provide a description.',
    '',
    'Problem to solve:',
    '[Add the current pain point.]',
    '',
    'Proposed outcome:',
    '[Add expected improvement.]',
    '',
    'Priority and value:',
    '[Add business value and urgency.]',
  ].join('\n');
}

export function suggestEnhancement(
  input: DraftContextInput,
  userDescription: string,
): EnhancementSuggestionDraft {
  return {
    topicId: 'suggest-enhancement',
    mode: 'draft',
    sourceRoute: input.sourceRoute || '/',
    sourceEntityId: input.sourceEntityId,
    sourceEntityType: normalizeEntityType(input.sourceEntityType),
    userDescription,
    structuredDraft: buildStructuredEnhancementDraft(input, userDescription),
    sourceStatus: [{ source: 'route-context', state: 'ok' }],
    confidence: classifyConfidence(userDescription),
    generatedAt: new Date().toISOString(),
  };
}
