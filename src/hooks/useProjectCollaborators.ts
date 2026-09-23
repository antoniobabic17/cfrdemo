import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectCollaborators,
  createProjectCollaborator,
  removeProjectCollaborator,
} from '../api/projectCollaborators.api';
import { useDataSource } from '../lib/taskSource';
import { useCanEditProjectRoster, assertCanEditProject } from './useProjectPermissions';
import { syncProjectCollaboratorShares, revokeProjectFromUser } from '../lib/projectAccess';
import type { ProjectCollaborator } from '../models/projectCollaborator.model';

const KEYS = {
  forProject: (projectId: string) => ['projectCollaborators', projectId] as const,
};

export function useProjectCollaborators(projectId: string | undefined) {
  return useQuery({
    queryKey: KEYS.forProject(projectId ?? ''),
    queryFn: () => listProjectCollaborators(projectId!),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
}

/** Batch-add one or more collaborators (person search or team-expand checkbox).
 *  Each entry has a userId and an optional viaTeamId. */
export function useAddProjectCollaborators(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProjectRoster(projectId);
  const dataSource = useDataSource();

  return useAppMutation({
    action: 'add project collaborator',
    mutationFn: async (entries: Array<{ userId: string; viaTeamId: string | null }>) => {
      assertCanEditProject(permission, 'add collaborators to this project');
      // Defense in depth: re-read live rows immediately before writing so a
      // double-submit (e.g. two dialogs opened in quick succession) can't
      // create a duplicate grant for the same user.
      const existing = await listProjectCollaborators(projectId);
      const existingUserIds = new Set(
        existing.filter((r) => r.statecode === 0).map((r) => (r['_pmo_user_value'] ?? '').toLowerCase()),
      );
      const results: ProjectCollaborator[] = [];
      for (const { userId, viaTeamId } of entries) {
        if (existingUserIds.has(userId.toLowerCase())) continue; // already has a live grant — skip
        const row = await createProjectCollaborator(projectId, userId, viaTeamId, dataSource);
        results.push(row);
      }
      return results;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) });
      // Best-effort: grant each newly-added user Dataverse write access on the project.
      syncProjectCollaboratorShares(projectId).catch((err) => {
        console.warn('[projectAccess] collaborator share-sync after add failed', err);
      });
    },
  });
}

export function useRemoveProjectCollaborator(projectId: string) {
  const qc = useQueryClient();
  const permission = useCanEditProjectRoster(projectId);

  return useAppMutation({
    action: 'remove project collaborator',
    mutationFn: async ({ collaboratorId, userId }: { collaboratorId: string; userId: string }) => {
      assertCanEditProject(permission, 'remove a collaborator from this project');
      await removeProjectCollaborator(collaboratorId);
      return userId;
    },
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.forProject(projectId) });
      // Best-effort: revoke individual Dataverse access. Only revoke if the user
      // has no remaining collaborator rows (the sync re-checks from the DB after
      // invalidation — use revokeProjectFromUser directly and let the next sync
      // reconcile if needed).
      revokeProjectFromUser(projectId, userId).catch((err) => {
        console.warn('[projectAccess] collaborator share-revoke failed', err);
      });
    },
  });
}
