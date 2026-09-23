/**
 * T043 — the defect lifecycle: eleven statuses, four dates, and a retest that does NOT move
 * the case.
 *
 * Two things are worth more than the field coverage here:
 *
 *  1. **The dates are stamped by the transition, not typed.** A date a person enters can
 *     disagree with the status it belongs to, and the pair is what a report reads. So
 *     `STATUS_DATE_FIELD` is data a test can read, and re-saving an unchanged status must not
 *     move its date to today — which is the mistake a naive "always stamp" would make.
 *  2. **A retest outcome is recorded on the defect and nothing else.** T043's acceptance says
 *     the case status comes from the new run. A control that also wrote the case status would
 *     put two writers on one column, which IS the legacy rollup-plus-calculated-string failure.
 *     The test asserts no case write happens at all, and that the UI says where the status
 *     comes from.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../hooks/useToast', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const updateDefect = vi.fn();
vi.mock('../../../hooks/useUatDefects', () => ({
  useUpdateUatDefect: () => ({ mutateAsync: updateDefect, isPending: false }),
}));

// The user search is mocked, the picker is NOT. `SearchableSelect` has no tests of its own, so
// stubbing it would leave the assignee wired to nothing but a stand-in — the real Popover is
// driven below (open, type, choose) so the wiring is what is under test.
const searchUsers = vi.fn();
const resolveUserLabel = vi.fn();
vi.mock('../../../hooks/useIntakeLookups', () => ({
  useUserSearch: () => ({ searchUsers, resolveUserLabel }),
}));

import { DefectStatusControl, STATUS_DATE_FIELD } from './DefectStatusControl';
import {
  UAT_DEFECT_STATUS, UAT_DEFECT_STATUS_LABELS, UAT_DEFECT_SEVERITY,
  UAT_OUTCOME, UAT_PRIORITY,
} from '../../../lib/uatOptionSets';
import type { UatDefect } from '../../../models/uatDefect.model';

const defect = (over: Partial<UatDefect> = {}): UatDefect => ({
  pmo_uatdefectid: 'd-1',
  pmo_name: 'DEF-1000',
  pmo_summary: 'Total is wrong',
  pmo_details: null,
  pmo_status: UAT_DEFECT_STATUS.New,
  pmo_severity: UAT_DEFECT_SEVERITY.Medium,
  pmo_priority: UAT_PRIORITY.Medium,
  pmo_retestoutcome: null,
  pmo_reportedon: '2026-08-01T10:00:00Z',
  pmo_resolvedon: null,
  pmo_retestedon: null,
  pmo_closedon: null,
  ...over,
} as UatDefect);

function renderControl(over: Partial<UatDefect> = {}) {
  render(<DefectStatusControl defect={defect(over)} projectId="p-1" />);
}

/** Change the status select and save; returns the update payload. */
async function moveTo(status: number) {
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: String(status) } });
  fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
  await waitFor(() => expect(updateDefect).toHaveBeenCalled());
  return (updateDefect.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateDefect.mockResolvedValue({});
  searchUsers.mockResolvedValue([{ value: 'u-7', label: 'Weir, Patrick' }]);
  resolveUserLabel.mockResolvedValue('Weir, Patrick');
});

/** Open the assignee picker, search, and choose the one result. */
async function assignTo(name: string, triggerName: string | RegExp = 'Unassigned') {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
  fireEvent.change(screen.getByPlaceholderText(/characters to search/i), { target: { value: 'weir' } });
  const option = await screen.findByRole('button', { name }, { timeout: 3000 });
  fireEvent.click(option);
}

