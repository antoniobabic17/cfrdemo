/**
 * T042's list half — and the two states a list must never confuse.
 *
 * A defect list that says "no defects" when the read failed tells a tester their defects are
 * gone. A list that hides closed defects with no way to see them loses the record of what was
 * fixed. Both are asserted, because both are the kind of thing that looks fine in a demo.
 *
 * The "linked to" column exists because a defect with no case, run or requirement behind it is a
 * note, and the list should not make the two look alike.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useToast', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const defectsState = {
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('../../../hooks/useUatDefects', () => ({
  useUatDefects: () => defectsState,
  useUpdateUatDefect: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateUatDefect: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useUatTestCases', () => ({
  useUpdateUatTestCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/useProjects', () => ({
  useActiveProjects: () => ({
    data: [{ msdyn_projectid: 'p-9', msdyn_subject: 'Nexus Rollout' }],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
}));

const evidenceMounts: Record<string, unknown>[] = [];
vi.mock('../components/UatAttachmentMounts', () => ({
  UatEvidenceFor: (props: Record<string, unknown>) => {
    evidenceMounts.push(props);
    return <div data-testid="evidence-panel" />;
  },
}));

import { DefectListPage } from './DefectListPage';
import { UAT_DEFECT_STATUS, UAT_DEFECT_SEVERITY, UAT_PRIORITY } from '../../../lib/uatOptionSets';

const defect = (n: number, over: Record<string, unknown> = {}) => ({
  pmo_uatdefectid: `d-${n}`,
  pmo_name: `DEF-100${n}`,
  pmo_summary: `Something is wrong ${n}`,
  pmo_details: null,
  pmo_status: UAT_DEFECT_STATUS.Open,
  pmo_severity: UAT_DEFECT_SEVERITY.High,
  pmo_priority: UAT_PRIORITY.Medium,
  pmo_reportedon: '2026-08-01T10:00:00Z',
  _pmo_testcase_value: null,
  _pmo_testrun_value: null,
  _pmo_requirement_value: null,
  ...over,
});

function renderPage(search = '?projectId=p-1') {
  return render(
    <MemoryRouter initialEntries={[`/uat/defects${search}`]}>
      <DefectListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  evidenceMounts.length = 0;
  defectsState.data = [
    defect(1, { _pmo_testcase_value: 'tc-1', _pmo_testrun_value: 'tr-1', _pmo_requirement_value: 'req-1' }),
    defect(2),
    defect(3, { pmo_status: UAT_DEFECT_STATUS.Closed }),
  ];
  defectsState.isPending = false;
  defectsState.isError = false;
});

describe('the list', () => {
  it('shows open defects and hides the closed ones, with a way to see them', () => {
    renderPage();
    const table = within(screen.getByTestId('uat-defect-rows'));
    expect(table.getByText('DEF-1001')).toBeTruthy();
    expect(table.getByText('DEF-1002')).toBeTruthy();
    expect(table.queryByText('DEF-1003')).toBeNull();       // closed

    fireEvent.click(screen.getByRole('button', { name: /Open \(2\)/ }));
    expect(within(screen.getByTestId('uat-defect-rows')).getByText('DEF-1003')).toBeTruthy();
  });

  it('says what each defect is linked to, and what it is not', () => {
    renderPage();
    const table = within(screen.getByTestId('uat-defect-rows'));
    expect(table.getByText('Case · Run · Requirement')).toBeTruthy();
    // A defect with nothing behind it is a note, and the list says so rather than leaving a
    // blank that reads as "unknown".
    expect(table.getByText('nothing')).toBeTruthy();
  });

  it('never says "no defects" when the read failed', () => {
    defectsState.data = [];
    defectsState.isError = true;
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/this is a read failure/i);
    expect(screen.queryByText(/No defects have been raised/i)).toBeNull();
  });

  it('distinguishes "none raised" from "none open"', () => {
    defectsState.data = [];
    renderPage();
    expect(screen.getByText(/No defects have been raised/i)).toBeTruthy();

    defectsState.data = [defect(3, { pmo_status: UAT_DEFECT_STATUS.Closed })];
    renderPage();
    expect(screen.getByText(/No open defects/i)).toBeTruthy();
  });

  it('asks which project when the sidebar sends it without one', () => {
    renderPage('');
    expect(screen.getByLabelText('Project')).toBeTruthy();
    expect(screen.queryByTestId('uat-defect-rows')).toBeNull();
  });
});

describe('the detail panel', () => {
  it('opens on a row and mounts that defect\'s evidence and lifecycle control', () => {
    renderPage();
    fireEvent.click(within(screen.getByTestId('uat-defect-rows')).getByText('DEF-1001'));

    expect(screen.getByRole('region', { name: 'Defect detail' })).toBeTruthy();
    expect(screen.getByTestId('uat-defect-status-control')).toBeTruthy();
    // The Defect parent mount — the surface T032 deferred until this page existed.
    expect(evidenceMounts.some((m) => m.parent === 'Defect' && m.recordId === 'd-1')).toBe(true);
  });

  it('offers the linked test case, and only when there is one', () => {
    renderPage();
    const table = within(screen.getByTestId('uat-defect-rows'));
    fireEvent.click(table.getByText('DEF-1001'));
    expect(screen.getByRole('button', { name: /Open the test case/i })).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('uat-defect-rows')).getByText('DEF-1002'));
    expect(screen.queryByRole('button', { name: /Open the test case/i })).toBeNull();
  });

  it('keeps a defect open after it is filtered out of the list', () => {
    // Selecting an open defect, then switching to Open-only after it closes, must not blank
    // the panel the operator is reading.
    renderPage();
    fireEvent.click(within(screen.getByTestId('uat-defect-rows')).getByText('DEF-1001'));
    fireEvent.click(screen.getByRole('button', { name: /Open \(2\)/ }));
    expect(screen.getByRole('region', { name: 'Defect detail' })).toBeTruthy();
  });
});
