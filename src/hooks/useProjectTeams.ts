import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { listProjectTeams, createProjectTeam, removeProjectTeam } from '../api/projectTeams.api';
import { useDataSource } from '../lib/taskSource';
import type { ProjectTeamCreate } from '../models/projectTeam.model';
import { useCanEditProjectRoster, assertCanEditProject } from './useProjectPermissions';
import { syncProjectTeamShares } from '../lib/projectAccess';

const KEYS = {
  forProject: (projectId: string) => ['projectTeams', projectId] as const,
};

/** Fire-and-forget share-sync. Wrapped so callers don't have to repeat the
 *  same warn-on-error boilerplate inline. */
function syncSharesBestEffort(projectId: string, context: string) {
  syncProjectTeamShares(projectId).then((r) => {
    if (r.errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[projectAccess] share-sync after ${context} had errors`, r.errors);
    }
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`[projectAccess] share-sync after ${context} failed`, err);
  });
}

export function useProjectTeams(projectId: string | undefined) {
  return useQuery({
    queryKey: KEYS.forProject(projectId ?? ''),
    queryFn: () => listProjectTeams(projectId!),
    enabled: !!projectId,
  });
}

export function useAddProjectTeam(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProjectRoster(projectId);
  const dataSource = useDataSource();
  return useAppMutation({
    action: 'add project team',
    mutationFn: (payload: ProjectTeamCreate) => {
      assertCanEditProject(permission, 'add a team to this project');
      return createProjectTeam(payload, dataSource);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) });
      syncSharesBestEffort(projectId, 'add-team');
    },
  });
}

export function useRemoveProjectTeam(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProjectRoster(projectId);
  return useAppMutation({
    action: 'remove project team',
    mutationFn: (teamRecordId: string) => {
      assertCanEditProject(permission, 'remove a team from this project');
      return removeProjectTeam(teamRecordId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) });
      syncSharesBestEffort(projectId, 'remove-team');
    },
  });
}
