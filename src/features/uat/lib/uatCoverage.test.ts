/**
 * T049 — coverage over a hand-built, HAND-COUNTED fixture.
 *
 * **Why the fixture is counted by hand in a comment.** Two-hop navigation filters and
 * `countdistinct` return wrong answers with an HTTP 200 on this platform, so no coverage figure
 * may reach a user unvalidated — and a test that asserted the module agrees with a Dataverse
 * aggregate would prove only that two wrong numbers match. The counts below are worked out from
 * the fixture in prose first, then asserted. If a number here changes, either the fixture
 * changed or the module is wrong; there is no third possibility.
 *
 * THE FIXTURE — 8 requirements, 6 test cases, 9 links:
 *
 *   R1  Verifies TC1 (Completed)                            → covered
 *   R2  Verifies TC2 (Returned for Defect)                  → failing
 *   R3  Partially Verifies TC3 (Completed)                  → partial
 *   R4  Verifies TC4 (Not Started)                          → planned
 *   R5  Related TC1 (Completed)                             → uncovered  ← the trap
 *   R6  no links                                            → uncovered
 *   R7  Verifies TC5 (Completed) + Verifies TC2 (Returned)  → failing    ← failing wins
 *   R8  Verifies TC6 (deleted — not in the case list)       → planned
 *
 * By hand: covered 1, failing 2, partial 1, planned 2, uncovered 2. Sum 8 = the requirement
 * count. Verified percentage = 1/8 = 12.5%.
 */
