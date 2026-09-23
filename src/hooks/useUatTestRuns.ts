/**
 * UAT cycle, test run and answer hooks.
 *
 * Every write routes through useAppMutation; see useUatTemplates.ts's header for why.
 *
 * A RE-TEST IS A NEW RUN. There is no "reset this run" hook, deliberately: history is
 * immutable. useStartUatTestRun creates a run and clears pmo_iscurrent on the previous
 * one, so the old row survives with its answers intact.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import {
  listUatCyclesByProject,
  getUatCycle,
  createUatCycle,
  updateUatCycle,
  deleteUatCycle,
  listUatTestRunsByTestCase,
  listCurrentUatTestRun,
  getUatTestRun,
  createUatTestRun,
  updateUatTestRun,
  listUatTestRunAnswers,
  createUatTestRunAnswer,
  updateUatTestRunAnswer,
} from '../api/uatTestRuns.api';
import type {
  UatCycleCreate,
  UatCycleUpdate,
  UatTestRunCreate,
  UatTestRunUpdate,
  UatTestRunAnswerCreate,
  UatTestRunAnswerUpdate,
} from '../models/uatTestRun.model';

const CYCLES_QK = (projectId: string) => ['uatCycles', projectId] as const;
const CYCLE_QK = (id: string) => ['uatCycle', id] as const;
const RUNS_QK = (testCaseId: string) => ['uatTestRuns', testCaseId] as const;
const CURRENT_RUN_QK = (testCaseId: string) => ['uatCurrentTestRun', testCaseId] as const;
const RUN_QK = (id: string) => ['uatTestRun', id] as const;
const ANSWERS_QK = (runId: string) => ['uatTestRunAnswers', runId] as const;

// ── Cycles ──────────────────────────────────────────────────────────────────

export function useUatCycles(projectId: string | undefined) {
  return useQuery({
    queryKey: CYCLES_QK(projectId ?? ''),
    queryFn: () => listUatCyclesByProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatCycle(id: string | undefined) {
  return useQuery({
    queryKey: CYCLE_QK(id ?? ''),
    queryFn: () => getUatCycle(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatCycle(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create UAT cycle',
    entityType: 'pmo_uatcycle',
    parentProjectId: projectId,
    mutationFn: (payload: UatCycleCreate) => {
      const rest: UatCycleCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      return createUatCycle({ ...rest, ...projectBind(projectId, dataSource) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CYCLES_QK(projectId) }),
  });
}

export function useUpdateUatCycle(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT cycle',
    entityType: 'pmo_uatcycle',
    entityId: (vars: { id: string; payload: UatCycleUpdate }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, payload }: { id: string; payload: UatCycleUpdate }) =>
      updateUatCycle(id, payload),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: CYCLES_QK(projectId) });
      void qc.invalidateQueries({ queryKey: CYCLE_QK(vars.id) });
    },
  });
}

export function useDeleteUatCycle(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete UAT cycle',
    entityType: 'pmo_uatcycle',
    entityId: (id: string) => id,
    parentProjectId: projectId,
    mutationFn: (id: string) => deleteUatCycle(id),
    onSettled: () => qc.invalidateQueries({ queryKey: CYCLES_QK(projectId) }),
  });
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function useUatTestRuns(testCaseId: string | undefined) {
  return useQuery({
    queryKey: RUNS_QK(testCaseId ?? ''),
    queryFn: () => listUatTestRunsByTestCase(testCaseId!),
    enabled: !!testCaseId,
    staleTime: 2 * 60 * 1000,
  });
}

/** The current run, or an empty array when the case has never been run. */
export function useCurrentUatTestRun(testCaseId: string | undefined) {
  return useQuery({
    queryKey: CURRENT_RUN_QK(testCaseId ?? ''),
    queryFn: () => listCurrentUatTestRun(testCaseId!),
    enabled: !!testCaseId,
    staleTime: 30 * 1000,
  });
}

