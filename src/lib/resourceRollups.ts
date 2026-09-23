/**
 * New Resource Model — project-level hours rollups.
 *
 * Two layers:
 *   1. Pure computation (`computeProjectHoursRollup`) — no I/O, unit-testable.
 *   2. Thin async driver (`recomputeAndSaveProjectRollups`) — fetches data,
 *      calls the pure function, PATCHes the two pmo_project rollup columns.
 *      Short-circuits when the project's new-model toggle is OFF so old-model
 *      projects pay zero extra round trips.
 *
 * Call site: touchCustomProject (customProjects.api.ts) — every task/assignment
 * mutation already calls a touch helper, so wiring it there covers all paths.
 */

import * as dv from './dataverseClient';
import { listCustomTasksForProjects } from '../api/customTasks.api';
import { listCustomAssignments } from '../api/customTaskAssignments.api';
import type { ProjectTask } from '../models/projectTask.model';
import { getTaskEffort } from '../models/projectTask.model';
import type { ResourceAssignment } from '../models/resourceAssignment.model';

// ── Pure computation ──────────────────────────────────────────────────────────

export interface ProjectHoursRollup {
  /** Σ Hours Effort across all active tasks on the project. */
  totalHours: number;
  /** Σ contributed hours across all assignees across all tasks. */
  completedHours: number;
}

/**
 * Pure: compute project-level hours rollups from tasks and their assignments.
 *
 * @param tasks               Active tasks on the project (statecode 0).
 *                            Effort is read via `getTaskEffort()`.
 * @param assignmentsByTaskId Map from taskId → that task's assignments.
 *                            Only `contributedHours` is consumed per assignment.
 */
export function computeProjectHoursRollup(
  tasks: ProjectTask[],
  assignmentsByTaskId: Map<string, ResourceAssignment[]>,
): ProjectHoursRollup {
  let totalHours = 0;
  let completedHours = 0;

  for (const task of tasks) {
    totalHours += getTaskEffort(task) ?? 0;

    const assignments = assignmentsByTaskId.get(task.msdyn_projecttaskid) ?? [];
    for (const asg of assignments) {
      completedHours += asg.contributedHours ?? 0;
    }
  }

  return { totalHours, completedHours };
}

// ── Async driver ──────────────────────────────────────────────────────────────

/**
 * Fetch tasks + assignments for a project, recompute rollups, and PATCH
 * `pmo_currenttotalhours` / `pmo_currentcompletedhours` on `pmo_project`.
 *
 * Short-circuits (zero extra OData calls) when:
 *   - `projectId` is empty.
 *   - `pmo_usenewresourcemodel` is false/unset on the project.
 *
 * Never throws — best-effort, matching the touch-helper contract.
 */
export async function recomputeAndSaveProjectRollups(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    // Cheap single-column read to check the toggle before anything heavier.
    const proj = await dv.get<{ pmo_usenewresourcemodel?: boolean }>(
      'pmo_projects',
      projectId,
      ['pmo_usenewresourcemodel'],
    );
    if (!proj.pmo_usenewresourcemodel) return; // toggle OFF: skip all further work

    // Fetch active tasks (already normalized to ProjectTask, statecode=0 filtered).
    const tasks = await listCustomTasksForProjects([projectId]);

    // Fetch all active assignments for the project.
    const assignments = await listCustomAssignments(projectId);

    // Build the per-task assignment lookup.
    const byTaskId = new Map<string, ResourceAssignment[]>();
    for (const asg of assignments) {
      const tid = asg['_msdyn_taskid_value'];
      if (!tid) continue;
      if (!byTaskId.has(tid)) byTaskId.set(tid, []);
      byTaskId.get(tid)!.push(asg);
    }

    const { totalHours, completedHours } = computeProjectHoursRollup(tasks, byTaskId);

    await dv.update('pmo_projects', projectId, {
      pmo_currenttotalhours: totalHours,
      pmo_currentcompletedhours: completedHours,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[resourceRollups] recompute failed for project', projectId, err);
  }
}
