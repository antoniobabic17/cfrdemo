/**
 * T046 — a bypassed project does not distort the portfolio number.
 *
 * **The fixture is built so that including the bypassed project VISIBLY changes the answer.**
 * That is the acceptance's own requirement, and it is what makes the test fail if the exclusion
 * is ever dropped: with the bypassed project counted the figure is 50%, without it 100%. A
 * fixture where inclusion made no difference would pass either way and prove nothing.
 *
 * Both halves are checked, because excluding from the numerator alone is the subtle version of
 * the same bug — the bypassed project's requirements would still swell the denominator and the
 * percentage would fall for a reason nobody could see.
 */
import { describe, it, expect } from 'vitest';
import {
  isBypassed,
  splitBypassed,
  portfolioCoverage,
  exclusionNote,
  type CoverageContribution,
} from './uatBypassExclusion';

/**
 * Two real projects, fully covered; one bypassed project carrying requirements and no coverage.
 *
 * Hand-counted: included = 10 of 10 = 100%. Counted with the bypassed one = 10 of 20 = 50%.
 */
const FIXTURE: CoverageContribution[] = [
  { projectId: 'p-1', covered: 6, total: 6 },
  { projectId: 'p-2', covered: 4, total: 4 },
  { projectId: 'p-3', covered: 0, total: 10, bypassed: true },
];

describe('the exclusion changes the number, which is why it must not be dropped', () => {
  it('reports 100% from the two real projects', () => {
    const coverage = portfolioCoverage(FIXTURE);
    expect(coverage.covered).toBe(10);
    expect(coverage.total).toBe(10);
    expect(coverage.percent).toBe(100);
  });

  it('would report 50% if the bypassed project were counted — the difference is visible', () => {
    // The same fixture with the flag cleared. This is the number the test protects against.
    const counted = portfolioCoverage(FIXTURE.map((p) => ({ ...p, bypassed: false })));
    expect(counted.percent).toBe(50);
    expect(counted.percent).not.toBe(portfolioCoverage(FIXTURE).percent);
  });

  it('excludes the bypassed project from BOTH the numerator and the denominator', () => {
    const coverage = portfolioCoverage(FIXTURE);
    // 10, not 20: its requirements are gone from the denominator too.
    expect(coverage.total).toBe(10);
  });

  it('says how many projects it left out, so the figure can be read honestly', () => {
    const coverage = portfolioCoverage(FIXTURE);
    expect(coverage.excludedProjects).toBe(1);
    expect(coverage.excludedProjectIds).toEqual(['p-3']);
    expect(exclusionNote(coverage)).toBe('1 project bypassed UAT and is not counted in this figure.');
  });

  it('says nothing when nothing was excluded', () => {
    expect(exclusionNote(portfolioCoverage([{ projectId: 'p-1', covered: 1, total: 2 }]))).toBeNull();
  });

  it('pluralises the note, because a report is read by people', () => {
    const coverage = portfolioCoverage([
      { projectId: 'p-1', covered: 1, total: 1 },
      { projectId: 'p-2', covered: 0, total: 5, bypassed: true },
      { projectId: 'p-3', covered: 0, total: 5, bypassed: true },
    ]);
    expect(exclusionNote(coverage)).toMatch(/2 projects bypassed UAT and are not counted/);
  });
});

describe('the flag is read one way', () => {
  it('treats only an explicit true as bypassed', () => {
    expect(isBypassed({ projectId: 'p', bypassed: true })).toBe(true);
    // Null is the common case — the column exists and no answer has been given.
    expect(isBypassed({ projectId: 'p', bypassed: null })).toBe(false);
    expect(isBypassed({ projectId: 'p', bypassed: false })).toBe(false);
    expect(isBypassed({ projectId: 'p' })).toBe(false);
  });

  it('returns both halves, so a caller cannot report a percentage without the count', () => {
    const { included, excluded } = splitBypassed(FIXTURE);
    expect(included.map((p) => p.projectId)).toEqual(['p-1', 'p-2']);
    expect(excluded.map((p) => p.projectId)).toEqual(['p-3']);
    // Nothing is lost in the split.
    expect(included.length + excluded.length).toBe(FIXTURE.length);
  });
});

describe('degenerate portfolios', () => {
  it('reports null rather than 0% when there is nothing to count', () => {
    // 0% reads as "nothing is covered", a claim about the work. Null is "there is no work
    // here", a claim about the data — and a portfolio of only bypassed projects is the second.
    const coverage = portfolioCoverage([{ projectId: 'p-1', covered: 0, total: 8, bypassed: true }]);
    expect(coverage.percent).toBeNull();
    expect(coverage.total).toBe(0);
    expect(coverage.excludedProjects).toBe(1);
  });

  it('reports null for an empty portfolio', () => {
    expect(portfolioCoverage([]).percent).toBeNull();
  });

  it('rounds to one decimal, so a figure is not printed to fifteen', () => {
    const coverage = portfolioCoverage([{ projectId: 'p-1', covered: 1, total: 3 }]);
    expect(coverage.percent).toBe(33.3);
  });

  it('ignores a negative count rather than letting it subtract from the total', () => {
    // A bad aggregate read producing -5 must not make the portfolio look better than it is.
    const coverage = portfolioCoverage([
      { projectId: 'p-1', covered: -5, total: 4 },
      { projectId: 'p-2', covered: 2, total: 2 },
    ]);
    expect(coverage.covered).toBe(2);
    expect(coverage.total).toBe(6);
  });
});
