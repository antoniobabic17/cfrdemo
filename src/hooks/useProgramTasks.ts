// Program-wide task rollup. Routes through pmo.task_source; when
// source='custom' we call listCustomTasksForProjects which derives
// msdyn_summary client-side (see docs/pss-decoupling-c-design.md).
import { useQuery } from '@tanstack/react-query';
import { listTasksForProjects } from '../api/programTasks.api';
import { listCustomTasksForProjects } from '../api/customTasks.api';
import { useTaskSource } from '../lib/taskSource';

export function useProgramTasks(programId: string | undefined, projectIds: string[]) {
  const source = useTaskSource();
  return useQuery({
    queryKey: ['programTasks', programId, projectIds.join(','), source],
    queryFn: () => (source === 'pss'
      ? listTasksForProjects(projectIds)
      : listCustomTasksForProjects(projectIds)),
    enabled: !!programId && projectIds.length > 0,
    // Refetch whenever the program dashboard mounts so task writes made on a
    // child project show up immediately instead of after the old 2-min window.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}
