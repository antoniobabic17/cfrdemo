import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deriveTaskStatus, STATUS_META, STATUS_ORDER, AT_RISK_WINDOW_DAYS } from './taskStatus';
import type { ProjectTask } from '../models/projectTask.model';

// Fixed "now" so the At Risk / Overdue boundaries are deterministic.
const NOW = new Date('2026-07-16T12:00:00Z').getTime();

function daysFromNow(days: number): string {
  return new Date(NOW + days * 86_400_000).toISOString();
}

function baseTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    msdyn_projecttaskid: 'test-id',
    msdyn_subject: 'Test task',
    statecode: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deriveTaskStatus', () => {
  it('returns done when statecode=1', () => {
    expect(deriveTaskStatus(baseTask({ statecode: 1 }))).toBe('done');
  });

  it('returns done when progress>=100 even if statecode=0', () => {
    expect(deriveTaskStatus(baseTask({ msdyn_progress: 100 }))).toBe('done');
  });

  it('returns done for progress on 0-1 scale that equals 1', () => {
    // getDisplayProgressPct normalizes 0-1 -> 0-100
    expect(deriveTaskStatus(baseTask({ msdyn_progress: 1 }))).toBe('done');
  });

  it('returns overdue when past scheduledEnd and <100%', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(-1), msdyn_progress: 50 });
    expect(deriveTaskStatus(t)).toBe('overdue');
  });

  it('overdue wins even at 0%', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(-5), msdyn_progress: 0 });
    expect(deriveTaskStatus(t)).toBe('overdue');
  });

  it('returns at-risk within AT_RISK_WINDOW_DAYS and <100%', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(2), msdyn_progress: 40 });
    expect(deriveTaskStatus(t)).toBe('at-risk');
  });

  it('returns at-risk at exactly the window boundary', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(AT_RISK_WINDOW_DAYS) });
    expect(deriveTaskStatus(t)).toBe('at-risk');
  });

  it('returns in-progress when due beyond the risk window and progress>0', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(10), msdyn_progress: 25 });
    expect(deriveTaskStatus(t)).toBe('in-progress');
  });

  it('returns not-started when progress==0 and no due date', () => {
    expect(deriveTaskStatus(baseTask({ msdyn_progress: 0 }))).toBe('not-started');
  });

  it('returns not-started when progress==0 and due date is far out', () => {
    const t = baseTask({ msdyn_scheduledend: daysFromNow(30), msdyn_progress: 0 });
    expect(deriveTaskStatus(t)).toBe('not-started');
  });

  it('at-risk beats not-started when progress==0 and due within window', () => {
    // Zero-progress task due tomorrow is more useful surfaced as at-risk.
    const t = baseTask({ msdyn_scheduledend: daysFromNow(1), msdyn_progress: 0 });
    expect(deriveTaskStatus(t)).toBe('at-risk');
  });

  it('falls back to msdyn_finish when msdyn_scheduledend is absent', () => {
    const t = baseTask({ msdyn_finish: daysFromNow(-2), msdyn_progress: 10 });
    expect(deriveTaskStatus(t)).toBe('overdue');
  });

  it('handles invalid date strings gracefully', () => {
    const t = baseTask({ msdyn_scheduledend: 'not-a-date', msdyn_progress: 25 });
    expect(deriveTaskStatus(t)).toBe('in-progress');
  });

  it('derives from effort/effortCompleted when both present (hours source of truth)', () => {
    // 4/8 = 50% -> in-progress
    const t = baseTask({
      msdyn_effort: 8, msdyn_effortcompleted: 4,
      msdyn_progress: 0, // stale, should be ignored per getDisplayProgressPct
    });
    expect(deriveTaskStatus(t)).toBe('in-progress');
  });

  it('derives done from effort/effortCompleted at 100%', () => {
    const t = baseTask({ msdyn_effort: 8, msdyn_effortcompleted: 8, msdyn_progress: 0 });
    expect(deriveTaskStatus(t)).toBe('done');
  });
});

describe('STATUS_META', () => {
  it('covers every TaskStatus enum value', () => {
    for (const s of STATUS_ORDER) {
      expect(STATUS_META[s]).toBeDefined();
      expect(STATUS_META[s].label).toBeTruthy();
      expect(STATUS_META[s].borderCls).toMatch(/^border-/);
      expect(STATUS_META[s].pillCls).toMatch(/bg-/);
    }
  });

  it('only Done has a bgCls tint', () => {
    for (const s of STATUS_ORDER) {
      if (s === 'done') expect(STATUS_META[s].bgCls).toBeTruthy();
      else expect(STATUS_META[s].bgCls).toBeUndefined();
    }
  });
});
