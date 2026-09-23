/**
 * T042 — a defect raised from a failing run pre-links all three, each as ONE lookup.
 *
 * The legacy model expressed a defect's relationship to a test TWICE — a many-to-many junction
 * and a shadow lookup — so which one a given row used was ambiguous per row. That ambiguity is
 * one of the reasons migration is out of scope, and reproducing it would recreate the problem
 * this table exists to avoid. So the payload assertion counts the binds: three links, three
 * keys, no junction row written.
 *
 * The case status moves through the derivation module, and a source guard asserts this component
 * does not name the status constant — because writing the same integer from two places is how
 * the two start to disagree, which is the legacy rollup-plus-calculated-string failure exactly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock('../../../hooks/useToast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: vi.fn(), info: vi.fn(),
  },
}));

const createDefect = vi.fn();
vi.mock('../../../hooks/useUatDefects', () => ({
  useCreateUatDefect: () => ({ mutateAsync: createDefect, isPending: false }),
}));

const updateCase = vi.fn();
vi.mock('../../../hooks/useUatTestCases', () => ({
  useUpdateUatTestCase: () => ({ mutateAsync: updateCase, isPending: false }),
}));

// The search is mocked; the picker itself is the real one, as on DefectStatusControl.
const searchUsers = vi.fn();
const resolveUserLabel = vi.fn();
vi.mock('../../../hooks/useIntakeLookups', () => ({
  useUserSearch: () => ({ searchUsers, resolveUserLabel }),
}));

import { DefectCreateDialog } from './DefectCreateDialog';
import {
  UAT_DEFECT_STATUS, UAT_DEFECT_SEVERITY, UAT_EXECUTION_STATUS, UAT_PRIORITY,
} from '../../../lib/uatOptionSets';

const CASE = 'tc-1';
const RUN = 'tr-1';
const REQ = 'req-1';

function open(props: Partial<React.ComponentProps<typeof DefectCreateDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const { rerender } = render(
    <DefectCreateDialog
      open
      onOpenChange={onOpenChange}
      projectId="p-1"
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onOpenChange, onCreated, rerender };
}

/** Fill the summary and press save. */
async function save(summary = 'Total is wrong on the claim screen') {
  fireEvent.change(screen.getByLabelText('Summary'), { target: { value: summary } });
  fireEvent.click(screen.getByRole('button', { name: /Raise defect/i }));
  await waitFor(() => expect(createDefect).toHaveBeenCalled());
  return createDefect.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  searchUsers.mockResolvedValue([{ value: 'u-7', label: 'Weir, Patrick' }]);
  resolveUserLabel.mockResolvedValue('Weir, Patrick');
  createDefect.mockResolvedValue({ pmo_uatdefectid: 'd-1', pmo_name: 'DEF-1000' });
  updateCase.mockResolvedValue({});
});

