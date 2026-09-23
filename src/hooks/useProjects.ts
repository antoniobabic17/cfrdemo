import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listProjects, listActiveProjects, getProject, createProject, updateProject } from '../api/projects.api';
import {
  listCustomProjects,
  getCustomProject,
  createCustomProject,
  updateCustomProject,
} from '../api/customProjects.api';
import type { Project, ProjectUpdate } from '../models/project.model';
import type { ODataParams } from '../models/common.model';
import { useCanEditProject, assertCanEditProject } from './useProjectPermissions';
import { syncProjectTeamShares } from '../lib/projectAccess';
import { useDataSource, usesCustomTables } from '../lib/taskSource';

// Cache keys are source-versioned (like TASK_QUERY_KEYS) so a data-source flip
// (pss <-> custom) can't serve a cached list from the other side. `source` is
// threaded in from useDataSource() at each call site.
const KEYS = {
  all: ['projects'] as const,
  list: (source: string, params?: ODataParams, extra: string[] = []) => [...KEYS.all, 'list', source, params, extra.join(',')] as const,
  active: (source: string) => [...KEYS.all, 'active', source] as const,
  detail: (source: string, id: string) => [...KEYS.all, 'detail', source, id] as const,
};

export function useProjects(params?: ODataParams, extraSelect: string[] = []) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    // extraSelect (active view columns) is part of the key so toggling a column
    // refetches with the wider $select. Sorted for a stable key.
    queryKey: KEYS.list(source, params, [...extraSelect].sort()),
    // Custom source: list all active pmo_project rows. The optional OData params
    // (used by the PSS path for filtered lists) don't apply on custom; callers
    // that need filtering do it client-side over the normalized rows. Both paths
    // union extraSelect onto their curated base select (bounded).
    queryFn: () => (custom
      ? listCustomProjects(extraSelect)
      : listProjects({ ...params, $select: extraSelect })),
  });
}

export function useActiveProjects() {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: KEYS.active(source),
    queryFn: () => (custom ? listCustomProjects() : listActiveProjects()),
  });
}

export function useProject(id: string | undefined) {
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useQuery({
    queryKey: KEYS.detail(source, id ?? ''),
    queryFn: () => (custom ? getCustomProject(id!) : getProject(id!)),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  return useAppMutation({
    action: 'create project',
    // Custom: write the same-GUID msdyn_project shell + pmo_project row.
    // PSS: create msdyn_project directly (legacy path).
    mutationFn: (payload: object) =>
      custom ? createCustomProject(payload as ProjectUpdate) : createProject(payload),
    onSuccess: (created: Project) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      // Share the new project with its Primary Team + Contributing teams so
      // non-admin members can edit it. Best-effort — log on failure, don't
      // break the create flow. Works on both sources because the shell
      // msdyn_project carries the same GUID the share targets.
      if (created?.msdyn_projectid) {
        syncProjectTeamShares(created.msdyn_projectid).then((r) => {
          if (r.errors.length > 0) {
            // eslint-disable-next-line no-console
            console.warn('[projectAccess] share-sync after create had errors', r.errors);
          }
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[projectAccess] share-sync after create failed', err);
        });
      }
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  const source = useDataSource();
  const custom = usesCustomTables(source);
  const permission = useCanEditProject(id);
  return useAppMutation({
    action: 'update project',
    mutationFn: (payload: ProjectUpdate) => {
      assertCanEditProject(permission, 'update this project');
      return custom ? updateCustomProject(id, payload) : updateProject(id, payload);
    },
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.detail(source, id) });
      // If the Primary Team binding changed, re-sync shares so the new team
      // can edit and the old team can't (unless it's still in the contributing
      // roster). Detection: the bind property is named pmo_PrimaryTeam@odata.bind.
      const primaryTeamChanged = 'pmo_PrimaryTeam@odata.bind' in (payload as object);
      if (primaryTeamChanged) {
        syncProjectTeamShares(id).then((r) => {
          if (r.errors.length > 0) {
            // eslint-disable-next-line no-console
            console.warn('[projectAccess] share-sync after team change had errors', r.errors);
          }
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[projectAccess] share-sync after team change failed', err);
        });
      }
    },
  });
}
