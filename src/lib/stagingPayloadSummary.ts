/**
 * Pure summarizer for pmo_taskstaging.pmo_payload -> user-facing string.
 *
 * Used by the RepushConfirmModal to show admins what a staging row will
 * replay before they hit Confirm. Deliberately kept out of the audit
 * change-history map (changeAuditFields.ts) -- that map is scoped to
 * timeline rendering; this one is scoped to "here is exactly what the
 * plugin will do." Different lifetime, different audience.
 *
 * Every branch handles the 12 shapes stageTaskCreate / stageTaskUpdate /
 * stageTaskDelete / stageBucketCreate / stageBucketUpdate /
 * stageBucketDelete / stageDependencyCreate / stageDependencyDelete /
 * stageAssignmentCreate / stageAssignmentDelete produce (see
 * lib/stagingClient.ts). Anything we can't parse renders as
 * "<Operation> <Entity> (payload unreadable -- see raw)".
 */
import type { TaskStagingRow } from '../models/taskStaging.model';
import {
  STAGING_OPERATION,
  STAGING_ENTITY_TYPE,
} from './constants';

// ── Field label maps (per entity) ───────────────────────────────────────────
// Inlined -- scope is exact PSS-shape payload fields, not the wider audit
// domain in changeAuditFields.ts.

const TASK_FIELD_LABELS: Record<string, string> = {
  subject:         'name',
  scheduledStart:  'start',
  scheduledEnd:    'end',
  duration:        'duration (hours)',
  effort:          'effort (hours)',
  effortCompleted: 'hours completed',
  isMilestone:     'milestone',
  priority:        'priority',
  description:     'description',
  bucketId:        'bucket',
  progress:        'progress (%)',
};

const BUCKET_FIELD_LABELS: Record<string, string> = {
  name:         'name',
  displayOrder: 'display order',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return '(unset)';
  // The payload stores ISO dates. Show yyyy-mm-dd for readability.
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toISOString().slice(0, 10);
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '(unset)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDate(v);
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v;
  return String(v);
}

function quote(s: unknown): string {
  const t = typeof s === 'string' ? s : String(s);
  return `"${t.length > 40 ? t.slice(0, 40) + '…' : t}"`;
}

