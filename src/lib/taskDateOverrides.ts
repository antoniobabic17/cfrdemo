/**
 * In-memory override store for task date/hours fields.
 *
 * The PSS scheduling API does not reliably persist scheduledStart,
 * scheduledEnd, or effortCompleted on existing tasks — edits are silently
 * dropped or overwritten when the post-save re-fetch pulls stale server data.
 * This store holds the user's intended values client-side so the UI stays
 * consistent regardless of what the server returns. It is intentionally
 * session-scoped (no persistence) and survives React re-renders and query
 * cache invalidations via useSyncExternalStore.
 */
import type { ProjectTask } from '../models/projectTask.model';
import { toDataverseDateOnly } from './dateOnly';

export type TaskDateOverride = {
  scheduledStart?: string;
  scheduledEnd?: string;
  effortCompleted?: number;
};

const overrides = new Map<string, TaskDateOverride>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function setTaskDateOverride(taskId: string, data: Partial<TaskDateOverride>) {
  overrides.set(taskId, { ...(overrides.get(taskId) ?? {}), ...data });
  notify();
}

export function subscribeToOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOverrideVersion(): number {
  return version;
}

export function applyTaskDateOverrides(tasks: ProjectTask[]): ProjectTask[] {
  if (overrides.size === 0) return tasks;
  return tasks.map((t) => {
    const o = overrides.get(t.msdyn_projecttaskid);
    if (!o) return t;
    const patch: Partial<ProjectTask> = {};
    if (o.scheduledStart !== undefined) patch.msdyn_scheduledstart = toDataverseDateOnly(o.scheduledStart);
    if (o.scheduledEnd !== undefined) {
      patch.msdyn_scheduledend = o.scheduledEnd;
      patch.msdyn_finish = o.scheduledEnd;
    }
    if (o.effortCompleted !== undefined) patch.msdyn_effortcompleted = o.effortCompleted;
    return { ...t, ...patch };
  });
}
