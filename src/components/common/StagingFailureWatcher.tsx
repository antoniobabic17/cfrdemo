/**
 * StagingFailureWatcher — mount inside a ProjectDetailPage-scoped component.
 *
 * When a `pmo_taskstaging` row for the current project flips to Failed, this
 * component:
 *   1. Records a `FailedSave` so the existing FailedSavesTray shows a
 *      persistent retryable entry (parity with the pre-staging UX).
 *   2. Raises a friendly `toast.error` that auto-logs into the Error Log via
 *      the existing `logAppError()` path.
 *
 * The read overlay (`applyTaskStagingOverlay`) already drops Failed rows from
 * the view — the card "snaps back" to the upstream value implicitly. This
 * watcher's job is only the messaging + tray entry.
 *
 * Deduped by (stagingId, attempts) inside useFailedStagingWatcher so an
 * operator retrying a Failed row only ever sees one toast per attempt.
 */
import { useCallback } from 'react';
import { useFailedStagingWatcher } from '../../lib/stagingOverlay';
import { recordFailedSave } from '../../lib/failedSavesStore';
import { toast } from '../../hooks/useToast';
import { friendlyTaskError, isQuotaError } from '../../lib/utils';
import {
  STAGING_ENTITY_TYPE,
  STAGING_OPERATION,
  STAGING_SYNC_STATUS,
  type StagingEntityType,
  type StagingOperation,
} from '../../lib/constants';
import { invokeFlushTaskStaging, updateStagingRow } from '../../api/taskStaging.api';
import { isRetryInFlight } from '../../lib/retryInFlightRegistry';
import type { TaskStagingRow } from '../../models/taskStaging.model';
import type { ScheduleTaskUpdate } from '../../lib/schedulingClient';
import type { ProjectTask } from '../../models/projectTask.model';
import { useQueryClient } from '@tanstack/react-query';

interface Props {
  projectId: string | undefined;
}

function entityTypeName(t: StagingEntityType): string {
  if (t === STAGING_ENTITY_TYPE.Task) return 'task';
  if (t === STAGING_ENTITY_TYPE.Bucket) return 'bucket';
  if (t === STAGING_ENTITY_TYPE.Dependency) return 'dependency';
  if (t === STAGING_ENTITY_TYPE.Assignment) return 'assignment';
  return 'record';
}

function operationName(o: StagingOperation): string {
  if (o === STAGING_OPERATION.Create) return 'create';
  if (o === STAGING_OPERATION.Update) return 'update';
  if (o === STAGING_OPERATION.Delete) return 'delete';
  return 'change';
}

const FIELD_LABELS: Record<string, string> = {
  scheduledStart: 'Start Date',
  scheduledEnd: 'Due Date',
  duration: 'Duration',
  effort: 'Effort',
  effortCompleted: 'Hours Done',
  priority: 'Priority',
  isMilestone: 'Milestone',
  description: 'Description',
  bucketId: 'Bucket',
  subject: 'Task Name',
};