function parsePayload(row: TaskStagingRow): Record<string, unknown> | null {
  try { return JSON.parse(row.pmo_payload) as Record<string, unknown>; } catch { return null; }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Human-readable one-liner for what a staging row will replay.
 *
 * Examples:
 *   - `Create task "Testing" (start 2026-07-20, due 2026-07-25, 8h effort)`
 *   - `Update task 7c0ef855 -- set name="Testing renamed", effort=16`
 *   - `Delete task 7c0ef855`
 *   - `Create bucket "Backlog" (order 3)`
 *   - `Update bucket 4853b6bd -- rename to "Design"`
 *   - `Delete bucket 4853b6bd`
 *   - `Add dependency: predecessor 7c0ef855 -> successor 4853b6bd (FS)`
 *   - `Remove dependency 177dbf52`
 *   - `Assign "Anna Gimenez" to task 7c0ef855`
 *   - `Unassign resource 146211a1`
 */
export function summarizeStagingRow(row: TaskStagingRow): string {
  const op = row.pmo_operation;
  const ent = row.pmo_entitytype;
  const target = row.pmo_targetid?.slice(0, 8) ?? '?';
  const payload = parsePayload(row);

  if (!payload) {
    return `${opLabel(op)} ${entLabel(ent)} (payload unreadable — see raw)`;
  }

  // Task
  if (ent === STAGING_ENTITY_TYPE.Task) {
    if (op === STAGING_OPERATION.Create) return summarizeTaskCreate(payload);
    if (op === STAGING_OPERATION.Update) return summarizeTaskUpdate(payload, target);
    if (op === STAGING_OPERATION.Delete) return `Delete task ${target}`;
  }

  // Bucket
  if (ent === STAGING_ENTITY_TYPE.Bucket) {
    if (op === STAGING_OPERATION.Create) return summarizeBucketCreate(payload);
    if (op === STAGING_OPERATION.Update) return summarizeBucketUpdate(payload, target);
    if (op === STAGING_OPERATION.Delete) return `Delete bucket ${target}`;
  }

  // Dependency
  if (ent === STAGING_ENTITY_TYPE.Dependency) {
    if (op === STAGING_OPERATION.Create) {
      const pred = String(payload.predecessorTaskId ?? '').slice(0, 8);
      const succ = String(payload.successorTaskId ?? '').slice(0, 8);
      const lt = ['FS', 'SS', 'FF', 'SF'][Number(payload.linkType ?? 0)] ?? 'FS';
      return `Add dependency: ${pred} → ${succ} (${lt})`;
    }
    if (op === STAGING_OPERATION.Delete) return `Remove dependency ${target}`;
  }

  // Assignment
  if (ent === STAGING_ENTITY_TYPE.Assignment) {
    if (op === STAGING_OPERATION.Create) {
      const name = payload.name ? quote(payload.name) : '(unknown)';
      const task = String(payload.taskId ?? '').slice(0, 8);
      return `Assign ${name} to task ${task}`;
    }
    if (op === STAGING_OPERATION.Delete) return `Unassign resource ${target}`;
  }

  return `${opLabel(op)} ${entLabel(ent)} ${target} (payload unreadable — see raw)`;
}

// ── Per-shape summarizers ───────────────────────────────────────────────────

function summarizeTaskCreate(p: Record<string, unknown>): string {
  const name = p.subject ? quote(p.subject) : '(unnamed)';
  const bits: string[] = [];
  if (p.scheduledStart) bits.push(`start ${fmtDate(p.scheduledStart)}`);
  if (p.scheduledEnd)   bits.push(`due ${fmtDate(p.scheduledEnd)}`);
  if (typeof p.duration === 'number') bits.push(`${p.duration}h duration`);
  if (typeof p.effort === 'number') bits.push(`${p.effort}h effort`);
  if (p.isMilestone === true) bits.push('milestone');
  const suffix = bits.length > 0 ? ` (${bits.join(', ')})` : '';
  return `Create task ${name}${suffix}`;
}

function summarizeTaskUpdate(p: Record<string, unknown>, target: string): string {
  const parts: string[] = [];
  for (const key of Object.keys(p)) {
    if (key === 'taskId') continue;
    const label = TASK_FIELD_LABELS[key] ?? key;
    parts.push(`${label}=${fmtValue(p[key])}`);
  }
  if (parts.length === 0) return `Update task ${target} (no fields)`;
  return `Update task ${target} — set ${parts.join(', ')}`;
}

function summarizeBucketCreate(p: Record<string, unknown>): string {
  const name = p.name ? quote(p.name) : '(unnamed)';
  const order = typeof p.displayOrder === 'number' ? ` (order ${p.displayOrder})` : '';
  return `Create bucket ${name}${order}`;
}

function summarizeBucketUpdate(p: Record<string, unknown>, target: string): string {
  const parts: string[] = [];
  for (const key of Object.keys(p)) {
    if (key === 'bucketId') continue;
    const label = BUCKET_FIELD_LABELS[key] ?? key;
    parts.push(`${label}=${fmtValue(p[key])}`);
  }
  if (parts.length === 0) return `Update bucket ${target} (no fields)`;
  // Common special case: rename only
  if (parts.length === 1 && 'name' in p) return `Update bucket ${target} — rename to ${quote(p.name)}`;
  return `Update bucket ${target} — set ${parts.join(', ')}`;
}

// ── Labels ──────────────────────────────────────────────────────────────────

function opLabel(op: number): string {
  if (op === STAGING_OPERATION.Create) return 'Create';
  if (op === STAGING_OPERATION.Update) return 'Update';
  if (op === STAGING_OPERATION.Delete) return 'Delete';
  return 'Unknown-op';
}

function entLabel(ent: number): string {
  if (ent === STAGING_ENTITY_TYPE.Task) return 'task';
  if (ent === STAGING_ENTITY_TYPE.Bucket) return 'bucket';
  if (ent === STAGING_ENTITY_TYPE.Dependency) return 'dependency';
  if (ent === STAGING_ENTITY_TYPE.Assignment) return 'assignment';
  return 'unknown-entity';
}

/**
 * Pretty-printed JSON of the payload for the collapsible "raw" section.
 * Falls back to the raw string if the JSON is malformed.
 */
export function formatRawPayload(row: TaskStagingRow): string {
  try {
    const parsed = JSON.parse(row.pmo_payload);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return row.pmo_payload ?? '';
  }
}
