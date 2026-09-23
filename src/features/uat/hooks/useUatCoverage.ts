/**
 * The rows a coverage figure is computed from — read as ROWS, never as an aggregate.
 *
 * Two-hop navigation filters and `countdistinct` return wrong answers with an HTTP 200 on this
 * platform, so there is no server-side coverage query to call. This hook reads the links for each
 * requirement and the cases for the project, and `uatCoverage.ts` counts them. That is slower
 * than an aggregate would be and it is the only way the number can be trusted.
 *
 * **Per requirement and per project, never org-wide.** One query per requirement's links is the
 * shape that stays inside the 50,000-record aggregate ceiling — the ceiling that returns a
 * silently truncated answer rather than an error.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { listCoverageForRequirement, listUatTestCasesByProject } from '../../../api/uatTestCases.api';
import { useUatRequirements } from '../../../hooks/useUatRequirements';
import type { CoverageLink, CoverageTestCase } from '../lib/uatCoverage';

export interface ProjectCoverageRows {
  links: CoverageLink[];
  cases: CoverageTestCase[];
  isPending: boolean;
  isError: boolean;
}

/**
 * Every coverage link and test case for one project, flattened for `uatCoverage.ts`.
 *
 * The links are fetched one requirement at a time through `useQueries`, so a project with 40
 * requirements makes 40 small reads rather than one large one. Each is individually cacheable and
 * individually invalidated when a link is created, which is what keeps a freshly linked
 * requirement from needing a page reload.
 */
export function useUatCoverageForProject(projectId: string | undefined): ProjectCoverageRows {
  const { data: requirements = [], isPending: reqPending, isError: reqError } =
    useUatRequirements(projectId);

  const linkQueries = useQueries({
    queries: requirements.map((requirement) => ({
      queryKey: ['uatCoverageByRequirement', requirement.pmo_uatrequirementid] as const,
      queryFn: () => listCoverageForRequirement(requirement.pmo_uatrequirementid),
      staleTime: 60_000,
    })),
  });

  const casesQuery = useQuery({
    queryKey: ['uatTestCases', projectId ?? ''],
    queryFn: () => listUatTestCasesByProject(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const links: CoverageLink[] = linkQueries.flatMap((query) =>
    (query.data ?? []).map((link) => ({
      requirementId: link._pmo_requirement_value,
      testCaseId: link._pmo_testcase_value,
      coverageType: link.pmo_coveragetype,
    })),
  );

  const cases: CoverageTestCase[] = (casesQuery.data ?? []).map((testCase) => ({
    testCaseId: testCase.pmo_uattestcaseid,
    executionStatus: testCase.pmo_executionstatus,
  }));

  return {
    links,
    cases,
    isPending: reqPending || casesQuery.isPending || linkQueries.some((q) => q.isPending),
    // A partial read must not be presented as a coverage figure: a missing link page would
    // silently report a covered requirement as uncovered.
    isError: reqError || casesQuery.isError || linkQueries.some((q) => q.isError),
  };
}
