import { describe, expect, it } from 'vitest';
import { computeFsShifts, type CascadeTask, type CascadeDep } from './finishToStartCascade';

/** Helper: build an FS edge (linktype defaults to 0 = FS). */
const fs = (predecessorId: string, successorId: string, linkType = 0): CascadeDep => ({
  predecessorId,
  successorId,
  linkType,
});

describe('computeFsShifts', () => {
  it('chain A -> B -> C: moving A +3d shifts B and C by +3d', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-06' },
      { id: 'C', start: '2026-08-07', end: '2026-08-09' },
    ];
    const deps = [fs('A', 'B'), fs('B', 'C')];
    const { shifts, cycleDetected } = computeFsShifts(tasks, deps, 'A', 3);

    expect(cycleDetected).toBe(false);
    expect(shifts).toEqual([
      { taskId: 'B', newStart: '2026-08-07', newEnd: '2026-08-09' },
      { taskId: 'C', newStart: '2026-08-10', newEnd: '2026-08-12' },
    ]);
  });

  it('negative delta shifts successors earlier', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-10', end: '2026-08-12' },
      { id: 'B', start: '2026-08-13', end: '2026-08-15' },
    ];
    const { shifts } = computeFsShifts(tasks, [fs('A', 'B')], 'A', -2);
    expect(shifts).toEqual([{ taskId: 'B', newStart: '2026-08-11', newEnd: '2026-08-13' }]);
  });

  it('skip-manual: A -> B(manual) -> C shifts C but not B; delta still propagates through B', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-06', isManual: true },
      { id: 'C', start: '2026-08-07', end: '2026-08-09' },
    ];
    const deps = [fs('A', 'B'), fs('B', 'C')];
    const { shifts } = computeFsShifts(tasks, deps, 'A', 3);

    // B is pinned (no shift emitted); C still moves +3d (propagation past manual).
    expect(shifts.find((s) => s.taskId === 'B')).toBeUndefined();
    expect(shifts).toEqual([{ taskId: 'C', newStart: '2026-08-10', newEnd: '2026-08-12' }]);
  });

  it('cycle A -> B -> A: detected, aborts with zero shifts', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-06' },
    ];
    const deps = [fs('A', 'B'), fs('B', 'A')];
    const { shifts, cycleDetected } = computeFsShifts(tasks, deps, 'A', 3);

    expect(cycleDetected).toBe(true);
    expect(shifts).toEqual([]);
  });

  it('no-op: deltaDays 0 returns no shifts', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-06' },
    ];
    const { shifts, cycleDetected } = computeFsShifts(tasks, [fs('A', 'B')], 'A', 0);
    expect(cycleDetected).toBe(false);
    expect(shifts).toEqual([]);
  });

  it('ignores non-FS link types (SS/FF/SF do not cascade)', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-06' },
    ];
    // linkType 2 = SS — should be ignored.
    const { shifts } = computeFsShifts(tasks, [fs('A', 'B', 2)], 'A', 3);
    expect(shifts).toEqual([]);
  });

  it('branch fan-out: A -> B and A -> C both shift', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04', end: '2026-08-05' },
      { id: 'C', start: '2026-08-06', end: '2026-08-08' },
    ];
    const deps = [fs('A', 'B'), fs('A', 'C')];
    const { shifts } = computeFsShifts(tasks, deps, 'A', 1);
    expect(shifts).toEqual([
      { taskId: 'B', newStart: '2026-08-05', newEnd: '2026-08-06' },
      { taskId: 'C', newStart: '2026-08-07', newEnd: '2026-08-09' },
    ]);
  });

  it('a successor with only a start (no end) shifts just the start', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-03' },
      { id: 'B', start: '2026-08-04' },
    ];
    const { shifts } = computeFsShifts(tasks, [fs('A', 'B')], 'A', 2);
    expect(shifts).toEqual([{ taskId: 'B', newStart: '2026-08-06' }]);
  });

  it('crosses a month boundary correctly', () => {
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-30', end: '2026-08-31' },
      { id: 'B', start: '2026-09-01', end: '2026-09-02' },
    ];
    const { shifts } = computeFsShifts(tasks, [fs('A', 'B')], 'A', 3);
    expect(shifts).toEqual([{ taskId: 'B', newStart: '2026-09-04', newEnd: '2026-09-05' }]);
  });

  it('deep chain: 100 tasks deep completes in < 100ms and shifts all', () => {
    const tasks: CascadeTask[] = [];
    const deps: CascadeDep[] = [];
    for (let i = 0; i < 100; i++) {
      tasks.push({ id: `T${i}`, start: '2026-08-01', end: '2026-08-02' });
      if (i > 0) deps.push(fs(`T${i - 1}`, `T${i}`));
    }
    const t0 = performance.now();
    const { shifts, cycleDetected } = computeFsShifts(tasks, deps, 'T0', 5);
    const elapsed = performance.now() - t0;

    expect(cycleDetected).toBe(false);
    expect(shifts).toHaveLength(99); // every task except the moved T0
    expect(shifts[0]).toEqual({ taskId: 'T1', newStart: '2026-08-06', newEnd: '2026-08-07' });
    expect(elapsed).toBeLessThan(100);
  });

  it('diamond graph does not double-shift the join node', () => {
    // A -> B -> D and A -> C -> D. D must shift exactly once.
    const tasks: CascadeTask[] = [
      { id: 'A', start: '2026-08-01', end: '2026-08-02' },
      { id: 'B', start: '2026-08-03', end: '2026-08-04' },
      { id: 'C', start: '2026-08-03', end: '2026-08-04' },
      { id: 'D', start: '2026-08-05', end: '2026-08-06' },
    ];
    const deps = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')];
    const { shifts } = computeFsShifts(tasks, deps, 'A', 1);
    const dShifts = shifts.filter((s) => s.taskId === 'D');
    expect(dShifts).toHaveLength(1);
    expect(dShifts[0]).toEqual({ taskId: 'D', newStart: '2026-08-06', newEnd: '2026-08-07' });
  });
});
