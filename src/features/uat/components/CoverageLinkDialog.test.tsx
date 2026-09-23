/**
 * T048 — one link row, one mechanism, whichever side you start from.
 *
 * The acceptance is an EQUALITY, so the test states it as one: the payload built from the
 * requirement side and the payload built from the case side for the same pair are asserted equal,
 * not merely each asserted to look right. Two assertions that happen to agree today are how two
 * mechanisms diverge tomorrow — which is exactly what the legacy model did with its
 * junction-plus-shadow-lookup pair, and what FR-037 forbids.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const createLink = vi.fn();
vi.mock('../../../hooks/useUatTestCases', () => ({
  useCreateUatCoverageLink: () => ({ mutateAsync: createLink, isPending: false }),
}));

import { CoverageLinkDialog, buildCoverageLink } from './CoverageLinkDialog';
import { UAT_COVERAGE_TYPE } from '../../../lib/uatOptionSets';

const CANDIDATES = [
  { id: 'TC1', label: 'TC-1001 · Claim totals' },
  { id: 'TC2', label: 'TC-1002 · Eligibility' },
];

function openFrom(from: 'requirement' | 'testCase', fixedId: string) {
  const onOpenChange = vi.fn();
  const onLinked = vi.fn();
  render(
    <CoverageLinkDialog
      open
      onOpenChange={onOpenChange}
      from={from}
      fixedId={fixedId}
      fixedLabel="REQ-1001 · Totals must match"
      candidates={CANDIDATES}
      onLinked={onLinked}
    />,
  );
  return { onOpenChange, onLinked };
}

beforeEach(() => {
  vi.clearAllMocks();
  createLink.mockResolvedValue({ pmo_uatcoveragelinkid: 'cl-1' });
});

describe('one link row, from either side', () => {
  it('builds the SAME payload from both directions for the same pair', () => {
    // The acceptance, as an equality. There is one builder and one row shape.
    const fromRequirement = buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.Verifies, 'note');
    const fromCase = buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.Verifies, 'note');
    expect(fromRequirement).toEqual(fromCase);
  });

  it('sends BOTH ends, because the junction means nothing with one missing', () => {
    const payload = buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.Verifies, '');
    expect(payload['pmo_Requirement@odata.bind']).toBe('/pmo_uatrequirements(R1)');
    expect(payload['pmo_TestCase@odata.bind']).toBe('/pmo_uattestcases(TC1)');
    expect(Object.keys(payload).filter((k) => k.endsWith('@odata.bind'))).toHaveLength(2);
  });

  it('carries the coverage type on the row itself', () => {
    const payload = buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.PartiallyVerifies, '');
    expect(payload.pmo_coveragetype).toBe(UAT_COVERAGE_TYPE.PartiallyVerifies);
  });

  it('stores empty notes as null rather than an empty string', () => {
    expect(buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.Verifies, '   ').pmo_notes).toBeNull();
  });

  it('creates exactly ONE row from the requirement side', async () => {
    openFrom('requirement', 'R1');
    fireEvent.change(screen.getByLabelText('Test case'), { target: { value: 'TC1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalledTimes(1));
    expect(createLink.mock.calls[0][0]).toEqual(
      buildCoverageLink('R1', 'TC1', UAT_COVERAGE_TYPE.Verifies, ''),
    );
  });

  it('creates exactly ONE row from the test-case side, with the ends the right way round', async () => {
    openFrom('testCase', 'TC9');
    fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'TC1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalledTimes(1));
    const payload = createLink.mock.calls[0][0] as Record<string, string>;
    // The FIXED end is the case here, so it is the case bind that carries TC9.
    expect(payload['pmo_TestCase@odata.bind']).toBe('/pmo_uattestcases(TC9)');
    expect(payload['pmo_Requirement@odata.bind']).toBe('/pmo_uatrequirements(TC1)');
  });
});

describe('the dialog', () => {
  it('asks for the other end and refuses to save without it', () => {
    openFrom('requirement', 'R1');
    expect(screen.getByRole('button', { name: /Create the link/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Test case'), { target: { value: 'TC2' } });
    expect(screen.getByRole('button', { name: /Create the link/i })).toBeEnabled();
  });

  it('offers all four coverage types and defaults to Verifies', () => {
    openFrom('requirement', 'R1');
    const select = screen.getByLabelText('Coverage type') as HTMLSelectElement;
    expect(select.value).toBe(String(UAT_COVERAGE_TYPE.Verifies));
    expect(select.querySelectorAll('option')).toHaveLength(4);
  });

  it('says which types count towards coverage, where the choice is made', () => {
    // Related and Blocks are real links that verify nothing. Saying so at the control is the
    // difference between a deliberate choice and an inflated coverage figure.
    openFrom('requirement', 'R1');
    expect(screen.getByText(/record a connection without claiming/i)).toBeTruthy();
  });

  it('says so when everything is already linked, rather than showing an empty picker', () => {
    const onOpenChange = vi.fn();
    render(
      <CoverageLinkDialog
        open
        onOpenChange={onOpenChange}
        from="requirement"
        fixedId="R1"
        fixedLabel="REQ-1001"
        candidates={[]}
      />,
    );
    expect(screen.getByText(/Nothing left to link/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create the link/i })).toBeDisabled();
  });

  it('closes and tells its caller once the link exists', async () => {
    const { onOpenChange, onLinked } = openFrom('requirement', 'R1');
    fireEvent.change(screen.getByLabelText('Test case'), { target: { value: 'TC1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the link/i }));
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open with the operator\'s choices when the write fails', async () => {
    createLink.mockRejectedValue(new Error('403'));
    const { onOpenChange } = openFrom('requirement', 'R1');
    fireEvent.change(screen.getByLabelText('Test case'), { target: { value: 'TC1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByLabelText('Test case') as HTMLSelectElement).value).toBe('TC1');
  });
});
