import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from '../../../../hooks/useAppMutation';
import {
  listPayerIssues,
  getPayerIssue,
  listPayerIssuesForProject,
  setPayerIssueProject,
  createPayerIssue,
  updatePayerIssue,
  deactivatePayerIssue,
  reactivatePayerIssue,
  deletePayerIssue,
  type PayerIssueCreateInput,
  type PayerIssueUpdateInput,
  type PayerIssueStateFilter,
} from '../api/payerIssues.api';
import { QUERY_STALE_TIME } from '../../../../lib/constants';

const KEYS = {
  all: ['payerIssues'] as const,
  list: (state: PayerIssueStateFilter, extra: string[] = []) => [...KEYS.all, 'list', state, extra.join(',')] as const,
  byProject: (projectId: string) => [...KEYS.all, 'byProject', projectId] as const,
  detail: (id: string) => [...KEYS.all, 'detail', id] as const,
};

export function usePayerIssues(
  stateFilter: PayerIssueStateFilter = 'active',
  extraSelect: string[] = [],
) {
  return useQuery({
    // extraSelect is part of the key so toggling a view column refetches with the
    // wider $select. Sorted for a stable key regardless of column order.
    queryKey: KEYS.list(stateFilter, [...extraSelect].sort()),
    queryFn: () => listPayerIssues(stateFilter, extraSelect),
    staleTime: QUERY_STALE_TIME,
  });
}

export function usePayerIssue(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.detail(id ?? ''),
    queryFn: () => getPayerIssue(id!),
    enabled: !!id,
    staleTime: QUERY_STALE_TIME,
  });
}

export function usePayerIssuesForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: KEYS.byProject(projectId ?? ''),
    queryFn: () => listPayerIssuesForProject(projectId!),
    enabled: !!projectId,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Mutation: set or clear the project link on a single payer issue. */
export function useSetPayerIssueProject() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'set payer issue project',
    mutationFn: ({ payerIssueId, projectId }: { payerIssueId: string; projectId: string | null }) =>
      setPayerIssueProject(payerIssueId, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

/** Mutation: create a new payer issue. */
export function useCreatePayerIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create payer issue',
    mutationFn: (input: PayerIssueCreateInput) => createPayerIssue(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useUpdatePayerIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update payer issue',
    mutationFn: ({ id, patch }: { id: string; patch: PayerIssueUpdateInput }) => updatePayerIssue(id, patch),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useDeactivatePayerIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'deactivate payer issue',
    mutationFn: (id: string) => deactivatePayerIssue(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.all }); },
  });
}

export function useReactivatePayerIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reactivate payer issue',
    mutationFn: (id: string) => reactivatePayerIssue(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.all }); },
  });
}

export function useDeletePayerIssue() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete payer issue',
    mutationFn: (id: string) => deletePayerIssue(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEYS.all }); },
  });
}
