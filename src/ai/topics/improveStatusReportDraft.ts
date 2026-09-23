/**
 * improve-status-report-draft topic - Wave 2 draft output.
 * Refines user-provided status draft text into clearer PMO structure.
 */

import type { ImprovedStatusReportDraft } from '../contracts';

export interface ImproveDraftInput {
  originalDraft: string;
  projectId?: string;
  projectName?: string;
}

function improveText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) {
    return [
      'Accomplished Activities:',
      '- [Add completed work items]',
      '',
      'Planned Activities:',
      '- [Add upcoming work items]',
      '',
      'Additional Comments:',
      '- [Add risks, issues, and escalation notes]',
    ].join('\n');
  }

  return [
    'Accomplished Activities:',
    `- ${cleaned}`,
    '',
    'Planned Activities:',
    '- [Add the next planned activities and owners]',
    '',
    'Additional Comments:',
    '- [Highlight risks, issues, and required support]',
  ].join('\n');
}

export function improveStatusReportDraft(input: ImproveDraftInput): ImprovedStatusReportDraft {
  return {
    topicId: 'improve-status-report-draft',
    mode: 'draft',
    projectId: input.projectId,
    projectName: input.projectName,
    originalDraft: input.originalDraft,
    improvedDraft: improveText(input.originalDraft),
    improvementNotes: [
      'Structured the draft into standard PMO sections.',
      'Added placeholders for ownership and next-step clarity.',
      'Preserved user narrative while improving readability.',
    ],
    sourceStatus: [{ source: 'user-draft', state: input.originalDraft.trim() ? 'ok' : 'missing' }],
    confidence: input.originalDraft.trim() ? 'medium' : 'low',
    generatedAt: new Date().toISOString(),
  };
}
