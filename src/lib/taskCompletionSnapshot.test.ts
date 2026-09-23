import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  captureCompletionSnapshot,
  popCompletionSnapshot,
  hasSnapshot,
  subscribeSnapshots,
  getSnapshotVersion,
  _resetSnapshotStore,
} from './taskCompletionSnapshot';
import type { ProjectTask } from '../models/projectTask.model';

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    msdyn_projecttaskid: 't1',
    msdyn_subject: 'Test',
    statecode: 0,
    ...overrides,
  };
}

beforeEach(() => {
  _resetSnapshotStore();
});

describe('taskCompletionSnapshot', () => {
  it('captures effort/hoursdone/progress from pmo_* fields when present', () => {
    captureCompletionSnapshot('t1', task({
      pmo_taskeffort: 8, pmo_taskhoursdone: 4, msdyn_progress: 50,
    }));
    const snap = popCompletionSnapshot('t1');
    expect(snap?.effort).toBe(8);
    expect(snap?.effortCompleted).toBe(4);
    expect(snap?.progress).toBe(50);
    expect(snap?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to msdyn_* fields when pmo_* absent', () => {
    captureCompletionSnapshot('t1', task({
      msdyn_effort: 6, msdyn_effortcompleted: 2, msdyn_progress: 33,
    }));
    const snap = popCompletionSnapshot('t1');
    expect(snap?.effort).toBe(6);
    expect(snap?.effortCompleted).toBe(2);
    expect(snap?.progress).toBe(33);
  });

  it('captures undefined effort/hoursdone for a truly Not-Started task', () => {
    captureCompletionSnapshot('t1', task());
    const snap = popCompletionSnapshot('t1');
    expect(snap?.effort).toBeUndefined();
    expect(snap?.effortCompleted).toBeUndefined();
    expect(snap?.progress).toBeUndefined();
  });

  it('popCompletionSnapshot removes the entry (one-shot)', () => {
    captureCompletionSnapshot('t1', task({ pmo_taskeffort: 5 }));
    expect(hasSnapshot('t1')).toBe(true);
    popCompletionSnapshot('t1');
    expect(hasSnapshot('t1')).toBe(false);
    expect(popCompletionSnapshot('t1')).toBeUndefined();
  });

  it('scopes snapshots by taskId', () => {
    captureCompletionSnapshot('t1', task({ pmo_taskeffort: 8 }));
    captureCompletionSnapshot('t2', task({ pmo_taskeffort: 3 }));
    expect(popCompletionSnapshot('t2')?.effort).toBe(3);
    expect(popCompletionSnapshot('t1')?.effort).toBe(8);
  });

  it('notifies subscribers on capture and pop', () => {
    const listener = vi.fn();
    const unsub = subscribeSnapshots(listener);
    captureCompletionSnapshot('t1', task());
    expect(listener).toHaveBeenCalledTimes(1);
    popCompletionSnapshot('t1');
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    captureCompletionSnapshot('t1', task());
    expect(listener).toHaveBeenCalledTimes(2); // no more after unsub
  });

  it('version bumps on every mutation', () => {
    const v0 = getSnapshotVersion();
    captureCompletionSnapshot('t1', task());
    expect(getSnapshotVersion()).toBeGreaterThan(v0);
    const v1 = getSnapshotVersion();
    popCompletionSnapshot('t1');
    expect(getSnapshotVersion()).toBeGreaterThan(v1);
  });
});
