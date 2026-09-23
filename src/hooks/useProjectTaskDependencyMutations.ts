// NOTE 2026-07-31: On the CUSTOM source these hooks are live — dependency
// writes go direct to pmo_taskdependency (proven on DEV, HTTP 204; the PSS
// Project-Operations license gate does NOT apply to our own table). On the
// PSS source they remain unreferenced by the UI, because
// msdyn_PssCreateV1(msdyn_projecttaskdependency, linkType) still fails with
// E_OPERATION_BLOCKED_BY_LICENSE on both DEV and PROD. The dependency UI is
// therefore mounted only when useDataSource() === 'custom'.
// See scripts/probe-custom-dependency-write.py + plan.md Phase 0.2.
import { useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import { createProjectTaskDependency, deleteProjectTaskDependency, LINK_TYPE } from '../lib/schedulingClient';
import { createCustomTaskDependency, deleteCustomTaskDependency } from '../api/customTaskDependencies.api';
import { stageDependencyCreate, stageDependencyDelete, waitForStagingSync } from '../lib/stagingClient';
import { refreshStagingRows } from '../lib/stagingOverlay';
import { useStagingEnabled } from './useStagingEnabled';
import { DEPENDENCY_KEYS } from './useProjectTaskDependencies';
import { PSS_DELAY } from './useProjectTaskMutations';
import { useTaskSource, usesCustomTables } from '../lib/taskSource';

export function useCreateProjectTaskDependency(projectId: string) {
  const qc = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();
  return useAppMutation({
    action: 'create project task dependency',
    mutationFn: async ({
      successorTaskId,
      predecessorTaskId,
      linkType = LINK_TYPE.FS,
    }: {
      successorTaskId: string;
      predecessorTaskId: string;
      linkType?: number;
    }) => {
      if (usesCustomTables(source)) {
        // Direct OData create on pmo_taskdependency — no PSS. Synchronous.
        await createCustomTaskDependency({ predecessorTaskId, successorTaskId, linkType });
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageDependencyCreate({ projectId, successorTaskId, predecessorTaskId, linkType });
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return createProjectTaskDependency(projectId, successorTaskId, predecessorTaskId, linkType);
    },
    onSuccess: async () => {
      // Custom writes land synchronously — no PSS commit lag to wait out.
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.DEPENDENCY));
      qc.invalidateQueries({ queryKey: DEPENDENCY_KEYS.forProject(projectId, source) });
    },
  });
}

export function useDeleteProjectTaskDependency(projectId: string) {
  const qc = useQueryClient();
  const stagingEnabled = useStagingEnabled();
  const source = useTaskSource();
  return useAppMutation({
    action: 'delete project task dependency',
    mutationFn: async (dependencyId: string) => {
      if (usesCustomTables(source)) {
        await deleteCustomTaskDependency(dependencyId);
        return;
      }
      if (stagingEnabled) {
        const { stagingId } = await stageDependencyDelete(dependencyId, projectId);
        await refreshStagingRows(projectId);
        const r = await waitForStagingSync(stagingId, projectId);
        if (!r.synced) throw new Error(r.error ?? 'Save failed.');
        return;
      }
      return deleteProjectTaskDependency(projectId, dependencyId);
    },
    onSuccess: async () => {
      if (source !== 'custom') await new Promise((r) => setTimeout(r, PSS_DELAY.DEPENDENCY));
      qc.invalidateQueries({ queryKey: DEPENDENCY_KEYS.forProject(projectId, source) });
    },
  });
}
