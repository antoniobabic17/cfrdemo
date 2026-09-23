/**
 * UAT requirement hooks.
 *
 * Project-scoped creates bind through projectBind(projectId, dataSource) rather than
 * setting either lookup by hand. Custom-source projects have NO msdyn_project row, so
 * hard-coding the shell bind would fail for every migrated project — see progress.md
 * finding 15. The same reason reads go through projectMatch in the API layer.
 *
 * Every write routes through useAppMutation; see useUatTemplates.ts's header for why.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { useDataSource } from '../lib/taskSource';
import { projectBind, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import {
  listUatRequirementsByProject,
  listUatRequirementChildren,
  getUatRequirement,
  createUatRequirement,
  updateUatRequirement,
  deleteUatRequirement,
} from '../api/uatRequirements.api';
import type {
  UatRequirement,
  UatRequirementCreate,
  UatRequirementUpdate,
} from '../models/uatRequirement.model';

const LIST_QK = (projectId: string) => ['uatRequirements', projectId] as const;
const ITEM_QK = (id: string) => ['uatRequirement', id] as const;
const CHILDREN_QK = (parentId: string) => ['uatRequirementChildren', parentId] as const;

export function useUatRequirements(projectId: string | undefined) {
  return useQuery({
    queryKey: LIST_QK(projectId ?? ''),
    queryFn: () => listUatRequirementsByProject(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Direct children of one requirement — the epic to story hop. */
export function useUatRequirementChildren(parentId: string | undefined) {
  return useQuery({
    queryKey: CHILDREN_QK(parentId ?? ''),
    queryFn: () => listUatRequirementChildren(parentId!),
    enabled: !!parentId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUatRequirement(id: string | undefined) {
  return useQuery({
    queryKey: ITEM_QK(id ?? ''),
    queryFn: () => getUatRequirement(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateUatRequirement(projectId: string) {
  const qc = useQueryClient();
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'create UAT requirement',
    entityType: 'pmo_uatrequirement',
    parentProjectId: projectId,
    mutationFn: (payload: UatRequirementCreate) => {
      // Strip any caller-supplied project bind and re-derive it, so a stale or
      // hand-written bind cannot reach Dataverse. Deleting the optional keys keeps
      // this type-safe; the destructure-and-cast idiom used by some older hooks needs
      // a double cast through Record<string, unknown> and loses the required fields.
      const rest: UatRequirementCreate = { ...payload };
      delete rest[PSS_PROJECT_BIND];
      delete rest[CUSTOM_PROJECT_BIND];
      return createUatRequirement({ ...rest, ...projectBind(projectId, dataSource) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_QK(projectId) }),
  });
}

export function useUpdateUatRequirement(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update UAT requirement',
    entityType: 'pmo_uatrequirement',
    entityId: (vars: { id: string; payload: UatRequirementUpdate }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, payload }: { id: string; payload: UatRequirementUpdate }) =>
      updateUatRequirement(id, payload),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: LIST_QK(projectId) });
      void qc.invalidateQueries({ queryKey: ITEM_QK(vars.id) });
    },
  });
}

/**
 * Reparent a requirement, or promote it to top level with null.
 *
 * pmo_parent is RemoveLink, so deleting an epic promotes its stories rather than
 * deleting a backlog branch. This is the explicit version of the same move.
 */
export function useReparentUatRequirement(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reparent UAT requirement',
    entityType: 'pmo_uatrequirement',
    entityId: (vars: { id: string; parentId: string | null }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      updateUatRequirement(id, {
        'pmo_Parent@odata.bind': parentId ? `/pmo_uatrequirements(${parentId})` : null,
      }),
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: LIST_QK(projectId) });
      void qc.invalidateQueries({ queryKey: CHILDREN_QK(vars.id) });
      if (vars.parentId) void qc.invalidateQueries({ queryKey: CHILDREN_QK(vars.parentId) });
    },
  });
}

/** Backlog reorder. pmo_rank is decimal so an item always fits between two neighbours. */
export function useRankUatRequirement(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'reorder UAT backlog',
    entityType: 'pmo_uatrequirement',
    entityId: (vars: { id: string; rank: number }) => vars.id,
    parentProjectId: projectId,
    mutationFn: ({ id, rank }: { id: string; rank: number }) =>
      updateUatRequirement(id, { pmo_rank: rank }),
    onMutate: async ({ id, rank }) => {
      await qc.cancelQueries({ queryKey: LIST_QK(projectId) });
      const previous = qc.getQueryData<UatRequirement[]>(LIST_QK(projectId));
      qc.setQueryData<UatRequirement[]>(LIST_QK(projectId), (old) =>
        (old ?? [])
          .map((row) => (row.pmo_uatrequirementid === id ? { ...row, pmo_rank: rank } : row))
          .sort((a, b) => (a.pmo_rank ?? 0) - (b.pmo_rank ?? 0)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback only — useAppMutation owns the toast and the telemetry row.
      if (ctx?.previous) qc.setQueryData<UatRequirement[]>(LIST_QK(projectId), ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_QK(projectId) }),
  });
}

export function useDeleteUatRequirement(projectId: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete UAT requirement',
    entityType: 'pmo_uatrequirement',
    entityId: (id: string) => id,
    parentProjectId: projectId,
    mutationFn: (id: string) => deleteUatRequirement(id),
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_QK(projectId) }),
  });
}
