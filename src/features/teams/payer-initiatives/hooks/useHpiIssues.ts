/**
 * Tanstack Query wrappers around the HPI Dataverse API. Centralized here so
 * cache keys stay consistent across the gallery, the detail drawer, the
 * relate-picker, and the intake slot.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from '../../../../hooks/useAppMutation';
import {
  listHpiIssues,
  getHpiIssue,
  createHpiIssue,
  updateHpiIssue,
  deactivateHpiIssue,
  reactivateHpiIssue,
  deleteHpiIssue,
  listProjectsForHpi,
  listHpiProjectSummaries,
  listPayerInitiativeProjects,
  relateProjectToHpi,
  type HpiCreateInput,
  type HpiStateFilter,
} from '../api/hpi.api';
import { useDataSource } from '../../../../lib/taskSource';

const KEYS = {
  list: (state: HpiStateFilter) => ['hpi', 'list', state] as const,
  detail: (id: string) => ['hpi', 'detail', id] as const,
  related: (id: string) => ['hpi', 'related-projects', id] as const,
};

export function useHpiIssues(stateFilter: HpiStateFilter = 'active', extraSelect: string[] = []) {
  return useQuery({
    queryKey: [...KEYS.list(stateFilter), [...extraSelect].sort().join(',')] as const,
    queryFn: () => listHpiIssues(stateFilter, extraSelect),
    staleTime: 60 * 1000,
  });
}

export function useHpiProjectSummaries() {
  const source = useDataSource();
  return useQuery({
    queryKey: ['hpi', 'project-summaries', source] as const,
    queryFn: () => listHpiProjectSummaries(source),
    staleTime: 60 * 1000,
  });
}

export function useHpiIssue(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEYS.detail(id) : ['hpi', 'detail', 'pending'],
    enabled: !!id,
    queryFn: () => getHpiIssue(id!),
  });
}

export function useRelatedProjects(hpiId: string | undefined) {
  const source = useDataSource();
  return useQuery({
    queryKey: hpiId ? [...KEYS.related(hpiId), source] : ['hpi', 'related-projects', 'pending'],
    enabled: !!hpiId,
    queryFn: () => listProjectsForHpi(hpiId!, source),
  });
}

export function useCreateHpiIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create hpi issue',
    mutationFn: (input: HpiCreateInput) => createHpiIssue(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hpi', 'list'] }); },
  });
}

export function useUpdateHpiIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update hpi issue',
    mutationFn: ({ id, patch }: { id: string; patch: Partial<HpiCreateInput> }) =>
      updateHpiIssue(id, patch),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['hpi', 'list'] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useRelateProjectToHpi() {
  const qc = useQueryClient();
  const source = useDataSource();
  return useAppMutation({
    action: 'relate project to hpi',
    mutationFn: ({ projectId, hpiId }: { projectId: string; hpiId: string | null }) =>
      relateProjectToHpi(projectId, hpiId, source),
    onSuccess: (_data, { hpiId }) => {
      qc.invalidateQueries({ queryKey: ['hpi', 'list'] });
      qc.invalidateQueries({ queryKey: ['hpi', 'project-summaries'] });
      if (hpiId) qc.invalidateQueries({ queryKey: KEYS.related(hpiId) });
    },
  });
}

/**
 * Pre-populates the HPI create/edit project picker with every active
 * msdyn_project owned by the Payer Initiatives team. Cached for the
 * session so the drawer opens instantly on subsequent uses.
 */
export function useActivePayerInitiativeProjects() {
  const source = useDataSource();
  return useQuery({
    queryKey: ['hpi', 'payer-initiative-projects', source] as const,
    queryFn: () => listPayerInitiativeProjects(source),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeactivateHpiIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate hpi issue',
    mutationFn: (id: string) => deactivateHpiIssue(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['hpi', 'list'] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useReactivateHpiIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reactivate hpi issue',
    mutationFn: (id: string) => reactivateHpiIssue(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['hpi', 'list'] });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDeleteHpiIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete hpi issue',
    mutationFn: (id: string) => deleteHpiIssue(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hpi', 'list'] });
      qc.invalidateQueries({ queryKey: ['hpi', 'project-summaries'] });
    },
  });
}