import { describe, it, expect } from 'vitest';
import {
  coverageSummary,
  requirementCoverage,
  requirementTree,
  isVerifyingType,
  isFullyVerifyingType,
  COVERAGE_STATE_LABELS,
  COVERAGE_STATES_WORST_FIRST,
  type CoverageLink,
  type CoverageRequirement,
  type CoverageTestCase,
} from './uatCoverage';
import { UAT_COVERAGE_TYPE, UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';

const REQUIREMENTS: CoverageRequirement[] = [
  { requirementId: 'R1' }, { requirementId: 'R2' }, { requirementId: 'R3' },
  { requirementId: 'R4' }, { requirementId: 'R5' }, { requirementId: 'R6' },
  { requirementId: 'R7' }, { requirementId: 'R8' },
];

const CASES: CoverageTestCase[] = [
  { testCaseId: 'TC1', executionStatus: UAT_EXECUTION_STATUS.Completed },
  { testCaseId: 'TC2', executionStatus: UAT_EXECUTION_STATUS.ReturnedForDefect },
  { testCaseId: 'TC3', executionStatus: UAT_EXECUTION_STATUS.Completed },
  { testCaseId: 'TC4', executionStatus: UAT_EXECUTION_STATUS.NotStarted },
  { testCaseId: 'TC5', executionStatus: UAT_EXECUTION_STATUS.Completed },
  // TC6 is deliberately absent: R8 links to a case that no longer exists.
];

const LINKS: CoverageLink[] = [
  { requirementId: 'R1', testCaseId: 'TC1', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R2', testCaseId: 'TC2', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R3', testCaseId: 'TC3', coverageType: UAT_COVERAGE_TYPE.PartiallyVerifies },
  { requirementId: 'R4', testCaseId: 'TC4', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R5', testCaseId: 'TC1', coverageType: UAT_COVERAGE_TYPE.Related },
  { requirementId: 'R7', testCaseId: 'TC5', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R7', testCaseId: 'TC2', coverageType: UAT_COVERAGE_TYPE.Verifies },
  { requirementId: 'R8', testCaseId: 'TC6', coverageType: UAT_COVERAGE_TYPE.Verifies },
];

const summary = coverageSummary(REQUIREMENTS, LINKS, CASES);
const stateOf = (id: string) => summary.byRequirement.find((r) => r.requirementId === id)!.state;

describe('every coverage state, one requirement each', () => {
  it('a completed Verifies link is covered', () => {
    expect(stateOf('R1')).toBe('covered');
  });

  it('a failing test case is FAILING, not covered and not uncovered', () => {
    // The loudest state, because it is the one a person has to act on.
    expect(stateOf('R2')).toBe('failing');
  });

  it('a completed Partially Verifies link is partial, not covered', () => {
    // Rolling partial into covered deletes the distinction the moment it matters.
    expect(stateOf('R3')).toBe('partial');
  });

  it('a Verifies link whose case has not run is PLANNED, not covered', () => {
    // Coverage is not "has a test case". A case that never ran is a plan, not a proof.
    expect(stateOf('R4')).toBe('planned');
  });

  it('a Related link leaves a requirement UNCOVERED — the trap', () => {
    // R5's linked case passed. Counting a Related link would inflate every figure, which is
    // exactly how this kind of report stops being worth reading.
    expect(stateOf('R5')).toBe('uncovered');
  });

  it('no links at all is uncovered', () => {
    expect(stateOf('R6')).toBe('uncovered');
  });

  it('one failing case among passing ones still reads failing', () => {
    // R7 has a completed Verifies AND a failing one. Showing "verified" would hide the failure.
    expect(stateOf('R7')).toBe('failing');
  });

  it('a link to a case that no longer exists verifies nothing', () => {
    // R8's only case is absent from the list. It cannot be covered by a row nobody has.
    expect(stateOf('R8')).toBe('planned');
  });
});

describe('the counts match the hand count', () => {
  it('counts each state exactly as the header worked out', () => {
    expect(summary.counts).toEqual({
      covered: 1, failing: 2, partial: 1, planned: 2, uncovered: 2,
    });
  });

  it('sums to the requirement count, so nothing is double-counted or lost', () => {
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(summary.requirementCount);
    expect(total).toBe(8);
  });

  it('reports 12.5% verified — 1 of 8, counted by hand', () => {
    expect(summary.percentVerified).toBe(12.5);
  });

  it('counts ONLY the covered state in the percentage', () => {
    // If partial or planned crept in the number would be 25% or 50%. Neither is "verified".
    expect(summary.percentVerified).not.toBe(25);
    expect(summary.percentVerified).not.toBe(50);
  });

  it('keeps one entry per requirement, in the order given', () => {
    expect(summary.byRequirement.map((r) => r.requirementId))
      .toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  });

  it('reports the link count including non-verifying links', () => {
    const r5 = summary.byRequirement.find((r) => r.requirementId === 'R5')!;
    // The Related link EXISTS — a person should see it. It just does not verify anything.
    expect(r5.linkCount).toBe(1);
    expect(r5.verifiedCount).toBe(0);
  });

  it('names the failing count, so "failing" is not just a colour', () => {
    const r7 = summary.byRequirement.find((r) => r.requirementId === 'R7')!;
    expect(r7.failingCount).toBe(1);
  });

  it('reports null rather than 0% for an empty set', () => {
    expect(coverageSummary([], [], []).percentVerified).toBeNull();
  });
});

describe('which link types verify', () => {
  it('counts Verifies and Partially Verifies, and nothing else', () => {
    expect(isVerifyingType(UAT_COVERAGE_TYPE.Verifies)).toBe(true);
    expect(isVerifyingType(UAT_COVERAGE_TYPE.PartiallyVerifies)).toBe(true);
    expect(isVerifyingType(UAT_COVERAGE_TYPE.Related)).toBe(false);
    expect(isVerifyingType(UAT_COVERAGE_TYPE.Blocks)).toBe(false);
    expect(isVerifyingType(null)).toBe(false);
  });

  it('distinguishes full from partial verification', () => {
    expect(isFullyVerifyingType(UAT_COVERAGE_TYPE.Verifies)).toBe(true);
    expect(isFullyVerifyingType(UAT_COVERAGE_TYPE.PartiallyVerifies)).toBe(false);
  });

  it('labels every state, and orders them worst first', () => {
    for (const state of COVERAGE_STATES_WORST_FIRST) {
      expect(COVERAGE_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
    expect(COVERAGE_STATES_WORST_FIRST[0]).toBe('failing');
    expect(COVERAGE_STATES_WORST_FIRST).toHaveLength(5);
  });

  it('computes one requirement on its own the same way as in a set', () => {
    const casesById = new Map(CASES.map((c) => [c.testCaseId, c]));
    expect(requirementCoverage('R7', LINKS, casesById).state).toBe('failing');
  });
});

describe('the two-level hierarchy', () => {
  const NESTED: CoverageRequirement[] = [
    { requirementId: 'E1', parentId: null },
    { requirementId: 'S1', parentId: 'E1' },
    { requirementId: 'S2', parentId: 'E1' },
    { requirementId: 'E2', parentId: null },
    { requirementId: 'S3', parentId: 'MISSING' },
  ];

  it('groups stories under their epic', () => {
    const tree = requirementTree(NESTED);
    const e1 = tree.find((n) => n.requirement.requirementId === 'E1')!;
    expect(e1.children.map((c) => c.requirementId)).toEqual(['S1', 'S2']);
    expect(tree.find((n) => n.requirement.requirementId === 'E2')!.children).toEqual([]);
  });

  it('PROMOTES a story whose epic is not in the list rather than dropping it', () => {
    // Same rule the platform applies when an epic is deleted (pmo_parent is RemoveLink). A
    // story that vanished from a coverage report would be an untested requirement nobody
    // could see.
    const tree = requirementTree(NESTED);
    expect(tree.map((n) => n.requirement.requirementId)).toContain('S3');
  });

  it('loses nothing: every requirement appears exactly once', () => {
    const tree = requirementTree(NESTED);
    const seen = tree.flatMap((n) => [n.requirement.requirementId, ...n.children.map((c) => c.requirementId)]);
    expect(seen.sort()).toEqual(['E1', 'E2', 'S1', 'S2', 'S3']);
  });
});
