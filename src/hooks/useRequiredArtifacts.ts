import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listRequiredArtifacts, createRequiredArtifact, updateRequiredArtifact, deactivateRequiredArtifact,
  listProjectArtifactStatuses, createProjectArtifactStatus, updateProjectArtifactStatus,
} from '../api/requiredArtifacts.api';
import type { RequiredArtifactCreate, ProjectArtifactStatusCreate, ProjectArtifactStatusUpdate } from '../models/requiredArtifact.model';
import { ARTIFACT_STATUS } from '../lib/constants';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';

const ART_QK = ['requiredArtifacts'] as const;
const STATUS_QK = (projectId: string) => ['projectArtifactStatuses', projectId] as const;

export function useRequiredArtifacts() {
  return useQuery({
    queryKey: ART_QK,
    queryFn: listRequiredArtifacts,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateRequiredArtifact() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create required artifact',
    mutationFn: (payload: RequiredArtifactCreate) => createRequiredArtifact(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ART_QK }),
  });
}

export function useUpdateRequiredArtifact() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update required artifact',
    mutationFn: ({ id, payload }: { id: string; payload: Partial<RequiredArtifactCreate> }) =>
      updateRequiredArtifact(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ART_QK }),
  });
}

export function useDeactivateRequiredArtifact() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate required artifact',
    mutationFn: (id: string) => deactivateRequiredArtifact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ART_QK }),
  });
}

export function useProjectArtifactStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: STATUS_QK(projectId ?? ''),
    queryFn: () => listProjectArtifactStatuses(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateProjectArtifactStatus(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create project artifact status',
    mutationFn: (payload: ProjectArtifactStatusCreate) => {
      const { [PSS_PROJECT_BIND]: _a, [CUSTOM_PROJECT_BIND]: _b, ...rest } = payload as Record<string, unknown>;
      return createProjectArtifactStatus({ ...(rest as ProjectArtifactStatusCreate), ...projectBind(projectId, dataSource) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: STATUS_QK(projectId) }),
  });
}

export function useUpdateProjectArtifactStatus(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update project artifact status',
    mutationFn: ({ id, payload }: { id: string; payload: ProjectArtifactStatusUpdate }) =>
      updateProjectArtifactStatus(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: STATUS_QK(projectId) }),
  });
}

export function useArtifactReadiness(projectId: string | undefined) {
  const { data: definitions = [] } = useRequiredArtifacts();
  const { data: statuses = [] } = useProjectArtifactStatuses(projectId);

  const required = definitions.filter((d) => d.pmo_isrequired);
  const complete = statuses.filter(
    (s) => s.pmo_status === ARTIFACT_STATUS.Complete || s.pmo_status === ARTIFACT_STATUS.Waived,
  );
  const total = required.length;
  const done = complete.filter((s) =>
    required.some((r) => r.pmo_requiredartifactid === s['_pmo_requiredartifact_value']),
  ).length;

  return { total, done, isReady: total > 0 && done >= total, definitions, statuses };
}