/** The payload of the first update call. */
function firstPayload() {
  return (updateDefect.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
}

describe('the full status progression saves and reads back', () => {
  it('offers all eleven statuses', () => {
    renderControl();
    const options = Array.from(screen.getByLabelText('Status').querySelectorAll('option'));
    expect(options).toHaveLength(11);
    expect(options.map((o) => o.textContent))
      .toEqual(Object.values(UAT_DEFECT_STATUS).map((v) => UAT_DEFECT_STATUS_LABELS[v]));
  });

  it('reads the defect\'s current values back into the controls', () => {
    renderControl({
      pmo_status: UAT_DEFECT_STATUS.InDevelopment,
      pmo_severity: UAT_DEFECT_SEVERITY.Critical,
      pmo_priority: UAT_PRIORITY.High,
      pmo_retestoutcome: UAT_OUTCOME.Fail,
    });
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value)
      .toBe(String(UAT_DEFECT_STATUS.InDevelopment));
    expect((screen.getByLabelText('Severity') as HTMLSelectElement).value)
      .toBe(String(UAT_DEFECT_SEVERITY.Critical));
    expect((screen.getByLabelText('Priority') as HTMLSelectElement).value)
      .toBe(String(UAT_PRIORITY.High));
    expect((screen.getByLabelText('Retest outcome') as HTMLSelectElement).value)
      .toBe(String(UAT_OUTCOME.Fail));
  });

  it('saves severity, priority and status together', async () => {
    renderControl();
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: String(UAT_DEFECT_SEVERITY.Low) } });
    const payload = await moveTo(UAT_DEFECT_STATUS.Open);
    expect(payload.pmo_status).toBe(UAT_DEFECT_STATUS.Open);
    expect(payload.pmo_severity).toBe(UAT_DEFECT_SEVERITY.Low);
    expect(payload.pmo_priority).toBe(UAT_PRIORITY.Medium);
  });

  it('does nothing until something changes', () => {
    renderControl();
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: String(UAT_PRIORITY.Low) } });
    expect(screen.getByRole('button', { name: /Save changes/i })).toBeEnabled();
  });
});

describe('the four dates are stamped by the transition', () => {
  it('declares which date each status stamps, as data', () => {
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.Fixed]).toBe('pmo_resolvedon');
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.ReadyForRetest]).toBe('pmo_resolvedon');
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.RetestFailed]).toBe('pmo_retestedon');
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.Closed]).toBe('pmo_closedon');
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.Cancelled]).toBe('pmo_closedon');
    // New and Open stamp nothing: pmo_reportedon already recorded that at creation.
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.New]).toBeUndefined();
    expect(STATUS_DATE_FIELD[UAT_DEFECT_STATUS.Open]).toBeUndefined();
  });

  it('stamps the resolved date when a defect is fixed', async () => {
    renderControl();
    const payload = await moveTo(UAT_DEFECT_STATUS.Fixed);
    expect(String(payload.pmo_resolvedon)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.pmo_closedon).toBeUndefined();
  });

  it('stamps the closed date on close', async () => {
    renderControl({ pmo_status: UAT_DEFECT_STATUS.Fixed });
    const payload = await moveTo(UAT_DEFECT_STATUS.Closed);
    expect(String(payload.pmo_closedon)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.pmo_resolvedon).toBeUndefined();
  });

  it('stamps the retested date on a failed retest', async () => {
    renderControl({ pmo_status: UAT_DEFECT_STATUS.ReadyForRetest });
    const payload = await moveTo(UAT_DEFECT_STATUS.RetestFailed);
    expect(String(payload.pmo_retestedon)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does NOT move an existing date when the status has not changed', async () => {
    // Re-saving a Fixed defect to change its priority must not move its resolved date to
    // today. A report reading "resolved on" would otherwise drift every time anyone edits.
    renderControl({ pmo_status: UAT_DEFECT_STATUS.Fixed, pmo_resolvedon: '2026-08-05T09:00:00Z' });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: String(UAT_PRIORITY.High) } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());
    const payload = (updateDefect.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
    expect(payload.pmo_resolvedon).toBeUndefined();
  });

  it('shows all four dates, with a dash for the ones not reached', () => {
    renderControl({ pmo_resolvedon: '2026-08-05T09:00:00Z' });
    const dates = screen.getByTestId('uat-defect-dates').textContent ?? '';
    expect(dates).toContain('2026-08-01');     // reported
    expect(dates).toContain('2026-08-05');     // resolved
    expect(dates).toContain('—');              // retested and closed
  });
});

