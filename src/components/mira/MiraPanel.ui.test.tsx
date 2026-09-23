import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGateDialog, MutationResultComponent } from './MiraPanel';
import { prepareBugReportMutation, prepareEnhancementSuggestionMutation } from '../../ai/mutations';
import type { BugReportDraft, EnhancementSuggestionDraft } from '../../ai/contracts';

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

function ApprovalDialogHarness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [hasReviewed, setHasReviewed] = useState(false);
  const mutation = prepareBugReportMutation(buildBugDraft(), 'test-user');

  return (
    <ApprovalGateDialog
      isOpen={true}
      mutation={mutation}
      hasReviewed={hasReviewed}
      onReviewedChange={setHasReviewed}
      onConfirm={onConfirm}
      onCancel={() => undefined}
      isSubmitting={false}
    />
  );
}

describe('Mira Wave 3 approval and retry UX', () => {
  it('keeps confirm disabled until review acknowledgement is checked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);

    render(<ApprovalDialogHarness onConfirm={onConfirm} />);

    const confirmButton = screen.getByRole('button', { name: 'Confirm & Create' });
    expect(confirmButton).toBeDisabled();

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows retry action for failed mutation and triggers callback', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    const failedResult = {
      ...prepareEnhancementSuggestionMutation(buildEnhancementDraft(), 'user-1'),
      creationResult: 'failed' as const,
      failureReason: 'Dataverse timeout',
      failureCode: 'ENHANCEMENT_CREATE_FAILED',
      telemetryId: 'trace-123',
    };

    render(<MutationResultComponent result={failedResult} onRetry={onRetry} />);

    expect(screen.getByText(/Creation Failed/)).toBeInTheDocument();
    expect(screen.getByText('Dataverse timeout')).toBeInTheDocument();
    expect(screen.getByText('trace-123')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry Submission' });
    await user.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
