/**
 * T027's write acceptance: exactly one answer row per question, each carrying its snapshots,
 * and the three minute outcomes kept distinguishable by query rather than by reading text.
 *
 * WHAT THE SNAPSHOT TEST IS ACTUALLY FOR. FR-015 says a later template edit must not change
 * what a completed run displays, and the mechanism is that the answer row stores the question
 * wording and the outcome label as the tester read them. The failure mode is invisible at write
 * time: an answer row written with a null or joined-later question text looks fine on the day
 * and starts lying the moment somebody edits the template. Nothing fails, no error is raised —
 * the record simply becomes a different record. So the assertion is on the payload, per row.
 *
 * HOW THE CLOCK IS CONTROLLED HERE, AND WHY NOT WITH FAKE TIMERS. Fake timers and userEvent
 * deadlock: userEvent awaits real callbacks that a frozen clock never fires, and all twelve
 * interactive tests timed out at 5s. Rather than fight that, this file seeds the run's LEDGER —
 * the actual source of the measure — with known intervals, and lets real time pass (about none
 * of it). The clock arithmetic itself has no UI in it and is tested under fake timers where
 * nothing is clicking, in useUatTimer.test.ts. Each claim lands in the file that can state it
 * cleanly.
 *
 * THE MINUTES FLAG IS THE OTHER SILENT ONE. `pmo_minutesoverridden` must be written EXPLICITLY
 * false on a measured save. A null there is not a smaller version of false; it is
 * "unknowable", and it turns "how much of this effort metric was measured?" from a filter into
 * a guess. The legacy column this replaces was hand-typed and then gated a flow at a
 * hard-coded 240.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UAT_OUTCOME, UAT_EXECUTION_STATUS, UAT_RESPONSE_TYPE } from '../../../lib/uatOptionSets';
import { ledgerKey } from '../hooks/useUatTimer';
import { DEFAULT_OBSERVED_VALUE_LABEL } from '../lib/questionGrouping';
import type { UatTemplateQuestion } from '../../../models/uatTemplate.model';
import type { UatTestRun } from '../../../models/uatTestRun.model';

const RUN_ID = '55555555-5555-5555-5555-555555555555';
const CASE_ID = '33333333-3333-3333-3333-333333333333';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '77777777-7777-7777-7777-777777777777';
const MIN = 60_000;

let mockQuestions: UatTemplateQuestion[] = [];
const createAnswer = vi.fn((_p: Record<string, unknown>) => Promise.resolve({}));
const updateRun = vi.fn((_p: { id: string; payload: Record<string, unknown> }) => Promise.resolve({}));
const updateCase = vi.fn((_p: { id: string; payload: Record<string, unknown> }) => Promise.resolve({}));

vi.mock('../../../hooks/useUatTemplates', () => ({
  useUatTemplateQuestions: () => ({ data: mockQuestions, isLoading: false, isError: false }),
}));
vi.mock('../../../hooks/useUatTestRuns', () => ({
  useCreateUatTestRunAnswer: () => ({ mutateAsync: createAnswer, isPending: false }),
  useUpdateUatTestRun: () => ({ mutateAsync: updateRun, isPending: false }),
}));
vi.mock('../../../hooks/useUatTestCases', () => ({
  useUpdateUatTestCase: () => ({ mutateAsync: updateCase, isPending: false }),
  // T042 reads the case's coverage to decide whether a defect can pre-link a requirement.
  // Empty here: this suite is about answer rows and durations.
  useCoverageForTestCase: () => ({ data: [] }),
}));

// T042 mounted the defect dialog in this form's footer. It writes through its own hooks and
// has its own suite; stubbed so a render here needs no QueryClientProvider.
vi.mock('./DefectCreateDialog', () => ({
  DefectCreateDialog: () => null,
}));
// T032 mounted the evidence panel inside this form. It reads through react-query, and this
// suite renders the body with no QueryClientProvider because nothing else in it needs one.
// Stubbed rather than provided: these tests are about answer rows and durations, and that
// the panel is mounted here at all is asserted in UatAttachmentMounts.test.tsx, where the
// claim belongs.
vi.mock('./UatAttachmentMounts', () => ({
  UatEvidenceFor: () => null,
}));

import { TestRunFormBody } from './TestRunFormBody';

function question(over: Partial<UatTemplateQuestion> & { pmo_sequence: number }): UatTemplateQuestion {
  return {
    pmo_uattemplatequestionid: `q-${over.pmo_sequence}`,
    pmo_questiontext: `Question ${over.pmo_sequence}`,
    _pmo_template_value: TEMPLATE_ID,
    pmo_helptext: null,
    pmo_expectedresult: null,
    pmo_responsetype: UAT_RESPONSE_TYPE.Choice,
    pmo_isrequired: true,
    pmo_capturesobservedvalue: false,
    // Null on all thirteen seeded questions — finding 31.
    pmo_observedvaluelabel: null,
    pmo_allowscomment: false,
    pmo_allowsattachment: false,
    pmo_section: null,
    ...over,
  } as UatTemplateQuestion;
}

function run(over: Partial<UatTestRun> = {}): UatTestRun {
  return {
    pmo_uattestrunid: RUN_ID,
    pmo_name: 'RUN-1000',
    pmo_runnumber: 1,
    pmo_startedon: new Date().toISOString(),
    pmo_iscurrent: true,
    ...over,
  } as UatTestRun;
}

/**
 * Put a known measure in front of the timer.
 *
 * The ledger IS the measure — the hook reconciles whatever it finds and appends a fresh span
 * for this session — so seeding it is how a test states "this run has already had N minutes of
 * work" without any clock manipulation. It also exercises the reconciliation path the real app
 * takes on every reopen.
 */
