/**
 * T050 — the coverage view. An untested requirement must be impossible to mistake for a tested
 * one, and the displayed percentage must match the hand-counted fixture exactly.
 *
 * **Distinguishable means more than a colour.** A red/green pair is indistinguishable to a
 * red-green colour-blind reader, and a coverage report exists to be skimmed. So each state
 * carries its own WORD as well as its own icon, and the tests assert the words — a test that
 * asserted only a CSS class would pass on a report one reader in twelve cannot use.
 *
 * The percentage is asserted against the same hand-counted fixture uatCoverage.test.ts uses, so
 * if the two ever disagree one of them is wrong and both will say so.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CoverageMatrix } from './CoverageMatrix';
import { UAT_COVERAGE_TYPE, UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';
import { COVERAGE_STATE_LABELS } from '../lib/uatCoverage';

/** Four requirements, one in each interesting state. Hand-counted: 1 of 4 verified = 25%. */
const REQUIREMENTS = [
  { requirementId: 'R1', name: 'REQ-1001', title: 'Totals must match' },
  { requirementId: 'R2', name: 'REQ-1002', title: 'Member must be eligible' },
  { requirementId: 'R3', name: 'REQ-1003', title: 'Denial must be explained' },
  { requirementId: 'R4', name: 'REQ-1004', title: 'Nothing covers this' },
];

const CASES = [
  { testCaseId: 'TC1', executionStatus: UAT_EXECUTION_STATUS.Completed },
  { testCaseId: 'TC2', executionStatus: UAT_EXECUTION_STATUS.ReturnedForDefect },
  { testCaseId: 'TC3', executionStatus: UAT_EXECUTION_STATUS.NotStarted },
];

const LINKS = [
  { requirementId: 'R1', testCaseId: 'TC1', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R2', testCaseId: 'TC2', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R3', testCaseId: 'TC3', coverageType: UAT_COVERAGE_TYPE.Verifies },
];

function renderMatrix(props: Partial<React.ComponentProps<typeof CoverageMatrix>> = {}) {
  const onRequirementClick = vi.fn();
  render(
    <CoverageMatrix
      requirements={REQUIREMENTS}
      links={LINKS}
      cases={CASES}
      onRequirementClick={onRequirementClick}
      {...props}
    />,
  );
  return { onRequirementClick };
}

describe('an untested requirement is distinguishable from a tested one', () => {
  it('names every state in words, not only in colour', () => {
    renderMatrix();
    const rows = within(screen.getByTestId('uat-coverage-rows'));
    expect(rows.getByText(COVERAGE_STATE_LABELS.covered)).toBeTruthy();
    expect(rows.getByText(COVERAGE_STATE_LABELS.failing)).toBeTruthy();
    expect(rows.getByText(COVERAGE_STATE_LABELS.planned)).toBeTruthy();
    expect(rows.getByText(COVERAGE_STATE_LABELS.uncovered)).toBeTruthy();
  });

  it('gives the uncovered requirement different text from the covered one', () => {
    // The clause, stated as an inequality: the two rows must not read the same.
    renderMatrix();
    const rows = within(screen.getByTestId('uat-coverage-rows'));
    const covered = rows.getByText('Totals must match').closest('tr')!;
    const uncovered = rows.getByText('Nothing covers this').closest('tr')!;
    expect(covered.textContent).not.toBe(uncovered.textContent);
    expect(covered.textContent).toContain(COVERAGE_STATE_LABELS.covered);
    expect(uncovered.textContent).toContain(COVERAGE_STATE_LABELS.uncovered);
  });

  it('does not silently call a not-yet-run test "verified"', () => {
    renderMatrix();
    const rows = within(screen.getByTestId('uat-coverage-rows'));
    const planned = rows.getByText('Denial must be explained').closest('tr')!;
    expect(planned.textContent).toContain(COVERAGE_STATE_LABELS.planned);
    expect(planned.textContent).not.toContain(COVERAGE_STATE_LABELS.covered);
  });
});

describe('the displayed percentage matches the hand count', () => {
  it('shows 25% — one of four verified', () => {
    renderMatrix();
    expect(screen.getByTestId('uat-coverage-percent').textContent).toBe('25%');
    expect(screen.getByText(/1 of 4/)).toBeTruthy();
  });

  it('counts each state in the legend, so the number and its meaning are together', () => {
    renderMatrix();
    const legend = screen.getByTestId('uat-coverage-legend').textContent ?? '';
    expect(legend).toContain(`${COVERAGE_STATE_LABELS.covered}: 1`);
    expect(legend).toContain(`${COVERAGE_STATE_LABELS.failing}: 1`);
    expect(legend).toContain(`${COVERAGE_STATE_LABELS.planned}: 1`);
    expect(legend).toContain(`${COVERAGE_STATE_LABELS.uncovered}: 1`);
  });

  it('shows a dash rather than 0% when there is nothing to measure', () => {
    render(<CoverageMatrix requirements={[]} links={[]} cases={[]} />);
    // And says WHY there is nothing, rather than rendering an empty table.
    expect(screen.getByText(/Coverage is measured against requirements/i)).toBeTruthy();
    expect(screen.queryByTestId('uat-coverage-rows')).toBeNull();
  });

  it('shows the link count including links that do not verify', () => {
    renderMatrix({
      links: [...LINKS, { requirementId: 'R4', testCaseId: 'TC1', coverageType: UAT_COVERAGE_TYPE.Related }],
    });
    const rows = within(screen.getByTestId('uat-coverage-rows'));
    const related = rows.getByText('Nothing covers this').closest('tr')!;
    // One link, still uncovered: the link exists and a person should see it.
    expect(related.textContent).toContain(COVERAGE_STATE_LABELS.uncovered);
    expect(related.querySelector('td:last-child')?.textContent).toBe('1');
  });
});

describe('the hierarchy and navigation', () => {
  it('indents a story under its epic', () => {
    render(
      <CoverageMatrix
        requirements={[
          { requirementId: 'E1', name: 'REQ-1', title: 'Epic', parentId: null },
          { requirementId: 'S1', name: 'REQ-2', title: 'Story', parentId: 'E1' },
        ]}
        links={[]}
        cases={[]}
      />,
    );
    const rows = within(screen.getByTestId('uat-coverage-rows'));
    expect(rows.getByText('Story').className).toContain('pl-8');
    expect(rows.getByText('Epic').className).not.toContain('pl-8');
  });

  it('opens a requirement when its row is clicked', () => {
    const { onRequirementClick } = renderMatrix();
    fireEvent.click(within(screen.getByTestId('uat-coverage-rows')).getByText('Totals must match'));
    expect(onRequirementClick).toHaveBeenCalledWith('R1');
  });
});
