import { describe, it, expect } from 'vitest';
import { buildCompletePayload, DEFAULT_HOURSDONE_TARGET, checkNewModelCompletionGuard } from './taskCompletionPayload';
import type { ProjectTask } from '../models/projectTask.model';

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    msdyn_projecttaskid: 't1',
    msdyn_subject: 'Test',
    statecode: 0,
    ...overrides,
  };
}

describe('buildCompletePayload', () => {
  it('preserves user effort when set (effort=20, hoursdone=10 -> hoursdone bumps to 20, effort stays 20)', () => {
    const t = task({ pmo_taskeffort: 20, pmo_taskhoursdone: 10 });
    const p = buildCompletePayload(t);
    expect(p.hasEffort).toBe(true);
    expect(p.hoursDoneTarget).toBe(20);
    expect(p.pss).toEqual({ effortCompleted: 20, effort: 20, progress: 100 });
    expect(p.cvs).toEqual({ pmo_taskhoursdone: 20, pmo_taskeffort: 20 });
  });

  it('does NOT invent an effort when task has no estimate (blank -> only hoursdone written; effort omitted)', () => {
    const t = task(); // no pmo_taskeffort, no msdyn_effort
    const p = buildCompletePayload(t);
    expect(p.hasEffort).toBe(false);
    expect(p.hoursDoneTarget).toBe(DEFAULT_HOURSDONE_TARGET);
    // PSS side: no effort key at all -- msdyn_effort stays whatever it was.
    expect(p.pss).toEqual({ effortCompleted: DEFAULT_HOURSDONE_TARGET, progress: 100 });
    expect('effort' in p.pss).toBe(false);
    // CVS side: no pmo_taskeffort key -- the user's blank estimate is preserved.
    expect(p.cvs).toEqual({ pmo_taskhoursdone: DEFAULT_HOURSDONE_TARGET });
    expect('pmo_taskeffort' in p.cvs).toBe(false);
  });

  it('does NOT invent an effort when the estimate is explicitly zero', () => {
    const t = task({ pmo_taskeffort: 0 });
    const p = buildCompletePayload(t);
    expect(p.hasEffort).toBe(false);
    expect(p.hoursDoneTarget).toBe(DEFAULT_HOURSDONE_TARGET);
    expect('effort' in p.pss).toBe(false);
    expect('pmo_taskeffort' in p.cvs).toBe(false);
  });

  it('falls back to msdyn_effort when pmo_taskeffort is absent but msdyn side is populated', () => {
    // Path taken by tasks that haven't been re-saved since the pmo_*
    // columns landed.
    const t = task({ msdyn_effort: 8 });
    const p = buildCompletePayload(t);
    expect(p.hasEffort).toBe(true);
    expect(p.hoursDoneTarget).toBe(8);
    expect(p.pss.effort).toBe(8);
    expect(p.cvs.pmo_taskeffort).toBe(8);
  });

  it('prefers pmo_taskeffort over msdyn_effort when both are set (getTaskEffort semantics)', () => {
    const t = task({ pmo_taskeffort: 12, msdyn_effort: 5 });
    const p = buildCompletePayload(t);
    expect(p.hoursDoneTarget).toBe(12);
    expect(p.pss.effort).toBe(12);
    expect(p.cvs.pmo_taskeffort).toBe(12);
  });

  it('regression: does not reproduce the 2026-07-27 bug (effort=1/hoursdone=1 clobber on blank tasks)', () => {
    // The pre-fix code path wrote { effort: 1, effortCompleted: 1 } on
    // both sides for any task without a pmo_taskeffort. That silently
    // materialized an estimate the user never entered. Guard against
    // regression: the payload must not carry an 'effort' key at all
    // for blank-estimate tasks.
    const t = task({ msdyn_subject: 'Task with no estimate' });
    const p = buildCompletePayload(t);
    expect(p.pss).not.toHaveProperty('effort');
    expect(p.cvs).not.toHaveProperty('pmo_taskeffort');
  });
});


describe('checkNewModelCompletionGuard', () => {
  function task(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      msdyn_projecttaskid: 't1',
      msdyn_subject: 'Test',
      statecode: 0 as const,
      pmo_taskeffort: undefined as number | undefined,
      msdyn_effort: undefined as number | undefined,
      ...overrides,
    };
  }

  it('returns ok when useNewResourceModel is false (old model — no restriction)', () => {
    const result = checkNewModelCompletionGuard(task() as never, [], false);
    expect(result.ok).toBe(true);
  });

  it('returns ok when useNewResourceModel is undefined', () => {
    const result = checkNewModelCompletionGuard(task() as never, [], undefined);
    expect(result.ok).toBe(true);
  });

  it('blocks when effort is not set (new model)', () => {
    const result = checkNewModelCompletionGuard(task() as never, [{ contributedHours: 10 }], true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_effort');
  });

  it('blocks when effort is zero (new model)', () => {
    const result = checkNewModelCompletionGuard(task({ pmo_taskeffort: 0 }) as never, [{ contributedHours: 0 }], true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_effort');
  });

  it('blocks when there are no assignees (new model)', () => {
    const result = checkNewModelCompletionGuard(task({ pmo_taskeffort: 20 }) as never, [], true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hours_mismatch');
    expect(result.message).toContain('no one assigned');
  });

  it('blocks when assignee hours sum is less than effort (new model)', () => {
    const result = checkNewModelCompletionGuard(
      task({ pmo_taskeffort: 20 }) as never,
      [{ contributedHours: 15 }, { contributedHours: 4 }],
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hours_mismatch');
    expect(result.message).toContain('19h');
    expect(result.message).toContain('20h');
  });

  it('blocks when assignee hours sum exceeds effort (new model)', () => {
    const result = checkNewModelCompletionGuard(
      task({ pmo_taskeffort: 20 }) as never,
      [{ contributedHours: 25 }],
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hours_mismatch');
  });

  it('allows when assignee hours sum equals effort exactly (new model)', () => {
    const result = checkNewModelCompletionGuard(
      task({ pmo_taskeffort: 20 }) as never,
      [{ contributedHours: 12 }, { contributedHours: 8 }],
      true,
    );
    expect(result.ok).toBe(true);
  });

  it('treats undefined contributedHours as 0', () => {
    const result = checkNewModelCompletionGuard(
      task({ pmo_taskeffort: 10 }) as never,
      [{ contributedHours: undefined }, { contributedHours: 10 }],
      true,
    );
    expect(result.ok).toBe(true);
  });
});
