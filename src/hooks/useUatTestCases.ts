/**
 * UAT test case, coverage and tag hooks.
 *
 * Every write routes through useAppMutation; see useUatTemplates.ts's header for why.
 *
 * DELETING A LINKED TEST CASE IS REFUSED BY THE PLATFORM. The coverage junction's
 * test-case end is Restrict, so useDeleteUatTestCase can legitimately fail with a
 * platform error and that error must reach the user. useAppMutation surfaces it as a
 * toast and a telemetry row, which is exactly right here — the caller should not
 * swallow it or pre-empt it with a client-side guess about whether links exist.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import {
  listUatTestCases,
  listUatTestCasesByProject,
  listUatTestCasesByCycle,
  getUatTestCase,
  createUatTestCase,
  updateUatTestCase,
  deleteUatTestCase,
  listCoverageForRequirement,
  listCoverageForTestCase,
  createUatCoverageLink,
  updateUatCoverageLink,
  deleteUatCoverageLink,
  listUatTags,
  createUatTag,
  listUatTagLinksForTestCase,
} from '../api/uatTestCases.api';
import type {
  UatTestCaseCreate,
  UatTestCaseUpdate,
  UatCoverageLinkCreate,
  UatCoverageLinkUpdate,
  UatTagCreate,
} from '../models/uatTestCase.model';

const CASES_QK = (projectId: string) => ['uatTestCases', projectId] as const;
/**
 * The cross-project list. Keyed under the same root as the per-project lists but with a
 * reserved segment, so a project id can never collide with it and a write can invalidate
 * both surfaces by name rather than by prefix.
 */
const ALL_CASES_QK = ['uatTestCases', '__all__'] as const;
const CASES_BY_CYCLE_QK = (cycleId: string) => ['uatTestCasesByCycle', cycleId] as const;
const CASE_QK = (id: string) => ['uatTestCase', id] as const;
const COVERAGE_BY_REQ_QK = (id: string) => ['uatCoverageByRequirement', id] as const;
const COVERAGE_BY_CASE_QK = (id: string) => ['uatCoverageByTestCase', id] as const;
const TAGS_QK = ['uatTags'] as const;
const TAG_LINKS_QK = (caseId: string) => ['uatTagLinks', caseId] as const;

/**
 * Every active test case across projects — the cross-project UAT list's data source.
 *
 * A longer staleTime than the per-project list on purpose: this is a portfolio view that
 * a person scans, not the list they just created a row in, and refetching every hundred
 * rows on each focus change is the more expensive mistake.
 */