export function useUatTestRun(id: string | undefined) {
  return useQuery({
    queryKey: RUN_QK(id ?? ''),
    queryFn: () => getUatTestRun(id!),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/**
 * Start a run: create the new row, then demote the previous current run.
 *
 * Order matters. Creating first means a mid-sequence failure leaves TWO current runs,
 * which the UI can detect and a person can fix. Demoting first would leave ZERO on
 * failure, which reads as "never tested" and silently loses the last known result.
 */
export function useStartUatTestRun(testCaseId: string, projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'start UAT test run',
    entityType: 'pmo_uattestrun',
    parentProjectId: projectId,
    mutationFn: async (payload: UatTestRunCreate) => {
      const rest: UatTestRunCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      const previous = await listCurrentUatTestRun(testCaseId);
      const created = await createUatTestRun({
        ...rest,
        pmo_iscurrent: true,
        ...projectBind(projectId, dataSource),
      });
      for (const old of previous) {
        await updateUatTestRun(old.pmo_uattestrunid, { pmo_iscurrent: false });
      }
      return created;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: RUNS_QK(testCaseId) });
      void qc.invalidateQueries({ queryKey: CURRENT_RUN_QK(testCaseId) });
    },
  });
}

/**
 * Update a run.
 *
 * The timing columns belong to the run form's timer, not to a tester. When saving
 * measured minutes, send pmo_minutesoverridden: false EXPLICITLY — never leave it
 * null, so "was this measured?" stays a query rather than an interpretation.
 *
 * THE PROJECT REFERENCE IS STRIPPED, for the same reason useUpdateUatTestCase strips it.
 * pmo_uattestrun.pmo_project is the model's ONE denormalization (data-model.md §4.2) — a
 * copy of the case's project, kept so run-level reporting needs no join. A copy that any
 * caller can set independently is not a copy, it is a second answer: a run pointing at a
 * different project from its own case would be counted in one portfolio rollup and
 * missing from another, with nothing failing. It is written once, by useStartUatTestRun,
 * from the case's project. Re-parenting the case is refused, so the copy never needs to
 * move.
 */
export function useUpdateUatTestRun(testCaseId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'save UAT test run',
    entityType: 'pmo_uattestrun',
    entityId: (vars: { id: string; payload: UatTestRunUpdate }) => vars.id,
    mutationFn: ({ id, payload }: { id: string; payload: UatTestRunUpdate }) => {
      const safe: UatTestRunUpdate = { ...payload };
      delete safe[PSS_PROJECT_BIND];
      delete safe[CUSTOM_PROJECT_BIND];
      return updateUatTestRun(id, safe);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: RUNS_QK(testCaseId) });
      void qc.invalidateQueries({ queryKey: CURRENT_RUN_QK(testCaseId) });
      void qc.invalidateQueries({ queryKey: RUN_QK(vars.id) });
    },
  });
}

// ── Answers ─────────────────────────────────────────────────────────────────

export function useUatTestRunAnswers(runId: string | undefined) {
  return useQuery({
    queryKey: ANSWERS_QK(runId ?? ''),
    queryFn: () => listUatTestRunAnswers(runId!),
    enabled: !!runId,
    staleTime: 30 * 1000,
  });
}

/**
 * Create an answer row.
 *
 * pmo_questiontextsnapshot is required by the platform and is the whole reason
 * configurable questions are safe for historical runs. Callers must pass the question
 * text as it was displayed, not a lookup — a joined read would show today's wording
 * against last month's answer.
 */
export function useCreateUatTestRunAnswer(runId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'save UAT answer',
    entityType: 'pmo_uattestrunanswer',
    mutationFn: (payload: UatTestRunAnswerCreate) => createUatTestRunAnswer(payload),
    onSettled: () => qc.invalidateQueries({ queryKey: ANSWERS_QK(runId) }),
  });
}

export function useUpdateUatTestRunAnswer(runId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT answer',
    entityType: 'pmo_uattestrunanswer',
    entityId: (vars: { id: string; payload: UatTestRunAnswerUpdate }) => vars.id,
    mutationFn: ({ id, payload }: { id: string; payload: UatTestRunAnswerUpdate }) =>
      updateUatTestRunAnswer(id, payload),
    onSettled: () => qc.invalidateQueries({ queryKey: ANSWERS_QK(runId) }),
  });
}
