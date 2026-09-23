/**
 * UAT defect and per-project settings hooks.
 *
 * Every write routes through useAppMutation; see useUatTemplates.ts's header for why.
 *
 * pmo_category and pmo_assignedteam are absent from the model because THE COLUMNS DO
 * NOT EXIST (progress.md finding 27). Any defect form must omit those fields rather
 * than render an empty picker.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import {
  listUatDefectsByProject,
  listUatDefectsByTestCase,
  listUatDefectsByTestRun,
  getUatDefect,
  createUatDefect,
  updateUatDefect,
  deleteUatDefect,
} from '../api/uatDefects.api';
import {
  listUatProjectSetting,
  createUatProjectSetting,
  updateUatProjectSetting,
} from '../api/uatProjectSettings.api';
import type { UatDefectCreate, UatDefectUpdate } from '../models/uatDefect.model';
import type {
  UatProjectSettingCreate,
  UatProjectSettingUpdate,
} from '../models/uatDefect.model';

const DEFECTS_QK = (projectId: string) => ['uatDefects', projectId] as const;
const DEFECTS_BY_CASE_QK = (caseId: string) => ['uatDefectsByTestCase', caseId] as const;
const DEFECTS_BY_RUN_QK = (runId: string) => ['uatDefectsByTestRun', runId] as const;
const DEFECT_QK = (id: string) => ['uatDefect', id] as const;
const SETTING_QK = (projectId: string) => ['uatProjectSetting', projectId] as const;

export function useUatDefects(projectId: string | undefined) {
  return useQuery({
    queryKey: DEFECTS_QK(projectId ?? ''),
    queryFn: () => listUatDefectsByProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Defects currently linked to one test case.
 *
 * "Currently linked" is precise: every defect lookup is RemoveLink and the table has no
 * parental relationship, so deleting a test case nulls the link and the defect survives.
 * This list shrinks in that case; the defects did not disappear.
 */
export function useUatDefectsByTestCase(testCaseId: string | undefined) {
  return useQuery({
    queryKey: DEFECTS_BY_CASE_QK(testCaseId ?? ''),
    queryFn: () => listUatDefectsByTestCase(testCaseId!),
    enabled: !!testCaseId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatDefectsByTestRun(testRunId: string | undefined) {
  return useQuery({
    queryKey: DEFECTS_BY_RUN_QK(testRunId ?? ''),
    queryFn: () => listUatDefectsByTestRun(testRunId!),
    enabled: !!testRunId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatDefect(id: string | undefined) {
  return useQuery({
    queryKey: DEFECT_QK(id ?? ''),
    queryFn: () => getUatDefect(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatDefect(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'raise UAT defect',
    entityType: 'pmo_uatdefect',
    parentProjectId: projectId,
    mutationFn: (payload: UatDefectCreate) => {
      const rest: UatDefectCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      return createUatDefect({ ...rest, ...projectBind(projectId, dataSource) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: DEFECTS_QK(projectId) });
      void qc.invalidateQueries({ queryKey: ['uatDefectsByTestCase'] });
      void qc.invalidateQueries({ queryKey: ['uatDefectsByTestRun'] });
    },
  });
}

export function useUpdateUatDefect(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT defect',
    entityType: 'pmo_uatdefect',
    entityId: (vars: { id: string; payload: UatDefectUpdate }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, payload }: { id: string; payload: UatDefectUpdate }) =>
      updateUatDefect(id, payload),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: DEFECTS_QK(projectId) });
      void qc.invalidateQueries({ queryKey: DEFECT_QK(vars.id) });
    },
  });
}

export function useDeleteUatDefect(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete UAT defect',
    entityType: 'pmo_uatdefect',
    entityId: (id: string) => id,
    parentProjectId: projectId,
    mutationFn: (id: string) => deleteUatDefect(id),
    onSettled: () => qc.invalidateQueries({ queryKey: DEFECTS_QK(projectId) }),
  });
}

// ── Per-project settings ────────────────────────────────────────────────────

/**
 * The settings row for one project, or an EMPTY ARRAY.
 *
 * An empty array is the NORMAL case and means "inherit the organisation and team
 * toggles" — never "UAT is disabled here". That is what let this table be introduced
 * against ~2,026 existing projects without a backfill. Consumers must resolve
 * organisation toggle, then team override, then this row's pmo_uatenabled, and treat
 * absence as inherit at the last step.
 */
export function useUatProjectSetting(projectId: string | undefined) {
  return useQuery({
    queryKey: SETTING_QK(projectId ?? ''),
    queryFn: () => listUatProjectSetting(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Create the settings row for a project.
 *
 * The platform refuses a second row through an alternate key, so a race surfaces as
 * 0x80060892 rather than as two conflicting rows. Callers should read first and update
 * when a row exists — the key is the backstop, not the flow.
 */
export function useCreateUatProjectSetting(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create UAT project settings',
    entityType: 'pmo_uatprojectsetting',
    parentProjectId: projectId,
    mutationFn: (payload: UatProjectSettingCreate) => {
      const rest: UatProjectSettingCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      return createUatProjectSetting({ ...rest, ...projectBind(projectId, dataSource) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SETTING_QK(projectId) }),
  });
}

export function useUpdateUatProjectSetting(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT project settings',
    entityType: 'pmo_uatprojectsetting',
    entityId: (vars: { id: string; payload: UatProjectSettingUpdate }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, payload }: { id: string; payload: UatProjectSettingUpdate }) =>
      updateUatProjectSetting(id, payload),
    onSettled: () => qc.invalidateQueries({ queryKey: SETTING_QK(projectId) }),
  });
}
