import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';
import type { ProjectTask } from '../models/projectTask.model';

const SIGNAL_SELECT = [
  'msdyn_projecttaskid',
  'msdyn_subject',
  'msdyn_ismilestone',
  'msdyn_scheduledend',
  'msdyn_finish',      // fallback when scheduledend is null (same pattern as TaskRow)
  'msdyn_progress',
  'msdyn_summary',
  'statecode',
  '_msdyn_project_value',
];

/**
 * Fetch a minimal task record set across multiple projects for program-level schedule signals.
 * Uses an OData OR filter — suitable for programs with up to ~30 projects.
 */
export async function listTasksForProjects(projectIds: string[]): Promise<ProjectTask[]> {
  if (projectIds.length === 0) return [];
  const filter = projectIds
    .map((id) => `_msdyn_project_value eq '${id}'`)
    .join(' or ');
  return dv.list<ProjectTask>(ENTITY_SETS.projectTask, {
    $select: SIGNAL_SELECT,
    $filter: filter,
  });
}
