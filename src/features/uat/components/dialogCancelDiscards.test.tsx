/**
 * Cancel discards, on every UAT create dialog.
 *
 * WHY THIS IS A SHARED TEST AND NOT TWO. The bug it guards is a Radix subtlety, not a
 * per-dialog mistake: a controlled `Dialog` fires its own `onOpenChange` only when Radix
 * initiates the close (Escape, the overlay, the built-in close button). A Cancel button
 * wired straight to the `onOpenChange` prop closes the dialog through the parent, so a
 * `reset()` that lives in the Dialog's `onOpenChange` handler never runs. The form then
 * reopens carrying whatever the user typed and abandoned — which reads as a draft the app
 * saved for them, and is the opposite of what Cancel promised.
 *
 * Nothing crashes and no other test fails, so it can only be caught by asserting the
 * second open. One test file over both dialogs is what stops the next one being written
 * with the same wiring.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UatTemplate } from '../../../models/uatTemplate.model';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const mockTemplates: UatTemplate[] = [];

vi.mock('../../../hooks/useUatTestCases', () => ({
  useCreateUatTestCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useUatTemplates', () => ({
  useCreateUatTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActiveUatTemplates: () => ({ data: mockTemplates, isLoading: false, isError: false }),
  useUatTemplate: () => ({ data: undefined }),
}));

import { TestCaseCreateDialog } from './TestCaseCreateDialog';
import { TemplateCreateDialog } from './TemplateCreateDialog';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Render a dialog whose `open` is driven by the component's own onOpenChange, i.e. wired
 * the way a real page wires it. Rendering with a hard-coded `open` would make the bug
 * unreachable, because the dialog would never actually close.
 */
function ControlledHost({ render: renderDialog }: {
  render: (open: boolean, setOpen: (next: boolean) => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      {renderDialog(open, setOpen)}
    </>
  );
}
import React from 'react';

describe('Cancel discards what was typed', () => {
  it('TestCaseCreateDialog reopens empty', async () => {
    const user = userEvent.setup();
    render(
      <ControlledHost
        render={(open, setOpen) => (
          <TestCaseCreateDialog open={open} onOpenChange={setOpen} projectId={PROJECT_ID} />
        )}
      />,
    );

    await user.type(screen.getByLabelText(/title/i), 'Abandoned draft');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    await user.click(screen.getByRole('button', { name: /reopen/i }));

    expect(
      screen.getByLabelText(/title/i),
      'Cancel promised to discard; the next open must not carry the abandoned text',
    ).toHaveValue('');
  });

  it('TemplateCreateDialog reopens empty', async () => {
    const user = userEvent.setup();
    render(
      <ControlledHost
        render={(open, setOpen) => <TemplateCreateDialog open={open} onOpenChange={setOpen} />}
      />,
    );

    await user.type(screen.getByLabelText(/name/i), 'Abandoned draft');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    await user.click(screen.getByRole('button', { name: /reopen/i }));

    expect(screen.getByLabelText(/name/i)).toHaveValue('');
  });
});