export function useAllUatTestCases() {
  return useQuery({
    queryKey: ALL_CASES_QK,
    queryFn: () => listUatTestCases(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatTestCases(projectId: string | undefined) {
  return useQuery({
    queryKey: CASES_QK(projectId ?? ''),
    queryFn: () => listUatTestCasesByProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatTestCasesByCycle(cycleId: string | undefined) {
  return useQuery({
    queryKey: CASES_BY_CYCLE_QK(cycleId ?? ''),
    queryFn: () => listUatTestCasesByCycle(cycleId!),
    enabled: !!cycleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatTestCase(id: string | undefined) {
  return useQuery({
    queryKey: CASE_QK(id ?? ''),
    queryFn: () => getUatTestCase(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatTestCase(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create UAT test case',
    entityType: 'pmo_uattestcase',
    parentProjectId: projectId,
    mutationFn: (payload: UatTestCaseCreate) => {
      const rest: UatTestCaseCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      return createUatTestCase({ ...rest, ...projectBind(projectId, dataSource) });
    },
    onSettled: () => {
      // BOTH surfaces. The cross-project list and the project list show the same rows;
      // refreshing one leaves the other confidently wrong, which is the like-surface
      // parity contract applied to cache freshness rather than to features.
      void qc.invalidateQueries({ queryKey: CASES_QK(projectId) });
      void qc.invalidateQueries({ queryKey: ALL_CASES_QK });
    },
  });
}

/**
 * Update a test case. RE-PARENTING IS REFUSED HERE, not merely undocumented.
 *
 * `pmo_uattestrun.pmo_project` duplicates the case's project so run-level reporting needs
 * no join, which is what keeps portfolio rollups inside the aggregate ceiling — and
 * data-model.md §4.2 states the obligation that comes with it: if a case moves project,
 * its runs' copy must move too. Nothing in the spec asks for re-parenting, and a cascade
 * that fails part-way through a case's runs leaves the two references split, which is
 * worse than the operation not existing. So the project binds are stripped from every
 * payload, exactly as `useCreateUatTestCase` strips them before re-deriving them from the
 * project it was given.
 *
 * Stripping rather than throwing is deliberate: a caller that sends a bind is not doing
 * something dangerous, it is doing something that silently would not have worked. The
 * write proceeds for the fields that are supported. `TestCaseCreateDialog` states the
 * limit to the user in the same words, because a guard the code enforces and the UI does
 * not explain is a dead end someone has to discover.
 */
export function useUpdateUatTestCase(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT test case',
    entityType: 'pmo_uattestcase',
    entityId: (vars: { id: string; payload: UatTestCaseUpdate }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, payload }: { id: string; payload: UatTestCaseUpdate }) => {
      const safe: UatTestCaseUpdate = { ...payload };
      delete safe[PSS_PROJECT_BIND];
      delete safe[CUSTOM_PROJECT_BIND];
      return updateUatTestCase(id, safe);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: CASES_QK(projectId) });
      void qc.invalidateQueries({ queryKey: ALL_CASES_QK });
      void qc.invalidateQueries({ queryKey: CASE_QK(vars.id) });
    },
  });
}

/**
 * Deactivate a test case.
 *
 * Expect this to FAIL for a case that has coverage links: the junction's test-case end
 * is Restrict. The failure is informative and must reach the user, so there is no
 * suppressToastPredicate here — the caller's job is to offer "remove coverage first",
 * not to hide the refusal.
 */
export function useDeleteUatTestCase(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete UAT test case',
    entityType: 'pmo_uattestcase',
    entityId: (id: string) => id,
    parentProjectId: projectId,
    mutationFn: (id: string) => deleteUatTestCase(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CASES_QK(projectId) });
      void qc.invalidateQueries({ queryKey: ALL_CASES_QK });
    },
  });
}

// ── Coverage ────────────────────────────────────────────────────────────────

export function useCoverageForRequirement(requirementId: string | undefined) {
  return useQuery({
    queryKey: COVERAGE_BY_REQ_QK(requirementId ?? ''),
    queryFn: () => listCoverageForRequirement(requirementId!),
    enabled: !!requirementId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCoverageForTestCase(testCaseId: string | undefined) {
  return useQuery({
    queryKey: COVERAGE_BY_CASE_QK(testCaseId ?? ''),
    queryFn: () => listCoverageForTestCase(testCaseId!),
    enabled: !!testCaseId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatCoverageLink() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'link requirement to test case',
    entityType: 'pmo_uatcoveragelink',
    mutationFn: (payload: UatCoverageLinkCreate) => createUatCoverageLink(payload),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['uatCoverageByRequirement'] });
      void qc.invalidateQueries({ queryKey: ['uatCoverageByTestCase'] });
    },
  });
}

export function useUpdateUatCoverageLink() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update coverage link',
    entityType: 'pmo_uatcoveragelink',
    entityId: (vars: { id: string; payload: UatCoverageLinkUpdate }) => vars.id,
    mutationFn: ({ id, payload }: { id: string; payload: UatCoverageLinkUpdate }) =>
      updateUatCoverageLink(id, payload),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['uatCoverageByRequirement'] });
      void qc.invalidateQueries({ queryKey: ['uatCoverageByTestCase'] });
    },
  });
}

/**
 * Remove a coverage link. HARD delete, deliberately — a deactivated link would still
 * block deleting its test case while vanishing from every list. Invalidates the test
 * case queries too, because removing the last link is what makes a case deletable.
 */
export function useDeleteUatCoverageLink() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'remove coverage link',
    entityType: 'pmo_uatcoveragelink',
    entityId: (id: string) => id,
    mutationFn: (id: string) => deleteUatCoverageLink(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['uatCoverageByRequirement'] });
      void qc.invalidateQueries({ queryKey: ['uatCoverageByTestCase'] });
      void qc.invalidateQueries({ queryKey: ['uatTestCases'] });
    },
  });
}

// ── Tags ────────────────────────────────────────────────────────────────────

export function useUatTags() {
  return useQuery({
    queryKey: TAGS_QK,
    queryFn: () => listUatTags(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUatTagLinksForTestCase(testCaseId: string | undefined) {
  return useQuery({
    queryKey: TAG_LINKS_QK(testCaseId ?? ''),
    queryFn: () => listUatTagLinksForTestCase(testCaseId!),
    enabled: !!testCaseId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatTag() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create UAT tag',
    entityType: 'pmo_uattag',
    mutationFn: (payload: UatTagCreate) => createUatTag(payload),
    onSettled: () => qc.invalidateQueries({ queryKey: TAGS_QK }),
  });
}
