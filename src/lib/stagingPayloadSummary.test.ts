import { describe, it, expect } from 'vitest';
import { summarizeStagingRow, formatRawPayload } from './stagingPayloadSummary';
import type { TaskStagingRow } from '../models/taskStaging.model';
import {
  STAGING_OPERATION,
  STAGING_ENTITY_TYPE,
  STAGING_SYNC_STATUS,
} from './constants';

function row(
  op: number,
  ent: number,
  payload: Record<string, unknown>,
  overrides: Partial<TaskStagingRow> = {},
): TaskStagingRow {
  return {
    pmo_taskstagingid: 'stg-1',
    pmo_operation: op as TaskStagingRow['pmo_operation'],
    pmo_entitytype: ent as TaskStagingRow['pmo_entitytype'],
    pmo_targetid: '7c0ef85512345678',
    pmo_payload: JSON.stringify(payload),
    pmo_syncstatus: STAGING_SYNC_STATUS.Pending,
    pmo_sequence: 1,
    pmo_attempts: 0,
    ...overrides,
  } as TaskStagingRow;
}

describe('summarizeStagingRow', () => {
  // ── Task ──────────────────────────────────────────────────────────────────

  it('Task Create — full payload', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Task,
      {
        subject: 'Testing',
        scheduledStart: '2026-07-20T00:00:00Z',
        scheduledEnd: '2026-07-25T00:00:00Z',
        duration: 40,
        effort: 8,
        isMilestone: false,
      },
    ));
    expect(s).toContain('Create task "Testing"');
    expect(s).toContain('start 2026-07-20');
    expect(s).toContain('due 2026-07-25');
    expect(s).toContain('40h duration');
    expect(s).toContain('8h effort');
  });

  it('Task Create — sparse payload', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Task,
      { subject: 'Bare task' },
    ));
    expect(s).toBe('Create task "Bare task"');
  });

  it('Task Create — milestone flag', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Task,
      { subject: 'Milestone', isMilestone: true },
    ));
    expect(s).toContain('milestone');
  });

  it('Task Update — renders each field with human label', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Update,
      STAGING_ENTITY_TYPE.Task,
      { taskId: '7c0ef855-...', subject: 'Renamed', effort: 16, priority: 3 },
    ));
    expect(s).toContain('Update task 7c0ef855');
    expect(s).toContain('name=Renamed');
    expect(s).toContain('effort (hours)=16');
    expect(s).toContain('priority=3');
    // taskId itself should not appear -- excluded from the diff.
    expect(s).not.toContain('taskId=');
  });

  it('Task Update — no fields', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Update,
      STAGING_ENTITY_TYPE.Task,
      { taskId: '7c0ef855' },
    ));
    expect(s).toBe('Update task 7c0ef855 (no fields)');
  });

  it('Task Delete', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Delete,
      STAGING_ENTITY_TYPE.Task,
      { taskId: '7c0ef855', projectId: 'p1' },
    ));
    expect(s).toBe('Delete task 7c0ef855');
  });

  // ── Bucket ────────────────────────────────────────────────────────────────

  it('Bucket Create', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Bucket,
      { name: 'Backlog', displayOrder: 3 },
    ));
    expect(s).toBe('Create bucket "Backlog" (order 3)');
  });

  it('Bucket Update — rename-only special case', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Update,
      STAGING_ENTITY_TYPE.Bucket,
      { bucketId: '4853b6bd', name: 'Design' },
    ));
    expect(s).toBe('Update bucket 7c0ef855 — rename to "Design"');
  });

  it('Bucket Delete', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Delete,
      STAGING_ENTITY_TYPE.Bucket,
      { bucketId: '4853b6bd', projectId: 'p1' },
    ));
    expect(s).toBe('Delete bucket 7c0ef855');
  });

  // ── Dependency ────────────────────────────────────────────────────────────

  it('Dependency Create — FS default', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Dependency,
      {
        predecessorTaskId: '7c0ef85511111111',
        successorTaskId:   '4853b6bd22222222',
      },
    ));
    expect(s).toBe('Add dependency: 7c0ef855 → 4853b6bd (FS)');
  });

  it('Dependency Create — explicit link type SS', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Dependency,
      {
        predecessorTaskId: '7c0ef85511111111',
        successorTaskId:   '4853b6bd22222222',
        linkType: 1,
      },
    ));
    expect(s).toContain('(SS)');
  });

  it('Dependency Delete', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Delete,
      STAGING_ENTITY_TYPE.Dependency,
      { dependencyId: '177dbf52', projectId: 'p1' },
    ));
    expect(s).toBe('Remove dependency 7c0ef855');
  });

  // ── Assignment ────────────────────────────────────────────────────────────

  it('Assignment Create — includes name and task', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Create,
      STAGING_ENTITY_TYPE.Assignment,
      {
        projectId: 'p1',
        taskId: 'c14e8abd12345678',
        teamMemberId: 'tm-1',
        name: 'Anna Gimenez',
      },
    ));
    expect(s).toBe('Assign "Anna Gimenez" to task c14e8abd');
  });

  it('Assignment Delete', () => {
    const s = summarizeStagingRow(row(
      STAGING_OPERATION.Delete,
      STAGING_ENTITY_TYPE.Assignment,
      { assignmentId: '146211a1', projectId: 'p1' },
    ));
    expect(s).toBe('Unassign resource 7c0ef855');
  });

  // ── Failure modes ─────────────────────────────────────────────────────────

  it('Malformed payload — reports unreadable + entity + operation', () => {
    const bad: TaskStagingRow = {
      ...row(STAGING_OPERATION.Create, STAGING_ENTITY_TYPE.Task, {}),
      pmo_payload: '{not-json',
    };
    const s = summarizeStagingRow(bad);
    expect(s).toContain('Create');
    expect(s).toContain('task');
    expect(s).toContain('payload unreadable');
  });
});

describe('formatRawPayload', () => {
  it('pretty-prints valid JSON', () => {
    const r = row(STAGING_OPERATION.Create, STAGING_ENTITY_TYPE.Task, { a: 1, b: 2 });
    const out = formatRawPayload(r);
    // Two-space indent
    expect(out).toContain('  "a"');
    expect(out).toContain('  "b"');
  });

  it('falls back to raw string on malformed JSON', () => {
    const r: TaskStagingRow = {
      ...row(STAGING_OPERATION.Create, STAGING_ENTITY_TYPE.Task, {}),
      pmo_payload: '{oops',
    };
    expect(formatRawPayload(r)).toBe('{oops');
  });
});
