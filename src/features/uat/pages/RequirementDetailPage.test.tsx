/**
 * T047 — the two-level hierarchy displays and RE-PARENTS, and the ITPR is not here.
 *
 * Re-parenting is a real operation on a requirement and a refused one on a test case, and the
 * difference is worth pinning: a requirement's parent is `pmo_parent`, self-referential and
 * RemoveLink, so moving a story changes nothing else. A test case's project is duplicated onto
 * its runs so rollups need no join, so moving one leaves two references to reconcile. The tests
 * assert the parent choices exclude this requirement and its own children, because a requirement
 * cannot be its own ancestor and a two-level model has nowhere to put a grandchild.
 *
 * The ITPR assertions are here because T047 is where the clause lives: a single editable
 * reference field on the project's UAT settings, not its own list and not a lookup. A source scan
 * proves neither requirement page mentions it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const requirementState = { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() };
const siblingsState = { data: [] as Record<string, unknown>[] };
const coverageState = { data: [] as Record<string, unknown>[], refetch: vi.fn() };
const reparent = vi.fn();

vi.mock('../../../hooks/useUatRequirements', () => ({
  useUatRequirement: () => requirementState,
  useUatRequirements: () => siblingsState,
  useReparentUatRequirement: () => ({ mutateAsync: reparent, isPending: false }),
}));
vi.mock('../../../hooks/useUatTestCases', () => ({
  useCoverageForRequirement: () => coverageState,
  useAllUatTestCases: () => ({ data: [
    { pmo_uattestcaseid: 'TC1', pmo_name: 'TC-1001', pmo_title: 'Totals', _pmo_projectref_value: 'p-1' },
    { pmo_uattestcaseid: 'TC2', pmo_name: 'TC-1002', pmo_title: 'Eligibility', _pmo_projectref_value: 'p-1' },
  ] }),
}));

const linkDialogProps: Record<string, unknown>[] = [];
vi.mock('../components/CoverageLinkDialog', () => ({
  CoverageLinkDialog: (props: Record<string, unknown>) => {
    linkDialogProps.push(props);
    return props.open ? <div data-testid="link-dialog" /> : null;
  },
}));

const evidenceMounts: Record<string, unknown>[] = [];
vi.mock('../components/UatAttachmentMounts', () => ({
  UatEvidenceFor: (props: Record<string, unknown>) => {
    evidenceMounts.push(props);
    return <div data-testid="evidence-panel" />;
  },
}));

import { RequirementDetailPage } from './RequirementDetailPage';
import { UAT_COVERAGE_TYPE, UAT_REQUIREMENT_TYPE } from '../../../lib/uatOptionSets';

const requirement = (over: Record<string, unknown> = {}) => ({
  pmo_uatrequirementid: 'S1',
  pmo_name: 'REQ-1002',
  pmo_title: 'Member must be eligible',
  pmo_description: 'The claim must belong to an eligible member.',
  pmo_acceptancecriteria: 'Given an ineligible member, the claim is denied.',
  pmo_type: UAT_REQUIREMENT_TYPE.Story,
  pmo_status: null,
  _pmo_parent_value: 'E1',
  _pmo_projectref_value: 'p-1',
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/uat/requirements/S1']}>
      <Routes>
        <Route path="/uat/requirements/:id" element={<RequirementDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  linkDialogProps.length = 0;
  evidenceMounts.length = 0;
  requirementState.data = requirement();
  requirementState.isPending = false;
  requirementState.isError = false;
  siblingsState.data = [
    { pmo_uatrequirementid: 'E1', pmo_name: 'REQ-1001', pmo_title: 'Claims epic', _pmo_parent_value: null },
    { pmo_uatrequirementid: 'S1', pmo_name: 'REQ-1002', pmo_title: 'Member must be eligible', _pmo_parent_value: 'E1' },
    { pmo_uatrequirementid: 'S2', pmo_name: 'REQ-1003', pmo_title: 'A child of this one', _pmo_parent_value: 'S1' },
    { pmo_uatrequirementid: 'E2', pmo_name: 'REQ-1004', pmo_title: 'Another epic', _pmo_parent_value: null },
  ];
  coverageState.data = [];
  reparent.mockResolvedValue({});
});

describe('the hierarchy displays and re-parents', () => {
  it('shows the current parent', () => {
    renderPage();
    expect((screen.getByLabelText('Parent') as HTMLSelectElement).value).toBe('E1');
  });

  it('moves the requirement under a different parent', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Parent'), { target: { value: 'E2' } });
    await waitFor(() => expect(reparent).toHaveBeenCalledWith({ id: 'S1', parentId: 'E2' }));
  });

  it('promotes it to top level, sending null rather than an empty string', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Parent'), { target: { value: '' } });
    await waitFor(() => expect(reparent).toHaveBeenCalledWith({ id: 'S1', parentId: null }));
  });

  it('excludes itself and its own children from the parent choices', () => {
    // A requirement cannot be its own ancestor, and a two-level model has no grandchildren.
    renderPage();
    const options = Array.from(screen.getByLabelText('Parent').querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('E1');
    expect(options).toContain('E2');
    expect(options).not.toContain('S1');   // itself
    expect(options).not.toContain('S2');   // its child
  });

  it('says why re-parenting is safe here, unlike a test case\'s project', () => {
    renderPage();
    expect(screen.getByText(/not a copy held anywhere/i)).toBeTruthy();
  });
});

describe('coverage links from the requirement side', () => {
  it('says plainly that nothing covers it, and that this counts as untested', () => {
    renderPage();
    expect(screen.getByText(/counts as untested/i)).toBeTruthy();
  });

  it('lists its links with their coverage type', () => {
    coverageState.data = [
      { pmo_uatcoveragelinkid: 'cl-1', _pmo_testcase_value: 'TC1', pmo_coveragetype: UAT_COVERAGE_TYPE.Verifies },
    ];
    renderPage();
    const table = within(screen.getByTestId('uat-coverage-links'));
    expect(table.getByText(/TC-1001 · Totals/)).toBeTruthy();
    expect(table.getByText('Verifies')).toBeTruthy();
  });

  it('opens the ONE link dialog with this requirement fixed', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Link a test case/i }));
    expect(screen.getByTestId('link-dialog')).toBeTruthy();
    const props = linkDialogProps[linkDialogProps.length - 1];
    expect(props.from).toBe('requirement');
    expect(props.fixedId).toBe('S1');
  });

  it('offers only cases that are not already linked', () => {
    coverageState.data = [
      { pmo_uatcoveragelinkid: 'cl-1', _pmo_testcase_value: 'TC1', pmo_coveragetype: UAT_COVERAGE_TYPE.Verifies },
    ];
    renderPage();
    const props = linkDialogProps[linkDialogProps.length - 1];
    expect((props.candidates as { id: string }[]).map((c) => c.id)).toEqual(['TC2']);
  });

  it('mounts the requirement\'s evidence — T032\'s last deferred parent', () => {
    renderPage();
    expect(evidenceMounts.some((m) => m.parent === 'Requirement' && m.recordId === 'S1')).toBe(true);
  });
});

describe('the ITPR is not a requirement record type (G-ITPR)', () => {
  const sources = import.meta.glob(
    ['./RequirementDetailPage.tsx', './RequirementListPage.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  it('is never mentioned on either requirement page', () => {
    // T047: a single editable reference field on the project's UAT settings — not its own list,
    // not a lookup to a record type. The absence is the assertion.
    for (const [path, source] of Object.entries(sources)) {
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, path).not.toContain('itpr');
      expect(code.toLowerCase(), path).not.toContain('pmo_itprnumber');
    }
  });

  it('does not render an ITPR field on the requirement', () => {
    renderPage();
    expect(screen.queryByLabelText(/itpr/i)).toBeNull();
  });
});

describe('states', () => {
  it('says it is loading rather than rendering an empty requirement', () => {
    requirementState.isPending = true;
    renderPage();
    expect(screen.getByText(/Loading the requirement/i)).toBeTruthy();
  });

  it('offers a retry when the requirement cannot be read', () => {
    requirementState.isError = true;
    requirementState.data = undefined;
    renderPage();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i);
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });
});
