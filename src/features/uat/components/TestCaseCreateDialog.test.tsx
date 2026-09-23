/**
 * T025's acceptance, driven against the real dialog: both creation paths, and the
 * re-parenting invariant stated where a person can read it.
 *
 * THE CLAIM WORTH TESTING IS THE PAIRING, not that a write happens. `pmo_template` and
 * `pmo_source` are two columns describing one fact. A case with a template but sourced
 * `AdHoc`, or sourced `Template` with no template, renders identically on every screen
 * and is wrong in every report — the questions it asks and the way it is counted stop
 * agreeing. So each path asserts BOTH columns on the same payload, and a further test
 * asserts they move together across a change of mind.
 *
 * `pmo_executionstatus` is asserted as coming out of the derivation module rather than as
 * a literal. That is the T024 boundary being closed: this dialog is the first caller of
 * `deriveCaseStatusFromRuns`, and a hard-coded Not Started here would be the second copy
 * of a rule that exists in one place on purpose.
 *
 * The Radix Select shims below are local to this file deliberately. jsdom has no
 * pointer-capture or scrollIntoView, and Radix needs both; patching them in the shared
 * test-setup would change the environment for all 56 test files to serve one of them.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UatTemplate } from '../../../models/uatTemplate.model';
import { UAT_EXECUTION_STATUS, UAT_PRIORITY, UAT_SOURCE } from '../../../lib/uatOptionSets';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEMPLATE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NEW_CASE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const mutateAsync = vi.fn((_payload: Record<string, unknown>) =>
  Promise.resolve({ pmo_uattestcaseid: NEW_CASE_ID }));
let mockTemplates: UatTemplate[] = [];
let mockStrandedTemplate: UatTemplate | undefined;

vi.mock('../../../hooks/useUatTestCases', () => ({
  useCreateUatTestCase: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../../../hooks/useUatTemplates', () => ({
  useActiveUatTemplates: () => ({ data: mockTemplates, isLoading: false, isError: false }),
  useUatTemplate: (id: string | undefined) => ({ data: id ? mockStrandedTemplate : undefined }),
}));

import { TestCaseCreateDialog } from './TestCaseCreateDialog';

/**
 * Two versions of one template name — the case finding 41 is about. A picker showing
 * only the name gives a user no way to choose between these.
 */
function template(over: Partial<UatTemplate> & { pmo_uattemplateid: string }): UatTemplate {
  return {
    pmo_name: 'Epic Claim Validation',
    pmo_version: 1,
    pmo_isactive: true,
    pmo_defaultestimatedminutes: null,
    ...over,
  } as UatTemplate;
}

beforeAll(() => {
  // Radix Select needs these; jsdom has neither.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockStrandedTemplate = undefined;
  mockTemplates = [
    template({ pmo_uattemplateid: TEMPLATE_A, pmo_version: 1 }),
    template({ pmo_uattemplateid: TEMPLATE_B, pmo_version: 2, pmo_defaultestimatedminutes: 45 }),
  ];
});

function renderDialog(props: Partial<React.ComponentProps<typeof TestCaseCreateDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <TestCaseCreateDialog
      open
      onOpenChange={onOpenChange}
      projectId={PROJECT_ID}
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onOpenChange, onCreated };
}

