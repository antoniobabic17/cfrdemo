import type { ProjectTask } from '../../models/projectTask.model';

export interface TaskNode {
  task: ProjectTask;
  children: TaskNode[];
}

/**
 * Converts a flat task list into a WBS tree using _msdyn_parenttask_value.
 * Tasks without a parent, or whose parent is not in the list, become roots.
 * Within each level, ordering follows msdyn_displaysequence (already sorted by the query).
 */
export function buildTaskTree(tasks: ProjectTask[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  for (const task of tasks) {
    map.set(task.msdyn_projecttaskid, { task, children: [] });
  }

  const roots: TaskNode[] = [];
  for (const task of tasks) {
    const parentId = task['_msdyn_parenttask_value'];
    const node = map.get(task.msdyn_projecttaskid)!;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Returns all descendant task IDs for a given task ID (depth-first). */
export function getDescendantIds(taskId: string, tasks: ProjectTask[]): string[] {
  const result: string[] = [];
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = tasks.filter((t) => t['_msdyn_parenttask_value'] === current);
    for (const child of children) {
      result.push(child.msdyn_projecttaskid);
      queue.push(child.msdyn_projecttaskid);
    }
  }
  return result;
}