describe('a retest outcome drives the case from the new run, not from here', () => {
  it('records the outcome on the defect and writes nothing else', async () => {
    renderControl();
    fireEvent.change(screen.getByLabelText('Retest outcome'), { target: { value: String(UAT_OUTCOME.Pass) } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());

    const payload = (updateDefect.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
    expect(payload.pmo_retestoutcome).toBe(UAT_OUTCOME.Pass);
    // The whole claim: exactly one write, to the defect.
    expect(updateDefect).toHaveBeenCalledTimes(1);
    expect(Object.keys(payload)).not.toContain('pmo_executionstatus');
  });

  it('says where the case status comes from, so the tester is not left guessing', () => {
    renderControl({ pmo_retestoutcome: UAT_OUTCOME.Pass });
    expect(screen.getByText(/comes from its next run/i)).toBeTruthy();
  });

  it('uses the SAME outcome vocabulary as a run result, by design', () => {
    renderControl();
    const options = Array.from(screen.getByLabelText('Retest outcome').querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(options).toEqual(Object.values(UAT_OUTCOME).map(String));
  });

  it('clears back to "not retested" as null, not as zero', async () => {
    renderControl({ pmo_retestoutcome: UAT_OUTCOME.Fail });
    fireEvent.change(screen.getByLabelText('Retest outcome'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());
    const payload = (updateDefect.mock.calls[0][0] as { payload: Record<string, unknown> }).payload;
    expect(payload.pmo_retestoutcome).toBeNull();
  });
});

describe('the control never writes a column the table does not have', () => {
  const source = Object.values(
    import.meta.glob('./DefectStatusControl.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  )[0];
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('never names pmo_category or pmo_assignedteam', () => {
    // Finding 27: neither column exists. A write to one is a 400, and a picker for one invites
    // an answer nothing can store.
    expect(code).not.toContain('pmo_category');
    expect(code).not.toContain('pmo_assignedteam');
  });

  it('never writes the case\'s execution status', () => {
    expect(code).not.toContain('pmo_executionstatus');
    expect(code).not.toContain('useUpdateUatTestCase');
  });
});

/**
 * The assignee, which T043's acceptance names alongside severity, priority and the four dates.
 *
 * It is a `systemuser` lookup that exists on the table (unlike `pmo_assignedteam`, finding 27) and
 * was already being selected by `uatDefects.api.ts` — read and then never rendered, so an operator
 * could not set one. These tests exist because "the column is fetched" is not the same claim as
 * "a person can assign a defect", and only the second one is the acceptance.
 */
describe('the assignee saves and reads back (T043)', () => {
  it('shows the person already assigned rather than reading as unassigned', async () => {
    renderControl({ _pmo_assignedto_value: 'u-7' } as Partial<UatDefect>);
    await waitFor(() => expect(resolveUserLabel).toHaveBeenCalledWith('u-7'));
    expect(await screen.findByRole('button', { name: 'Weir, Patrick' })).toBeTruthy();
  });

  it('is a labelled group, because the picker exposes no id a label could point at', () => {
    renderControl();
    expect(screen.getByRole('group', { name: 'Assignee' })).toBeTruthy();
  });

  it('assigns an unassigned defect through the org-wide search', async () => {
    renderControl();
    await assignTo('Weir, Patrick');
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());
    expect(firstPayload()['pmo_AssignedTo@odata.bind']).toBe('/systemusers(u-7)');
  });

  it('sends null when the assignee is cleared, because unassigned is a real answer', async () => {
    renderControl({ _pmo_assignedto_value: 'u-7' } as Partial<UatDefect>);
    // The trigger reads the resolved name once it resolves; the popover's own "Unassigned" entry
    // only appears while a value is set, and choosing it is how a defect is handed back.
    fireEvent.click(await screen.findByRole('button', { name: 'Weir, Patrick' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unassigned' }));
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());
    // Explicitly null, NOT absent: an omitted bind would leave the old assignee in place, which
    // is the failure this asserts against.
    expect(firstPayload()['pmo_AssignedTo@odata.bind']).toBeNull();
  });

  it('does not rewrite the lookup when only the severity changed', async () => {
    // The same discipline as the dates: a re-save must not rewrite what nobody touched. Without
    // this, every status change would also re-stamp the assignee.
    renderControl({ _pmo_assignedto_value: 'u-7' } as Partial<UatDefect>);
    fireEvent.change(screen.getByLabelText('Severity'), {
      target: { value: String(UAT_DEFECT_SEVERITY.High) },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => expect(updateDefect).toHaveBeenCalled());
    expect('pmo_AssignedTo@odata.bind' in firstPayload()).toBe(false);
    expect(firstPayload().pmo_severity).toBe(UAT_DEFECT_SEVERITY.High);
  });

  it('enables Save on an assignee change alone', async () => {
    renderControl();
    expect(screen.getByRole('button', { name: /Save changes/i }).hasAttribute('disabled')).toBe(true);
    await assignTo('Weir, Patrick');
    expect(screen.getByRole('button', { name: /Save changes/i }).hasAttribute('disabled')).toBe(false);
  });
});