/** Choose an option in a Radix Select by its trigger's accessible name. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, triggerLabel: RegExp, optionLabel: RegExp) {
  await user.click(screen.getByLabelText(triggerLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('the ad-hoc path (FR-013)', () => {
  it('creates with no template, sourced AdHoc, and a status it asked the derivation module for', async () => {
    const user = userEvent.setup();
    const { onCreated, onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'Verify the claim total');
    await user.click(screen.getByRole('button', { name: /create test case/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.pmo_title).toBe('Verify the claim total');
    expect(payload['pmo_Template@odata.bind']).toBeNull();
    expect(payload.pmo_source).toBe(UAT_SOURCE.AdHoc);
    expect(payload.pmo_executionstatus).toBe(UAT_EXECUTION_STATUS.NotStarted);
    expect(payload.pmo_priority).toBe(UAT_PRIORITY.Medium);
    // The caller gets the new id so it can navigate, and the dialog closes itself.
    expect(onCreated).toHaveBeenCalledWith(NEW_CASE_ID);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses to write without a title, and says why', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /create test case/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs a title/i);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects a non-integer estimate before the platform has to', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(/title/i), 'Case');
    await user.type(screen.getByLabelText(/estimated minutes/i), '4.5');
    await user.click(screen.getByRole('button', { name: /create test case/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe('the template path (FR-013)', () => {
  it('creates with the chosen template bound AND sourced Template', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'Verify the claim total');
    await chooseOption(user, /template/i, /Epic Claim Validation · v2/);
    await user.click(screen.getByRole('button', { name: /create test case/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload['pmo_Template@odata.bind']).toBe(`/pmo_uattemplates(${TEMPLATE_B})`);
    expect(payload.pmo_source).toBe(UAT_SOURCE.Template);
    expect(payload.pmo_executionstatus).toBe(UAT_EXECUTION_STATUS.NotStarted);
  });

  it('prefills the estimate from the template’s default, and stops once the user types', async () => {
    const user = userEvent.setup();
    renderDialog();

    await chooseOption(user, /template/i, /Epic Claim Validation · v2/);
    const minutes = screen.getByLabelText(/estimated minutes/i);
    await waitFor(() => expect(minutes).toHaveValue('45'));

    await user.clear(minutes);
    await user.type(minutes, '90');
    // Changing template again must not discard a deliberate value.
    await chooseOption(user, /template/i, /Epic Claim Validation · v1/);
    expect(minutes).toHaveValue('90');
  });

  it('moves both columns back together when the template is cleared again', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/title/i), 'Case');
    await chooseOption(user, /template/i, /Epic Claim Validation · v2/);
    await chooseOption(user, /template/i, /No template \(ad hoc\)/);
    await user.click(screen.getByRole('button', { name: /create test case/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    // The pairing: neither column may be left behind by the other.
    expect(payload['pmo_Template@odata.bind']).toBeNull();
    expect(payload.pmo_source).toBe(UAT_SOURCE.AdHoc);
  });

  it('honours a default template supplied by the caller', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultTemplateId: TEMPLATE_A });

    await user.type(screen.getByLabelText(/title/i), 'Case');
    await user.click(screen.getByRole('button', { name: /create test case/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload['pmo_Template@odata.bind']).toBe(`/pmo_uattemplates(${TEMPLATE_A})`);
    expect(payload.pmo_source).toBe(UAT_SOURCE.Template);
  });
});

describe('two versions of one template are distinguishable (finding 41)', () => {
  it('shows the version beside the name on every option', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByLabelText(/template/i));

    // Both versions share a name. Without the version they are the same string, and a
    // user choosing between them is guessing.
    expect(await screen.findByRole('option', { name: /Epic Claim Validation · v1/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Epic Claim Validation · v2/ })).toBeTruthy();
  });

  it('keeps showing a stored template that has since been retired, marked inactive', async () => {
    mockStrandedTemplate = template({
      pmo_uattemplateid: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      pmo_version: 3,
      pmo_isactive: false,
    });
    renderDialog({ defaultTemplateId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' });

    // Dropping it from the display would read as "no template", a different statement.
    expect(await screen.findByText(/this template is inactive/i)).toBeTruthy();
  });
});

describe('the initial status is derived, not named', () => {
  // The value tests above cannot prove this. Swapping deriveCaseStatusFromRuns([]) for
  // UAT_EXECUTION_STATUS.NotStarted produces the SAME integer today, so every assertion
  // stays green while the rule quietly acquires a second copy — and the copy is the one
  // that will not follow if "no runs means Not Started" ever changes. Only the source
  // text distinguishes them, the same reason uatStatus.test.ts reads its own module.
  const dialogSource = Object.values(
    import.meta.glob('./TestCaseCreateDialog.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  )[0];

  it('asks the derivation module for pmo_executionstatus', () => {
    expect(dialogSource, 'TestCaseCreateDialog.tsx was not loaded as raw text').toBeTruthy();
    const assignment = dialogSource
      .split('\n')
      .find((line) => line.includes('pmo_executionstatus:'));
    expect(assignment, 'no pmo_executionstatus assignment found').toBeTruthy();
    expect(assignment, 'derive it — do not name a status member here')
      .toContain('deriveCaseStatusFromRuns');
    expect(assignment).not.toContain('UAT_EXECUTION_STATUS');
  });
});

describe('the re-parenting limit is stated, not just enforced', () => {
  it('tells the user in the dialog that the project is fixed', async () => {
    renderDialog();
    // A guard the code enforces and the UI never explains is a dead end someone has to
    // discover. useUatTestCases.test.ts asserts the enforcing half.
    expect(screen.getByText(/cannot be moved to another/i)).toBeTruthy();
    expect(screen.getByText(/keep their own copy of the project/i)).toBeTruthy();
  });
});
