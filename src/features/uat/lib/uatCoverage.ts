/**
 * Coverage — computed here, from rows, so a test can count it by hand.
 *
 * **Why none of this is a Dataverse aggregate.** Two-hop navigation filters and `countdistinct`
 * return WRONG ANSWERS with an HTTP 200 on this platform — no error, no warning, a number that
 * looks like an answer. A coverage figure is exactly the kind of number nobody re-derives, so
 * every count here is taken from rows the caller already read, and the fixture in the test is
 * hand-built and hand-counted. A test that trusted the aggregate would prove the aggregate
 * agrees with itself.
 *
 * **Coverage is not "has a test case".** A requirement linked to a test case that has never
 * been run is not covered — it is *planned*. The four states are distinct because the question
 * "what is covered" and the question "what has been tested" have different answers, and the
 * legacy system could express neither.
 */
import { UAT_COVERAGE_TYPE, UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';

/**
 * What a requirement's coverage amounts to.
 *
 * Ordered worst to best, and the order is meaningful: a matrix sorts by it, and `WORST_FIRST`
 * below is the one place that order lives.
 */
export type CoverageState = 'uncovered' | 'planned' | 'partial' | 'covered' | 'failing';

export const COVERAGE_STATES_WORST_FIRST: readonly CoverageState[] = [
  'failing', 'uncovered', 'planned', 'partial', 'covered',
];

/** Human wording, so a matrix legend and a tooltip cannot drift apart. */
export const COVERAGE_STATE_LABELS: Readonly<Record<CoverageState, string>> = {
  uncovered: 'Not covered',
  planned: 'Covered, not yet run',
  partial: 'Partially verified',
  covered: 'Verified',
  failing: 'Test failing',
};

/** A test case as coverage needs it: what it verifies and how it last ran. */
export interface CoverageTestCase {
  testCaseId: string;
  /** pmo_uatexecutionstatus on the case — derived from its current run by uatStatus.ts. */
  executionStatus: number | null;
}

/** One requirement-to-test-case link. Exactly one row per pair (FR-037). */
export interface CoverageLink {
  requirementId: string;
  testCaseId: string;
  coverageType: number | null;
}

export interface CoverageRequirement {
  requirementId: string;
  /** Null for a top-level item; an epic id for a story. */
  parentId?: string | null;
}

export interface RequirementCoverage {
  requirementId: string;
  state: CoverageState;
  /** Links pointing at this requirement, whatever their type. */
  linkCount: number;
  /** Cases that verify it (fully or partially) and have completed. */
  verifiedCount: number;
  /** Cases that verify it and are Returned for Defect — the loudest state. */
  failingCount: number;
}

/**
 * Which coverage types count towards verification at all.
 *
 * `Related` and `Blocks` are real links that do NOT verify anything: a test case that is
 * *related* to a requirement says the two are connected, not that one proves the other. Folding
 * them in would inflate every coverage figure, and inflating a coverage figure is the specific
 * way this kind of report becomes worthless.
 */
const VERIFYING_TYPES: readonly number[] = [
  UAT_COVERAGE_TYPE.Verifies,
  UAT_COVERAGE_TYPE.PartiallyVerifies,
];

export function isVerifyingType(coverageType: number | null): boolean {
  return coverageType !== null && VERIFYING_TYPES.includes(coverageType);
}

export function isFullyVerifyingType(coverageType: number | null): boolean {
  return coverageType === UAT_COVERAGE_TYPE.Verifies;
}

/**
 * One requirement's coverage, from the links and cases the caller has in hand.
 *
 * The precedence, and why it is this way round:
 *
 *  1. **failing** beats everything. A requirement whose test is failing is the thing a person
 *     needs to see, and showing it as "verified" because another case passed would hide it.
 *  2. **covered** needs a `Verifies` link whose case has COMPLETED. A completed case is one
 *     that ran; Not Started or In Process is a plan, not a proof.
 *  3. **partial** is a `Partially Verifies` link that completed, or a mix that does not amount
 *     to full verification.
 *  4. **planned** means links exist but nothing has run.
 *  5. **uncovered** means no verifying link at all — a `Related` link leaves it uncovered.
 */
export function requirementCoverage(
  requirementId: string,
  links: readonly CoverageLink[],
  casesById: ReadonlyMap<string, CoverageTestCase>,
): RequirementCoverage {
  const mine = links.filter((link) => link.requirementId === requirementId);
  const verifying = mine.filter((link) => isVerifyingType(link.coverageType));

  let failingCount = 0;
  let fullyVerified = 0;
  let partiallyVerified = 0;

  for (const link of verifying) {
    const testCase = casesById.get(link.testCaseId);
    if (!testCase) continue;                      // a link to a deleted case verifies nothing
    if (testCase.executionStatus === UAT_EXECUTION_STATUS.ReturnedForDefect) {
      failingCount++;
      continue;
    }
    if (testCase.executionStatus === UAT_EXECUTION_STATUS.Completed) {
      if (isFullyVerifyingType(link.coverageType)) fullyVerified++;
      else partiallyVerified++;
    }
  }

  const state: CoverageState = failingCount > 0
    ? 'failing'
    : fullyVerified > 0
      ? 'covered'
      : partiallyVerified > 0
        ? 'partial'
        : verifying.length > 0
          ? 'planned'
          : 'uncovered';

  return {
    requirementId,
    state,
    linkCount: mine.length,
    verifiedCount: fullyVerified + partiallyVerified,
    failingCount,
  };
}

export interface CoverageSummary {
  /** One entry per requirement, in the order they were given. */
  byRequirement: RequirementCoverage[];
  /** How many requirements are in each state. Sums to the requirement count. */
  counts: Record<CoverageState, number>;
  /** Requirements fully verified, over requirements counted, as 0–100 to one decimal. */
  percentVerified: number | null;
  requirementCount: number;
}

/**
 * Coverage across a set of requirements.
 *
 * `percentVerified` counts only the `covered` state. Counting `partial` as covered is the
 * temptation and the mistake: "partially verified" exists precisely because somebody needs to
 * know the difference, and rolling it into the headline number deletes the distinction the
 * moment it matters.
 *
 * Null rather than 0 for an empty set — 0% claims nothing is covered, null says there is
 * nothing here to cover.
 */
export function coverageSummary(
  requirements: readonly CoverageRequirement[],
  links: readonly CoverageLink[],
  cases: readonly CoverageTestCase[],
): CoverageSummary {
  const casesById = new Map(cases.map((c) => [c.testCaseId, c]));
  const byRequirement = requirements.map((r) => requirementCoverage(r.requirementId, links, casesById));

  const counts: Record<CoverageState, number> = {
    uncovered: 0, planned: 0, partial: 0, covered: 0, failing: 0,
  };
  for (const entry of byRequirement) counts[entry.state]++;

  const requirementCount = requirements.length;
  return {
    byRequirement,
    counts,
    requirementCount,
    percentVerified: requirementCount === 0
      ? null
      : Math.round((counts.covered / requirementCount) * 1000) / 10,
  };
}

/** An epic and the stories under it, for the two-level display the spec asks for. */
export interface RequirementTreeNode<T extends CoverageRequirement> {
  requirement: T;
  children: T[];
}

/**
 * Group a flat requirement list into epics and their stories.
 *
 * A story whose parent is not in the list is promoted to the top rather than dropped. That is
 * the same rule the platform applies when an epic is deleted (`pmo_parent` is RemoveLink, so
 * stories are promoted, not cascaded) — and a story that vanished from a coverage report
 * because its epic was filtered out would be a requirement nobody could see was untested.
 */
export function requirementTree<T extends CoverageRequirement>(
  requirements: readonly T[],
): RequirementTreeNode<T>[] {
  const ids = new Set(requirements.map((r) => r.requirementId));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const requirement of requirements) {
    const parentId = requirement.parentId ?? null;
    if (parentId && ids.has(parentId)) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(requirement);
      childrenOf.set(parentId, siblings);
    }
    else roots.push(requirement);
  }

  return roots.map((requirement) => ({
    requirement,
    children: childrenOf.get(requirement.requirementId) ?? [],
  }));
}
