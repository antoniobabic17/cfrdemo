/**
 * A bypassed project is flagged, and it does not distort the portfolio numbers.
 *
 * **Why exclusion rather than counting it as zero.** A project that skipped UAT has no test
 * cases, so counting it would give it 0% coverage and drag the portfolio figure down —
 * punishing a decision the organisation deliberately took and recorded. Counting it as 100%
 * would be worse: it would flatter the number by rewarding having no tests. Neither is right,
 * because a bypassed project is not *behind on* UAT; it is *outside* it. So it is removed from
 * the denominator and reported separately, which is the only answer that does not lie.
 *
 * **The flag is not the same as the exclusion.** A bypassed project stays visible everywhere a
 * person looks at projects — that is the whole point of T045's risk and decision. It is only
 * the AGGREGATE that excludes it, and the aggregate says how many it excluded.
 */

/** The minimum a rollup needs to know about one project. */
export interface PortfolioProject {
  projectId: string;
  /** True when UAT is bypassed for this project. Null and undefined mean not bypassed. */
  bypassed?: boolean | null;
}

export interface PortfolioInput<T extends PortfolioProject> {
  projects: readonly T[];
}

export interface PortfolioSplit<T extends PortfolioProject> {
  /** The projects an aggregate may count. */
  included: T[];
  /** The bypassed ones, kept so a report can name them rather than just omitting them. */
  excluded: T[];
}

/** True when this project's UAT is bypassed. One reading, so nothing branches differently. */
export function isBypassed(project: PortfolioProject): boolean {
  return project.bypassed === true;
}

/**
 * Split a portfolio into what an aggregate counts and what it must not.
 *
 * Returns both halves rather than a filtered list, so a caller cannot report a percentage
 * without also being able to say how many projects it left out.
 */
export function splitBypassed<T extends PortfolioProject>(
  projects: readonly T[],
): PortfolioSplit<T> {
  const included: T[] = [];
  const excluded: T[] = [];
  for (const project of projects) {
    (isBypassed(project) ? excluded : included).push(project);
  }
  return { included, excluded };
}

export interface CoverageContribution extends PortfolioProject {
  /** Requirements on this project that are fully covered by a passing test. */
  covered: number;
  /** Requirements on this project in total. */
  total: number;
}

export interface PortfolioCoverage {
  /** Covered requirements across the counted projects. */
  covered: number;
  /** Total requirements across the counted projects. */
  total: number;
  /** 0–100, rounded to one decimal. Null when nothing is countable. */
  percent: number | null;
  /** How many projects were left out, so the number can be read honestly. */
  excludedProjects: number;
  /** Their ids, so a report can name them. */
  excludedProjectIds: string[];
}

/**
 * Portfolio coverage across projects, with bypassed ones excluded from BOTH halves.
 *
 * Excluding from the numerator alone would be the subtle version of the same bug: a bypassed
 * project's requirements would still swell the denominator and the percentage would fall for a
 * reason nobody could see.
 *
 * `percent` is null rather than 0 when there is nothing to count. Zero would read as "nothing
 * is covered", which is a claim about the work; null is "there is no work here yet", which is a
 * claim about the data — and a portfolio of only bypassed projects is the second one.
 */
export function portfolioCoverage(
  projects: readonly CoverageContribution[],
): PortfolioCoverage {
  const { included, excluded } = splitBypassed(projects);
  let covered = 0;
  let total = 0;
  for (const project of included) {
    covered += Math.max(0, project.covered);
    total += Math.max(0, project.total);
  }
  return {
    covered,
    total,
    percent: total === 0 ? null : Math.round((covered / total) * 1000) / 10,
    excludedProjects: excluded.length,
    excludedProjectIds: excluded.map((project) => project.projectId),
  };
}

/** A sentence a report can print beside the number, or null when nothing was excluded. */
export function exclusionNote(coverage: PortfolioCoverage): string | null {
  if (coverage.excludedProjects === 0) return null;
  const count = coverage.excludedProjects;
  return `${count} project${count === 1 ? '' : 's'} bypassed UAT and ${count === 1 ? 'is' : 'are'} `
    + 'not counted in this figure.';
}