function labelField(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function composeFriendlyMessage(
  row: TaskStagingRow,
  taskSubject: string | undefined,
): { headline: string; details: string[] } {
  const entity = entityTypeName(row.pmo_entitytype);
  const op = operationName(row.pmo_operation);
  const nameSuffix = taskSubject ? ' "' + taskSubject + '"' : '';
  let patch: Record<string, unknown> = {};
  try { patch = JSON.parse(row.pmo_payload); } catch { /* keep empty */ }
  const changedFields = Object.keys(patch).filter((k) => k !== 'taskId' && k !== 'projectId');

  if (entity === 'assignment') {
    // Strip the trailing " : Task" that stageAssignmentCreate appends to name.
    const rawName = typeof patch.name === 'string' ? patch.name : '';
    const who = rawName.replace(/\s*:\s*Task$/i, '') || 'a resource';
    return {
      headline: op === 'delete'
        ? "Couldn't unassign " + who + " from task" + nameSuffix + "."
        : "Couldn't assign " + who + " to task" + nameSuffix + ".",
      details: [],
    };
  }

  if (entity === 'task' && op === 'update') {
    const labels = changedFields.map(labelField);
    if (labels.length === 1) {
      return { headline: "Couldn't apply " + labels[0] + " to task" + nameSuffix + ".", details: [] };
    }
    return {
      headline: "Some changes to task" + nameSuffix + " didn't save.",
      details: labels,
    };
  }

  if (entity === 'task' && op === 'create') {
    const subj = typeof patch.subject === 'string' ? patch.subject : 'the task';
    return { headline: "Couldn't create task \"" + subj + "\".", details: [] };
  }

  if (entity === 'task' && op === 'delete') {
    return { headline: "Couldn't delete task" + nameSuffix + ".", details: [] };
  }

  return { headline: "Couldn't " + op + " " + entity + nameSuffix + ".", details: [] };
}

export function StagingFailureWatcher({ projectId }: Props) {
  const qc = useQueryClient();
  const onFailed = useCallback((row: TaskStagingRow) => {
    // Suppress the friendly toast + auto-log while a client-side retry loop
    // is in flight for this target. The loop owns all outcome logging and
    // will emit either a 'succeeded' or 'gave-up-auto-retry' AppError.
    if (isRetryInFlight(row.pmo_targetid)) return;
    const raw = row.pmo_syncerror ?? 'Save failed.';
    const rawFriendly = friendlyTaskError(raw);
    const entity = entityTypeName(row.pmo_entitytype);
    const op = operationName(row.pmo_operation);

    // Look up the task subject from the cached projectTasks list.
    // For assignments the target is the assignment id, so we resolve via
    // the payload.taskId instead. Fall back to a 6-char id snippet if the
    // task isn't in the cache yet (fresh reload before hydrate).
    const tasks = qc.getQueryData<ProjectTask[]>(['projectTasks', projectId]);
    let taskIdForLookup = row.pmo_targetid;
    try {
      const pp = JSON.parse(row.pmo_payload);
      if (typeof pp?.taskId === 'string') taskIdForLookup = pp.taskId;
    } catch { /* ignore */ }
    let subject = tasks?.find((t) => t.msdyn_projecttaskid === taskIdForLookup)?.msdyn_subject;
    if (!subject && taskIdForLookup) {
      subject = 'ID ' + taskIdForLookup.slice(0, 6);
    }
    const { headline, details } = composeFriendlyMessage(row, subject);
    const visible = details.length > 0
      ? headline + '\nAffected: ' + details.join(', ')
      : headline;

    // Toast (auto-logs to Error Log via useToast.toast.error -> logAppError).
    // rawError carries the friendly-first-then-raw payload so the Error Log
    // entry is fully diagnosable while the visible toast stays clean.
    toast.error(visible, {
      action: 'staging ' + op + ' ' + entity,
      entityType: entity,
      entityId: row.pmo_targetid,
      parentProjectId: projectId,
      rawError: rawFriendly + '\n---\n' + raw,
      attempt: row.pmo_attempts ?? 1,
      stagingRowId: row.pmo_taskstagingid,
    });

    // FailedSavesTray entry. The store's retry semantics expect a runner that
    // re-fires the PATCH; for staging the equivalent action is to flip the
    // row back to Pending via the Custom API. We capture that as the runner.
    let patch: Record<string, unknown> = {};
    try { patch = JSON.parse(row.pmo_payload); } catch { /* keep {} */ }
    const fields =
      row.pmo_operation === STAGING_OPERATION.Update
        ? Object.keys(patch).filter((k) => k !== 'taskId')
        : [op];

    recordFailedSave({
      taskId: row.pmo_targetid,
      fields,
      patch: patch as Omit<ScheduleTaskUpdate, 'taskId'>,
      // Runner: retry through the Custom API (ForceRetry=true).
      runner: async () => {
        if (!projectId) throw new Error('No project scope for retry.');
        // Prefer the Custom API which flips Failed → Pending + fires the plugin.
        try {
          await invokeFlushTaskStaging({
            projectId,
            stagingIds: [row.pmo_taskstagingid],
            forceRetry: true,
          });
          return;
        } catch {
          // Fallback: patch the row directly if the Custom API isn't deployed yet.
          // Flipping status back to Pending fires the async plugin, which
          // re-drains and either succeeds or re-fails.
          await updateStagingRow(row.pmo_taskstagingid, {
            pmo_syncstatus: STAGING_SYNC_STATUS.Pending,
          });
        }
      },
      message: visible,
      isQuota: isQuotaError(raw),
    });
  }, [projectId, qc]);

  useFailedStagingWatcher(projectId, onFailed);
  return null;
}
