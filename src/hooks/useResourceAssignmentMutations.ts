import { useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { createResourceAssignment, deleteResourceAssignment } from '../lib/schedulingClient';
import { createCustomAssignment, deleteCustomAssignment, updateCustomAssignmentHours } from '../api/customTaskAssignments.api';
import { stageAssignmentCreate, stageAssignmentDelete, waitForStagingSync } from '../lib/stagingClient';
import { refreshStagingRows } from '../lib/stagingOverlay';
import { useStagingEnabled } from './useStagingEnabled';
import { useTaskSource } from '../lib/taskSource';
import { RESOURCE_ASSIGNMENT_KEY } from './useResourceAssignments';
import { PSS_DELAY } from './useProjectTaskMutations';
import { emitTaskAssigned } from '../lib/notify';
import { getCurrentUserId } from '../lib/dataverseClient';

export function useAssignResource(projectId: string) {
  const queryClient = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  return useAppMutation({
    action: 'assign resource',
    mutationFn: async ({ taskId, teamMemberId, name, userId, projectName, initialHours }: { taskId: string; teamMemberId?: string | null; name: string; userId?: string | null; projectName?: string; initialHours?: number }) => {
      // Option-C custom path: write directly to pmo_taskassignment keyed by
      // systemuserid (pmo_user). No PSS (the task lives in pmo_task, so PSS
      // AV-0006s), no staging, no bookable-resource requirement. teamMemberId
      // is passed through only when a projectteam roster row exists, so the
      // reverse-ETL can still mirror to P4W for provisioned users.
      if (customSource) {
        if (!userId) throw new Error('Cannot assign: missing user identity for the custom task source.');
        await createCustomAssignment(projectId, taskId, userId, name, teamMemberId, initialHours);
        void emitTaskAssigned({ assigneeUserId: userId, actorUserId: getCurrentUserId(), taskName: name, projectId, projectName, taskId });
        return;
      }
      if (!teamMemberId) throw new Error('Cannot assign: missing project team member.');
      if (stagingEnabled) {
        const { stagingId } = await stageAssignmentCreate({ projectId, taskId, teamMemberId, name });
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return createResourceAssignment(projectId, taskId, teamMemberId, name);
    },
    onSuccess: async () => {
      // Custom path is synchronous; only the PSS path needs the settle delay.
      if (!customSource) await new Promise((r) => setTimeout(r, PSS_DELAY.ASSIGNMENT));
      queryClient.invalidateQueries({ queryKey: RESOURCE_ASSIGNMENT_KEY(projectId, source) });
    },
  });
}

export function useUnassignResource(projectId: string) {
  const queryClient = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();
  const customSource = source !== 'pss';
  return useAppMutation({
    action: 'unassign resource',
    mutationFn: async (assignmentId: string) => {
      if (customSource) {
        await deleteCustomAssignment(assignmentId);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageAssignmentDelete(assignmentId, projectId);
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return deleteResourceAssignment(projectId, assignmentId);
    },
    onSuccess: async () => {
      if (!customSource) await new Promise((r) => setTimeout(r, PSS_DELAY.ASSIGNMENT));
      queryClient.invalidateQueries({ queryKey: RESOURCE_ASSIGNMENT_KEY(projectId, source) });
    },
  });
}

/**
 * Update (or clear) the contributed hours for one pmo_taskassignment row.
 * New Resource Model only -- callers must check pmo_usenewresourcemodel before
 * rendering the UI that invokes this. Custom source only: pmo_contributedhours
 * exists on pmo_taskassignment, which has no PSS/msdyn equivalent.
 */
export function useUpdateAssignmentHours(projectId: string) {
  const queryClient = useQueryClient();
  const source = useTaskSource();
  return useAppMutation({
    action: 'update assignment hours',
    mutationFn: async ({ assignmentId, hours }: { assignmentId: string; hours: number | null }) => {
      await updateCustomAssignmentHours(assignmentId, hours);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESOURCE_ASSIGNMENT_KEY(projectId, source) });
    },
  });
}