function seedLedger(...spans: [msAgoStart: number, msAgoEnd: number][]) {
  const now = Date.now();
  window.localStorage.setItem(ledgerKey(RUN_ID), JSON.stringify({
    runId: RUN_ID,
    startedOn: new Date(now - spans[0][0]).toISOString(),
    intervals: spans.map(([from, to]) => ({ startedAt: now - from, endedAt: now - to })),
  }));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockQuestions = [
    question({ pmo_sequence: 1, pmo_questiontext: 'Does the claim total match?' }),
    question({ pmo_sequence: 2, pmo_questiontext: 'Is the member eligible?' }),
  ];
});

function renderBody(props: Partial<React.ComponentProps<typeof TestRunFormBody>> = {}) {
  const onCompleted = vi.fn();
  const onCancel = vi.fn();
  render(
    <TestRunFormBody
      run={run()}
      testCaseId={CASE_ID}
      projectId={PROJECT_ID}
      templateId={TEMPLATE_ID}
      onCancel={onCancel}
      onCompleted={onCompleted}
      {...props}
    />,
  );
  return { onCompleted, onCancel };
}

function setupUser() {
  return userEvent.setup();
}

async function answer(user: ReturnType<typeof setupUser>, questionSeq: number, label: RegExp) {
  await user.click(screen.getByLabelText(new RegExp(`^Outcome$`), { selector: `#outcome-q-${questionSeq}` }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('one answer row per question, each with its snapshots (FR-014, FR-015)', () => {
  it('writes exactly one row per question, carrying the wording and the label as read', async () => {
    const user = setupUser();
    renderBody();

    await answer(user, 1, /^Pass$/);
    await answer(user, 2, /^Fail$/);
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    // Exactly one per question. Not one per answered question, and never two.
    expect(createAnswer).toHaveBeenCalledTimes(2);

    const first = createAnswer.mock.calls[0][0];
    expect(first.pmo_questiontextsnapshot).toBe('Does the claim total match?');
    expect(first.pmo_responselabelsnapshot).toBe('Pass');
    expect(first.pmo_outcome).toBe(UAT_OUTCOME.Pass);
    expect(first.pmo_sequence).toBe(1);
    expect(first['pmo_TestRun@odata.bind']).toBe(`/pmo_uattestruns(${RUN_ID})`);

    const second = createAnswer.mock.calls[1][0];
    expect(second.pmo_questiontextsnapshot).toBe('Is the member eligible?');
    expect(second.pmo_responselabelsnapshot).toBe('Fail');
    expect(second.pmo_outcome).toBe(UAT_OUTCOME.Fail);
  });

  it('still writes a row for an unanswered question, with a null label rather than a guess', async () => {
    const user = setupUser();
    renderBody();

    await answer(user, 1, /^Pass$/);
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(createAnswer).toHaveBeenCalledTimes(2));
    const second = createAnswer.mock.calls[1][0];
    // The question was asked, so the row exists; nothing was chosen, so the label is null.
    // Defaulting it to "Pass" would be inventing a result, and omitting the row would lose
    // the fact that the question was put to the tester at all.
    expect(second.pmo_questiontextsnapshot).toBe('Is the member eligible?');
    expect(second.pmo_outcome).toBeNull();
    expect(second.pmo_responselabelsnapshot).toBeNull();
  });

  it('drives the run and case status from the answers, never from a literal', async () => {
    const user = setupUser();
    renderBody();

    // One failing answer among passes. T024's stated cell: the case reads Returned for Defect.
    await answer(user, 1, /^Pass$/);
    await answer(user, 2, /^Fail$/);
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    const payload = updateRun.mock.calls[0][0].payload;
    expect(payload.pmo_result).toBe(UAT_OUTCOME.Fail);
    expect(payload.pmo_status).toBe(UAT_EXECUTION_STATUS.ReturnedForDefect);

    await waitFor(() => expect(updateCase).toHaveBeenCalledTimes(1));
    expect(updateCase.mock.calls[0][0].payload.pmo_executionstatus)
      .toBe(UAT_EXECUTION_STATUS.ReturnedForDefect);
  });

  it('reads In Process — never Fail — when a question is left unanswered', async () => {
    const user = setupUser();
    renderBody();
    await answer(user, 1, /^Pass$/);
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    expect(updateRun.mock.calls[0][0].payload.pmo_status).toBe(UAT_EXECUTION_STATUS.InProcess);
  });
});

describe('the three minute outcomes stay distinguishable by query', () => {
  it('a measured save writes pmo_minutesoverridden explicitly FALSE', async () => {
    const user = setupUser();
    // Two and a half minutes of work already in the ledger.
    seedLedger([150 * 1000, 0]);
    renderBody();
    await answer(user, 1, /^Pass$/);
    await answer(user, 2, /^Pass$/);
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    const payload = updateRun.mock.calls[0][0].payload;
    // Explicitly false, never null: null means "unknowable", which turns a filter into a guess.
    expect(payload.pmo_minutesoverridden).toBe(false);
    expect(Object.hasOwn(payload, 'pmo_minutesoverridden')).toBe(true);
    expect(payload.pmo_minutes).toBe(3);
    // Nothing to explain, so no measured-detail line is bolted onto the comments.
    expect(payload.pmo_comments).toBeNull();
  });

  it('a hand-entered duration sets the flag TRUE and keeps the measured detail (FR-019)', async () => {
    const user = setupUser();
    seedLedger([150 * 1000, 0]);
    renderBody();

    const minutes = screen.getByLabelText(/^Minutes$/);
    await user.clear(minutes);
    await user.type(minutes, '45');
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    const payload = updateRun.mock.calls[0][0].payload;
    expect(payload.pmo_minutes).toBe(45);
    expect(payload.pmo_minutesoverridden).toBe(true);
    // The typed number must not quietly replace what was observed.
    expect(String(payload.pmo_comments)).toContain('Measured 2m 30s of active time');
  });

  it('refuses a non-integer duration rather than sending it to the platform', async () => {
    const user = setupUser();
    renderBody();
    const minutes = screen.getByLabelText(/^Minutes$/);
    await user.clear(minutes);
    await user.type(minutes, '4.5');

    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
    expect(screen.getByRole('button', { name: /complete run/i })).toBeDisabled();
    expect(updateRun).not.toHaveBeenCalled();
  });

  it('records a PROPOSED span as an override, shows it, and does not block the save (FR-020)', async () => {
    // No stored ledger and a start two hours ago: this browser did not observe the work.
    const user = setupUser();
    renderBody({ run: run({ pmo_startedon: new Date(Date.now() - 120 * MIN).toISOString() }) });

    // The tester is told, rather than it happening silently.
    expect(screen.getByRole('status')).toHaveTextContent(/accept it or correct it/i);
    expect(screen.getByText(/proposed from the clock/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Minutes$/)).toHaveValue('120');

    // And accepting it untouched still records an override, because nothing measured it.
    await user.click(screen.getByRole('button', { name: /complete run/i }));
    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    const payload = updateRun.mock.calls[0][0].payload;
    expect(payload.pmo_minutes).toBe(120);
    expect(payload.pmo_minutesoverridden).toBe(true);
  });

  it('writes only the ACTIVE spans, so a break never reaches pmo_minutes (FR-018)', async () => {
    const user = setupUser();
    // One minute worked, half an hour away, one more minute worked. Whether the gap was a
    // declared pause or a closed tab, the ledger records it identically — as absence.
    seedLedger([32 * MIN, 31 * MIN], [MIN, 0]);
    renderBody();

    await user.click(screen.getByRole('button', { name: /complete run/i }));
    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    // Two minutes of work, not thirty-two, and still a measure rather than an override.
    expect(updateRun.mock.calls[0][0].payload.pmo_minutes).toBe(2);
    expect(updateRun.mock.calls[0][0].payload.pmo_minutesoverridden).toBe(false);
  });

  it('shows the pause control and says the paused time is not counted', async () => {
    // The UI half of FR-018. The arithmetic is proven under a controllable clock in
    // useUatTimer.test.ts, where nothing is clicking; here what matters is that a tester can
    // pause at all and is told what pausing means.
    const user = setupUser();
    renderBody();

    await user.click(screen.getByRole('button', { name: /^pause$/i }));
    expect(screen.getByText(/paused — not counted/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(screen.queryByText(/paused — not counted/i)).toBeNull();
    // Resuming opens a new active span rather than reopening the old one, which is what makes
    // the break a gap instead of something to subtract.
    const stored = JSON.parse(window.localStorage.getItem(ledgerKey(RUN_ID)) ?? '{}');
    expect(stored.intervals).toHaveLength(2);
  });

  it('clears the local ledger once the measure is in Dataverse', async () => {
    const user = setupUser();
    seedLedger([5 * 1000, 0]);
    renderBody();
    expect(window.localStorage.getItem(ledgerKey(RUN_ID))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /complete run/i }));
    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    // Left behind, it would reconcile into a future run of the same id and add phantom time.
    expect(window.localStorage.getItem(ledgerKey(RUN_ID))).toBeNull();
  });
});

describe('an ad-hoc case gets no invented questions', () => {
  it('writes ZERO answer rows and still derives its status the same way', async () => {
    mockQuestions = [];
    const user = setupUser();
    renderBody({ templateId: null });

    await user.click(screen.getByLabelText(/^Outcome$/));
    await user.click(await screen.findByRole('option', { name: /^Pass$/ }));
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(updateRun).toHaveBeenCalledTimes(1));
    // A row carrying a made-up question like "Overall result" would be indistinguishable from
    // real template content, which is finding 31's rule.
    expect(createAnswer).not.toHaveBeenCalled();
    const payload = updateRun.mock.calls[0][0].payload;
    expect(payload.pmo_result).toBe(UAT_OUTCOME.Pass);
    // Same derivation as a templated run, so the two cannot end up under two status rules.
    expect(payload.pmo_status).toBe(UAT_EXECUTION_STATUS.Completed);
  });
});

describe('the run form and the template editor read the same question the same way', () => {
  it('renders the neutral observed-value fallback for a null label (finding 31)', () => {
    mockQuestions = [
      question({
        pmo_sequence: 1,
        pmo_capturesobservedvalue: true,
        pmo_observedvaluelabel: null,
      }),
    ];
    renderBody();
    // The editor's other consumer. An invented heading here would be indistinguishable from a
    // label the owner authored, which is worse than a visible gap.
    expect(screen.getByLabelText(DEFAULT_OBSERVED_VALUE_LABEL)).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('routes an observed value to the typed column its response type calls for', async () => {
    mockQuestions = [
      question({ pmo_sequence: 1, pmo_capturesobservedvalue: true, pmo_responsetype: UAT_RESPONSE_TYPE.Number }),
    ];
    const user = setupUser();
    renderBody();

    await user.type(screen.getByLabelText(DEFAULT_OBSERVED_VALUE_LABEL), '1234');
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(createAnswer).toHaveBeenCalledTimes(1));
    const payload = createAnswer.mock.calls[0][0];
    expect(payload.pmo_observednumber).toBe(1234);
    expect(payload.pmo_observedvalue).toBeNull();
    expect(payload.pmo_observeddate).toBeNull();
  });
});

describe('set-all-results applies locally and only to unanswered questions (T028)', () => {
  it('fills every unanswered question and leaves answered ones alone', async () => {
    const user = setupUser();
    mockQuestions = [
      question({ pmo_sequence: 1, pmo_questiontext: 'Does the claim total match?' }),
      question({ pmo_sequence: 2, pmo_questiontext: 'Is the member eligible?' }),
      question({ pmo_sequence: 3, pmo_questiontext: 'Is the copay right?' }),
    ];
    renderBody();

    // The tester marks the one that failed, then bulk-passes the rest.
    await answer(user, 2, /^Fail$/);
    await user.click(screen.getByLabelText(/set the remaining answers/i));
    await user.click(await screen.findByRole('option', { name: /^Pass$/ }));
    await user.click(screen.getByRole('button', { name: /apply to 2 unanswered/i }));
    await user.click(screen.getByRole('button', { name: /complete run/i }));

    await waitFor(() => expect(createAnswer).toHaveBeenCalledTimes(3));
    const outcomes = createAnswer.mock.calls.map((c) => c[0].pmo_outcome);
    // The deliberate Fail survives. Overwriting it would destroy the finding the run exists to
    // record, and the destruction would be invisible — everything would read Pass.
    expect(outcomes).toEqual([UAT_OUTCOME.Pass, UAT_OUTCOME.Fail, UAT_OUTCOME.Pass]);
    // And the run still reads Fail, not Completed.
    expect(updateRun.mock.calls[0][0].payload.pmo_result).toBe(UAT_OUTCOME.Fail);
  });

  it('counts down as questions get answered, and offers nothing when none are left', async () => {
    const user = setupUser();
    mockQuestions = [
      question({ pmo_sequence: 1 }),
      question({ pmo_sequence: 2 }),
    ];
    renderBody();

    expect(screen.getByRole('button', { name: /apply to 2 unanswered/i })).toBeTruthy();
    await answer(user, 1, /^Pass$/);
    expect(screen.getByRole('button', { name: /apply to 1 unanswered/i })).toBeTruthy();
    await answer(user, 2, /^Blocked$/);
    // Never offer an action that would do nothing.
    expect(screen.getByRole('button', { name: /every question answered/i })).toBeDisabled();
  });

  it('writes nothing when applied — it is form state until the run is completed', async () => {
    const user = setupUser();
    renderBody();

    await user.click(screen.getByLabelText(/set the remaining answers/i));
    await user.click(await screen.findByRole('option', { name: /^Pass$/ }));
    await user.click(screen.getByRole('button', { name: /apply to 2 unanswered/i }));

    // The legacy version was an activated Dataverse business rule copying one field into
    // fourteen. No request may leave the browser until Complete run.
    expect(createAnswer).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(updateCase).not.toHaveBeenCalled();
  });

  it('has no server-side copy step anywhere in the component', () => {
    // The value tests above show no call happened in one scenario. This shows the component
    // has no way to make one — the claim "no Dataverse business rule and no server-side copy
    // step" is about the design, and only the source can state that.
    const source = Object.values(
      import.meta.glob('./SetAllResultsButton.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
    )[0];
    expect(source, 'SetAllResultsButton.tsx was not loaded').toBeTruthy();
    expect(source).not.toContain('useAppMutation');
    expect(source).not.toContain('mutateAsync');
    expect(source).not.toMatch(/from '.*\/api\//);
  });

  it('is absent for an ad-hoc run, which has no questions to fan out to', () => {
    mockQuestions = [];
    renderBody({ templateId: null });
    expect(screen.queryByLabelText(/set the remaining answers/i)).toBeNull();
  });
});
