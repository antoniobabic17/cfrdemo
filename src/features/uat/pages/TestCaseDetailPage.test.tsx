import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UAT_EXECUTION_STATUS, UAT_OUTCOME, UAT_PRIORITY, UAT_SOURCE } from '../../../lib/uatOptionSets';
import type { UatTestCase } from '../../../models/uatTestCase.model';
import type { UatCycle, UatTestRun, UatTestRunAnswer } from '../../../models/uatTestRun.model';

const updateCase = vi.fn((_p: { id: string; payload: Record<string, unknown> }) => Promise.resolve({}));
const refetchCase = vi.fn();
const refetchRuns = vi.fn();

const CASE_ID = '33333333-3333-3333-3333-333333333333';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID = '55555555-5555-5555-5555-555555555555';
const CYCLE_ID = '22222222-2222-2222-2222-222222222222';

let mockCase: UatTestCase;
let mockRuns: UatTestRun[];
let mockAnswers: UatTestRunAnswer[];
let mockCycles: UatCycle[];

vi.mock('../../../hooks/useUatTestCases', () => ({
  useUatTestCase: () => ({ data: mockCase, isLoading: false, isError: false, refetch: refetchCase }),
  useUpdateUatTestCase: () => ({ mutateAsync: updateCase, isPending: false }),
}));

vi.mock('../../../hooks/useUatTestRuns', () => ({
  useUatTestRuns: () => ({ data: mockRuns, isLoading: false, isError: false, refetch: refetchRuns }),
  useUatTestRunAnswers: () => ({ data: mockAnswers, isLoading: false, isError: false, refetch: vi.fn() }),
  useUatCycles: () => ({ data: mockCycles }),
}));

vi.mock('../components/TestRunForm', () => ({
  TestRunForm: () => <div data-testid="start-run-form" />,
}));

vi.mock('../components/UatAttachmentMounts', () => ({
  UatEvidenceFor: (props: { parent: string; recordId: string; readOnly?: boolean }) => (
    <div data-testid={`evidence-${props.parent}`} data-record-id={props.recordId} data-read-only={String(props.readOnly === true)} />
  ),
}));

import { TestCaseDetailPage } from './TestCaseDetailPage';

function testCase(over: Partial<UatTestCase> = {}): UatTestCase {
  return {
    pmo_uattestcaseid: CASE_ID,
    pmo_name: 'TC-1010',
    pmo_title: 'UAT-DEV-20260918-SEED-CASE-COMPLETE',
    pmo_objective: 'Prove the completed flow.',
    pmo_scenario: 'Scenario text',
    pmo_preconditions: 'Preconditions text',
    pmo_testdata: 'Synthetic data only',
    pmo_priority: UAT_PRIORITY.Medium,
    pmo_executionstatus: UAT_EXECUTION_STATUS.Completed,
    pmo_source: UAT_SOURCE.Template,
    _pmo_template_value: '77777777-7777-7777-7777-777777777777',
    _pmo_cycle_value: CYCLE_ID,
    _pmo_importbatch_value: null,
    _pmo_assignedtester_value: null,
    _pmo_project_value: null,
    _pmo_projectref_value: PROJECT_ID,
    pmo_plannedstart: '2026-09-01',
    pmo_plannedend: '2026-09-10',
    pmo_estimatedminutes: 30,
    pmo_externalsystem: null,
    pmo_externalkey: 'ITPR1234567',
    pmo_externalid: null,
    pmo_externalurl: null,
    pmo_externalstatus: null,
    pmo_externalsyncedon: null,
    statecode: 0,
    statuscode: 1,
    createdon: '2026-09-18T00:00:00Z',
    modifiedon: '2026-09-18T00:00:00Z',
    ...over,
  };
}

function run(over: Partial<UatTestRun> = {}): UatTestRun {
  return {
    pmo_uattestrunid: RUN_ID,
    pmo_name: 'UAT-DEV-20260918-SEED-RUN-COMPLETE',
    _pmo_testcase_value: CASE_ID,
    _pmo_cycle_value: CYCLE_ID,
    _pmo_tester_value: null,
    _pmo_project_value: null,
    _pmo_projectref_value: PROJECT_ID,
    pmo_runnumber: 1,
    pmo_startedon: '2026-09-18T14:00:00Z',
    pmo_completedon: '2026-09-18T14:12:00Z',
    pmo_minutes: 12,
    pmo_minutesoverridden: false,
    pmo_status: UAT_EXECUTION_STATUS.Completed,
    pmo_result: UAT_OUTCOME.Pass,
    pmo_comments: 'Completed run comments',
    pmo_iscurrent: true,
    statecode: 0,
    statuscode: 1,
    createdon: '2026-09-18T14:00:00Z',
    modifiedon: '2026-09-18T14:12:00Z',
    ...over,
  };
}

