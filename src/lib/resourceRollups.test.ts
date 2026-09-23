import { describe, expect, it } from 'vitest';
import { computeProjectHoursRollup } from './resourceRollups';
import type { ProjectTask } from '../models/projectTask.model';
import type { ResourceAssignment } from '../models/resourceAssignment.model';

// Minimal task factory — only the fields getTaskEffort() and the rollup need.
function task(id: string, effort?: number): ProjectTask {
  return {
    msdyn_projecttaskid: id,
    pmo_taskeffort: effort,
  } as unknown as ProjectTask;
}

// Minimal assignment factory.
function asg(taskId: string, hours?: number): ResourceAssignment {
  return {
    msdyn_resourceassignmentid: `asg-${taskId}-${hours ?? 'x'}`,
    '_msdyn_taskid_value': taskId,
    '_msdyn_projectteamid_value': null,
    '_msdyn_projectid_value': null,
    statecode: 0,
    contributedHours: hours,
  };
}

function mapOf(entries: [string, ResourceAssignment[]][]): Map<string, ResourceAssignment[]> {
  return new Map(entries);
}

describe('computeProjectHoursRollup', () => {
  it('returns zeros for empty tasks and assignments', () => {
    const result = computeProjectHoursRollup([], new Map());
    expect(result.totalHours).toBe(0);
    expect(result.completedHours).toBe(0);
  });

  it('sums Hours Effort across all tasks for totalHours', () => {
    const tasks = [task('t1', 8), task('t2', 4), task('t3', 12)];
    const { totalHours } = computeProjectHoursRollup(tasks, new Map());
    expect(totalHours).toBe(24);
  });

  it('treats undefined effort as 0 (does not NaN out)', () => {
    const tasks = [task('t1', 8), task('t2', undefined)];
    const { totalHours } = computeProjectHoursRollup(tasks, new Map());
    expect(totalHours).toBe(8);
  });

  it('sums contributedHours across all assignees across all tasks', () => {
    const tasks = [task('t1', 10), task('t2', 5)];
    const byTask = mapOf([
      ['t1', [asg('t1', 4), asg('t1', 3)]],
      ['t2', [asg('t2', 5)]],
    ]);
    const { completedHours } = computeProjectHoursRollup(tasks, byTask);
    expect(completedHours).toBe(12); // 4 + 3 + 5
  });

  it('treats undefined contributedHours as 0', () => {
    const tasks = [task('t1', 10)];
    const byTask = mapOf([['t1', [asg('t1', undefined), asg('t1', 6)]]]);
    const { completedHours } = computeProjectHoursRollup(tasks, byTask);
    expect(completedHours).toBe(6);
  });

  it('ignores assignments for tasks not in the task list', () => {
    const tasks = [task('t1', 8)];
    const byTask = mapOf([
      ['t1', [asg('t1', 4)]],
      ['t-orphan', [asg('t-orphan', 99)]],
    ]);
    const result = computeProjectHoursRollup(tasks, byTask);
    expect(result.totalHours).toBe(8);
    expect(result.completedHours).toBe(4); // orphan not summed in completed (no task row for it)
  });

  it('returns correct rollup for a realistic 3-task, 4-assignee project', () => {
    const tasks = [task('t1', 8), task('t2', 16), task('t3', 4)];
    const byTask = mapOf([
      ['t1', [asg('t1', 8)]],               // t1 fully done
      ['t2', [asg('t2', 6), asg('t2', 4)]], // t2 partially done (10 of 16)
      // t3 has no assignees yet
    ]);
    const result = computeProjectHoursRollup(tasks, byTask);
    expect(result.totalHours).toBe(28);      // 8 + 16 + 4
    expect(result.completedHours).toBe(18);  // 8 + 6 + 4
  });

  it('toggle-off short-circuit: computeProjectHoursRollup still works (pure, no toggle check)', () => {
    // The toggle check lives in recomputeAndSaveProjectRollups (async driver), not here.
    // This test confirms the pure function is safely callable regardless of context.
    const result = computeProjectHoursRollup([task('t1', 5)], new Map());
    expect(result.totalHours).toBe(5);
    expect(result.completedHours).toBe(0);
  });
});
