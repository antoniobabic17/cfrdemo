import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectRequests,
  getProjectRequest,
  createProjectRequest,
  updateProjectRequest,
  submitRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  moveToTriage,
  routeOperational,
  redirectRequest,
  requestClarification,
  resolveClarification,
  linkParentRequest,
} from '../api/projectRequests.api';
import type { ProjectRequestCreate, ProjectRequestUpdate } from '../models/projectRequest.model';

const KEYS = {
  all: ['projectRequests'] as const,
  list: (filter?: string) => [...KEYS.all, 'list', filter] as const,
  detail: (id: string) => [...KEYS.all, 'detail', id] as const,
};

export function useProjectRequests(filter?: string) {
  return useQuery({
    queryKey: KEYS.list(filter),
    queryFn: () => listProjectRequests(filter ? { $filter: filter } : undefined),
    // Refetch on every mount so the queue reflects deletions made elsewhere
    // in the app (project/program cascade hard-deletes the originating
    // request) without forcing a hard browser refresh.
    refetchOnMount: 'always',
  });
}

export function useProjectRequest(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.detail(id ?? ''),
    queryFn: () => getProjectRequest(id!),
    enabled: !!id,
  });
}

export function useCreateProjectRequest() {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'create project request',
    mutationFn: (payload: ProjectRequestCreate) => createProjectRequest(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export function useUpdateProjectRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update project request',
    mutationFn: (payload: ProjectRequestUpdate) => updateProjectRequest(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useSubmitRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'submit request',
    mutationFn: () => submitRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useApproveRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'approve request',
    mutationFn: () => approveRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useRejectRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reject request',
    mutationFn: (reason: string) => rejectRequest(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

// Requester withdraws their own request. Separate from useRejectRequest so the
// two outcomes (requester-cancel vs team-reject) stay independently traceable.
export function useCancelRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'cancel request',
    mutationFn: (reason: string) => cancelRequest(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useMoveToTriage(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'move to triage',
    mutationFn: () => moveToTriage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useRouteOperational(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'route operational',
    mutationFn: (teamId?: string) => routeOperational(id, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useRedirectRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'redirect request',
    mutationFn: (triageComments: string) => redirectRequest(id, triageComments),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useRequestClarification(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'request clarification',
    mutationFn: (question: string) => requestClarification(id, question),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useResolveClarification(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'resolve clarification',
    mutationFn: (input: string | { response: string; approvalChainJson?: string }) => {
      if (typeof input === 'string') return resolveClarification(id, input);
      return resolveClarification(id, input.response, input.approvalChainJson);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}

export function useLinkParentRequest(id: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'link parent request',
    mutationFn: (parentId: string) => linkParentRequest(id, parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(id) });
    },
  });
}