function answer(over: Partial<UatTestRunAnswer> = {}): UatTestRunAnswer {
  return {
    pmo_uattestrunanswerid: 'answer-1',
    pmo_questiontextsnapshot: 'Snapshot question from completed run',
    _pmo_testrun_value: RUN_ID,
    _pmo_templatequestion_value: 'question-1',
    pmo_sequence: 1,
    pmo_responselabelsnapshot: 'Pass',
    pmo_outcome: UAT_OUTCOME.Pass,
    pmo_observedvalue: 'Observed claim count',
    pmo_observednumber: null,
    pmo_observeddate: null,
    pmo_comment: 'Snapshot answer comment',
    statecode: 0,
    statuscode: 1,
    createdon: '2026-09-18T14:10:00Z',
    ...over,
  };
}

function cycle(over: Partial<UatCycle> = {}): UatCycle {
  return {
    pmo_uatcycleid: CYCLE_ID,
    pmo_name: 'UAT-DEV-20260918-SEED-CYCLE',
    pmo_description: null,
    pmo_status: null,
    pmo_plannedstart: '2026-09-01',
    pmo_plannedend: '2026-09-10',
    pmo_actualstart: null,
    pmo_actualend: null,
    pmo_sequence: 1,
    _pmo_project_value: null,
    _pmo_projectref_value: PROJECT_ID,
    statecode: 0,
    statuscode: 1,
    createdon: '2026-09-18T00:00:00Z',
    modifiedon: '2026-09-18T00:00:00Z',
    ...over,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={[`/uat/test-cases/${CASE_ID}`]}>
      <Routes>
        <Route path="/uat/test-cases/:id" element={<TestCaseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCase = testCase();
  mockRuns = [run()];
  mockAnswers = [answer()];
  mockCycles = [cycle()];
});

describe('completed run history is reachable from the case detail page', () => {
  it('opens a selected run and displays its stored snapshots read-only', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /open run uat-dev-20260918-seed-run-complete/i }));

    expect(await screen.findByRole('dialog', { name: /run uat-dev-20260918-seed-run-complete/i })).toBeTruthy();
    expect(screen.getByText('Snapshot question from completed run')).toBeTruthy();
    expect(screen.getByText('Observed claim count')).toBeTruthy();
    expect(screen.getByText('Snapshot answer comment')).toBeTruthy();
    expect(screen.getByText(/historical run details are read-only/i)).toBeTruthy();
    expect(screen.getByTestId('evidence-TestRun')).toHaveAttribute('data-record-id', RUN_ID);
    expect(screen.getByTestId('evidence-TestRun')).toHaveAttribute('data-read-only', 'true');
  });
});

describe('test case metadata can be corrected without rewriting run history', () => {
  it('saves metadata-only changes and does not send run or answer snapshot fields', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /edit test case/i }));
    await user.clear(await screen.findByLabelText(/^Title$/));
    await user.type(screen.getByLabelText(/^Title$/), 'Corrected completed case title');
    await user.clear(screen.getByLabelText(/^External key$/));
    await user.type(screen.getByLabelText(/^External key$/), 'ITPR-T28-20260918');
    await user.clear(screen.getByLabelText(/^Estimated minutes$/));
    await user.type(screen.getByLabelText(/^Estimated minutes$/), '45');
    await user.click(screen.getByRole('button', { name: /save test case/i }));

    await waitFor(() => expect(updateCase).toHaveBeenCalledTimes(1));
    expect(updateCase.mock.calls[0][0].id).toBe(CASE_ID);
    expect(updateCase.mock.calls[0][0].payload).toMatchObject({
      pmo_title: 'Corrected completed case title',
      pmo_externalkey: 'ITPR-T28-20260918',
      pmo_estimatedminutes: 45,
      'pmo_Cycle@odata.bind': `/pmo_uatcycles(${CYCLE_ID})`,
    });

    const payloadKeys = Object.keys(updateCase.mock.calls[0][0].payload);
    expect(payloadKeys).not.toContain('pmo_questiontextsnapshot');
    expect(payloadKeys).not.toContain('pmo_responselabelsnapshot');
    expect(payloadKeys).not.toContain('pmo_result');
    expect(payloadKeys).not.toContain('pmo_comments');
  });

  it('explains the edit boundary in the dialog instead of leaving the page unexplained', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /edit test case/i }));

    expect(await screen.findByText(/updates the test-case metadata only/i)).toBeTruthy();
    expect(screen.getByText(/completed run answers and question snapshots remain immutable/i)).toBeTruthy();
  });
});