describe('raised from a failing run', () => {
  it('pre-links the case, the run and the requirement — one lookup each', async () => {
    open({ testCaseId: CASE, testRunId: RUN, requirementId: REQ, moveCaseToReturned: true });
    const payload = await save();

    expect(payload['pmo_TestCase@odata.bind']).toBe(`/pmo_uattestcases(${CASE})`);
    expect(payload['pmo_TestRun@odata.bind']).toBe(`/pmo_uattestruns(${RUN})`);
    expect(payload['pmo_Requirement@odata.bind']).toBe(`/pmo_uatrequirements(${REQ})`);
    // Exactly three binds, and no fourth expressing the same relationship twice.
    expect(Object.keys(payload).filter((k) => k.endsWith('@odata.bind'))).toHaveLength(3);
  });

  it('moves the case to Returned for Defect', async () => {
    open({ testCaseId: CASE, testRunId: RUN, moveCaseToReturned: true });
    await save();
    await waitFor(() => expect(updateCase).toHaveBeenCalled());
    expect(updateCase.mock.calls[0][0]).toEqual({
      id: CASE,
      payload: { pmo_executionstatus: UAT_EXECUTION_STATUS.ReturnedForDefect },
    });
  });

  it('creates the defect BEFORE touching the case', async () => {
    // A case reading Returned for Defect with no defect to point at is worse than a defect
    // with a stale case status: the tester cannot act on it.
    open({ testCaseId: CASE, moveCaseToReturned: true });
    await save();
    await waitFor(() => expect(updateCase).toHaveBeenCalled());
    expect(createDefect).toHaveBeenCalledBefore(updateCase);
  });

  it('keeps the defect and says so when the case update fails', async () => {
    updateCase.mockRejectedValue(new Error('403'));
    const { onOpenChange } = open({ testCaseId: CASE, moveCaseToReturned: true });
    await save();
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    // The defect was raised; the message must not suggest it was lost.
    expect(toastWarning.mock.calls[0][0]).toMatch(/defect was raised/i);
    expect(toastSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not touch the case when it was not asked to', async () => {
    open({ testCaseId: CASE });        // moveCaseToReturned defaults to false
    await save();
    expect(updateCase).not.toHaveBeenCalled();
  });
});

describe('raised from the list, with nothing to link', () => {
  it('sends no bind at all rather than an empty one', async () => {
    open();
    const payload = await save();
    expect(Object.keys(payload).filter((k) => k.endsWith('@odata.bind'))).toEqual([]);
    // An empty bind is an HTTP 400 — the shape legacy defect 5 was made of.
    expect(Object.values(payload).every((v) => v !== '')).toBe(true);
  });

  it('says it is not linked, so the operator knows what they are getting', () => {
    open();
    expect(screen.getByText(/Not linked to a test case/i)).toBeTruthy();
  });

  it('links only what it was given', async () => {
    open({ testCaseId: CASE });
    const payload = await save();
    expect(payload['pmo_TestCase@odata.bind']).toBe(`/pmo_uattestcases(${CASE})`);
    expect(payload['pmo_TestRun@odata.bind']).toBeUndefined();
    expect(payload['pmo_Requirement@odata.bind']).toBeUndefined();
  });
});

describe('the defect itself', () => {
  it('is created New, with a reported date and the chosen severity and priority', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: String(UAT_DEFECT_SEVERITY.Critical) } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: String(UAT_PRIORITY.High) } });
    const payload = await save();

    expect(payload.pmo_status).toBe(UAT_DEFECT_STATUS.New);
    expect(payload.pmo_severity).toBe(UAT_DEFECT_SEVERITY.Critical);
    expect(payload.pmo_priority).toBe(UAT_PRIORITY.High);
    expect(String(payload.pmo_reportedon)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses to save without a summary', () => {
    open();
    expect(screen.getByRole('button', { name: /Raise defect/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /Raise defect/i })).toBeDisabled();
  });

  it('stores an empty details box as null rather than an empty string', async () => {
    open();
    const payload = await save();
    expect(payload.pmo_details).toBeNull();
  });

  it('offers no category or assigned-team picker, because the columns do not exist', () => {
    // Finding 27: both sets live in the PROD cr87a solution with no members recorded, so the
    // columns were never created. An empty picker invites an answer nothing can store.
    open();
    expect(screen.queryByLabelText(/category/i)).toBeNull();
    expect(screen.queryByLabelText(/team/i)).toBeNull();
  });

  it('discards its text on cancel, by not existing while closed', () => {
    // The form body is mounted only while open, so a half-written defect cannot survive a
    // cancel. The first attempt reset each field in an effect; the lint rule refused it, and
    // it was right to — that version is also a list that can fall behind the form, so adding
    // a field and forgetting its reset line would reopen the dialog holding the last value.
    const { onOpenChange, rerender } = open();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'half-written' } });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(<DefectCreateDialog open={false} onOpenChange={onOpenChange} projectId="p-1" />);
    expect(screen.queryByLabelText('Summary')).toBeNull();
    rerender(<DefectCreateDialog open onOpenChange={onOpenChange} projectId="p-1" />);
    expect((screen.getByLabelText('Summary') as HTMLInputElement).value).toBe('');
  });
});

describe('the case status comes from one place', () => {
  const source = Object.values(
    import.meta.glob('./DefectCreateDialog.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  )[0];
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('reads the status through the derivation map, never by naming it', () => {
    expect(code).toContain('RUN_RESULT_TO_STATUS');
    // Naming UAT_EXECUTION_STATUS.ReturnedForDefect here would produce the same integer today
    // and a second place to change tomorrow.
    expect(code).not.toContain('UAT_EXECUTION_STATUS');
  });
});

/**
 * The assignee at raise time — the like-surface half of the same field on DefectStatusControl.
 *
 * Severity and priority are both settable here, so an assignee that could only be set afterwards
 * would mean every defect starts unowned and someone has to go back for it. It stays optional: a
 * tester who does not know who owns the fix should not be blocked from reporting it.
 */
describe('the assignee can be set when the defect is raised', () => {
  it('is offered as a labelled group beside severity and priority', () => {
    open();
    expect(screen.getByRole('group', { name: 'Assignee' })).toBeTruthy();
  });

  it('binds the chosen person as one lookup', async () => {
    open({ testCaseId: CASE, testRunId: RUN, requirementId: REQ });
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }));
    fireEvent.change(screen.getByPlaceholderText(/characters to search/i), { target: { value: 'weir' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Weir, Patrick' }, { timeout: 3000 }));
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Total is wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /Raise defect/i }));
    await waitFor(() => expect(createDefect).toHaveBeenCalled());
    const payload = createDefect.mock.calls[0][0] as Record<string, unknown>;
    expect(payload['pmo_AssignedTo@odata.bind']).toBe('/systemusers(u-7)');
  });

  it('omits the bind entirely when nobody is chosen, never sending an empty one', async () => {
    // The same rule the three links follow: an absent reference is omitted, because an empty
    // bind is the HTTP 400 legacy defect 5 was made of.
    open({ testCaseId: CASE });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Total is wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /Raise defect/i }));
    await waitFor(() => expect(createDefect).toHaveBeenCalled());
    const payload = createDefect.mock.calls[0][0] as Record<string, unknown>;
    expect('pmo_AssignedTo@odata.bind' in payload).toBe(false);
  });

  it('does not block reporting a defect nobody is assigned to yet', () => {
    open();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Total is wrong' } });
    expect(screen.getByRole('button', { name: /Raise defect/i })).not.toBeDisabled();
  });
});
