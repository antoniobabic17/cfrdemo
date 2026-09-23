import { useState, useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import type { ProjectTask } from '../../models/projectTask.model';
import type { ProjectBucket } from '../../models/projectBucket.model';
import type { ScheduleTaskCreate } from '../../lib/schedulingClient';
import type { TaskTeamMember } from './TaskRow';
import { serializeError } from '../../lib/utils';
import { logAppError } from '../../lib/errorLog';
import { markPendingExtras } from '../../lib/pendingExtrasStore';
import { todayLocalYmd } from '../../lib/dateOnly';
import { TASK_PRIORITY, TASK_PRIORITY_OPTIONS } from '../../lib/constants';

/**
 * Extras applied AFTER the task is created. PSS rejects dates / priority on
 * the create OperationSet (msdyn_scheduledstart, msdyn_priority) and
 * assignments are a separate junction entity, so they need to be applied
 * once the new task id surfaces.
 */
export interface CreateTaskExtras {
  scheduledStart?: string; // ISO date
  scheduledEnd?: string;   // ISO date
  priority?: number;       // TASK_PRIORITY.* value
  assigneeIds: string[];   // taskTeamMember ids (systemuserid or projectteamid)
}

interface Props {
  open: boolean;
  projectId: string;
  buckets: ProjectBucket[];
  defaultBucketId?: string;
  tasks: ProjectTask[];
  teamMembers?: TaskTeamMember[];
  onCreateTask: (params: ScheduleTaskCreate) => Promise<{ taskId?: string }>;
  /** Called after onCreateTask resolves so the parent can chain the
   *  extras (dates / priority / assignees) using the freshly-created
   *  task's real id. The parent owns the polling-for-real-id logic. */
  onAfterCreate?: (params: ScheduleTaskCreate, extras: CreateTaskExtras, preAssignedTaskId?: string) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}

interface FormState {
  subject: string;
  description: string;
  bucketId: string;
  parentTaskId: string;
  isMilestone: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  priority: number | '';
  assigneeIds: string[];
}

const EMPTY_FORM: FormState = {
  subject: '',
  description: '',
  bucketId: '',
  parentTaskId: '',
  isMilestone: false,
  scheduledStart: '',
  scheduledEnd: '',
  priority: '',
  assigneeIds: [],
};

export function CreateTaskDialog({
  open,
  projectId,
  buckets,
  defaultBucketId,
  tasks,
  teamMembers = [],
  onCreateTask,
  onAfterCreate,
  onError: _onError,
  onClose,
}: Props) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, bucketId: defaultBucketId ?? '' });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);

  // Reset form each time the dialog opens, picking up the current defaultBucketId.
  // useEffect is required because Radix UI does not call onOpenChange(true) when open
  // is set programmatically from the parent — only user-initiated closes fire it.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({ ...EMPTY_FORM, bucketId: defaultBucketId ?? '' });
      setDialogError(null);
    }
  }, [open, defaultBucketId]);

  // Has the user actually typed anything? bucketId is EXCLUDED because it is
  // pre-filled from the column the user clicked "+" on -- treating that as a
  // change would prompt on every dismissal of an untouched form.
  const isDirty = (
    form.subject.trim() !== '' ||
    form.description.trim() !== '' ||
    form.parentTaskId !== '' ||
    form.isMilestone ||
    form.scheduledStart !== '' ||
    form.scheduledEnd !== '' ||
    form.priority !== '' ||
    form.assigneeIds.length > 0
  );

  // Radix fires onOpenChange(false) for BOTH overlay-click and Escape, so this
  // single guard covers both. Previously it closed unconditionally and a stray
  // click outside the dialog silently threw away a half-filled task.
  function handleOpenChange(isOpen: boolean) {
    if (isOpen) return;
    if (isDirty) {
      setDiscardPromptOpen(true);
      return;
    }
    onClose();
  }

  function confirmDiscard() {
    setDiscardPromptOpen(false);
    onClose();
  }

  function toggleAssignee(id: string) {
    setForm((f) =>
      f.assigneeIds.includes(id)
        ? { ...f, assigneeIds: f.assigneeIds.filter((x) => x !== id) }
        : { ...f, assigneeIds: [...f.assigneeIds, id] },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) return;

    // Client-side guard: bucket is required by Dataverse
    if (!form.bucketId) {
      setDialogError('Please select a Bucket before creating the task.');
      return;
    }

    // Client-side guard: due cannot be before start when both are set.
    if (form.scheduledStart && form.scheduledEnd && form.scheduledEnd < form.scheduledStart) {
      setDialogError('Due date cannot be before the start date.');
      return;
    }

    // Only send isMilestone when the user explicitly checked the box.
    // PSS blocks any write to msdyn_ismilestone that is not a genuine
    // transition (AV-0002). The plugin follow-up also filters on
    // "explicitly true"; this is defense-in-depth at the client.
    //
    // Dates and priority stay OUT of baseParams and flow through the
    // extras path below. Reason: same-OperationSet follow-up updates
    // for msdyn_scheduledstart return PSS E_NOTEDITABLE because the
    // new task hasn't been scheduled by PSS yet. handleAfterCreateTask
    // fires them as a subsequent update mutation, which under staging
    // goes through its own staging row + drain (separate OperationSet)
    // -- exactly the pattern PSS allows for date writes.
    const trimmedDesc = form.description.trim();
    const baseParams: ScheduleTaskCreate = {
      projectId,
      bucketId: form.bucketId || undefined,
      parentTaskId: form.parentTaskId || undefined,
      subject: form.subject.trim(),
      ...(trimmedDesc ? { description: trimmedDesc } : {}),
      ...(form.isMilestone ? { isMilestone: true } : {}),
    };

    // Default the start date to today's LOCAL calendar day when the user
    // leaves it blank. PSS's own default is the project's msdyn_scheduledstart,
    // which for old projects can be arbitrarily far in the past (e.g. a
    // project created weeks ago). Users creating a new task want it to sit
    // on today, not on the project's kickoff date. Same helper the wizard
    // and Decision/Closeout forms use so DST + timezone shifts are consistent.
    const extras: CreateTaskExtras = {
      scheduledStart: form.scheduledStart || todayLocalYmd(),
      scheduledEnd: form.scheduledEnd || undefined,
      priority: form.priority === '' ? undefined : form.priority,
      assigneeIds: form.assigneeIds,
    };

    // Close immediately — useCreateProjectTask.onMutate injects the optimistic
    // task with _saving:true so the spinner appears on the board right away.
    onClose();

    onCreateTask(baseParams)
      .then((result) => {
        // Upgrade the pending-extras patch with the user's picked values
        // so TaskRow can show the dates + priority optimistically while
        // the extras are still being pushed. mutationFn set an empty
        // patch already (flag only); this widens it. If any extra fails
        // the patch is cleared by markExtrasDone in the finally block.
        if (result?.taskId) {
          markPendingExtras(result.taskId, {
            scheduledStart: extras.scheduledStart,
            scheduledEnd: extras.scheduledEnd,
            priority: extras.priority,
          });
        }
        const hasExtras =
          extras.scheduledStart ||
          extras.scheduledEnd ||
          extras.priority !== undefined ||
          extras.assigneeIds.length > 0;
        if (hasExtras && onAfterCreate) onAfterCreate(baseParams, extras, result?.taskId);
      })
      .catch((err) => {
        // Silent log-only. StagingFailureWatcher.onFailed is the single
        // operator-facing surface for staging Create failures -- it fires
        // the friendly "Couldn't create task \"X\"." toast on the
        // pmo_taskstaging Failed row. Firing a second toast or an inline
        // banner here doubles up on the same event with a raw PSS blob
        // ("ScheduleAPI-AV-*: <field> is not a valid column...") which is
        // hostile to non-technical users. Route the raw payload straight
        // to Admin > Error Log via logAppError so support still has full
        // diagnostics.
        const raw = serializeError(err);
        logAppError({
          message: "Couldn't create task",
          rawError: raw,
          action: 'createTask',
          entityType: 'task',
          parentProjectId: projectId,
        });
      });
  }

  // Only non-summary tasks can be parents (avoid circular parent references)
  const parentCandidates = tasks.filter((t) => !t.msdyn_projecttaskid.startsWith('optimistic-'));

  const selectedAssignees = teamMembers.filter((m) => form.assigneeIds.includes(m.id));

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">New Task</DialogTitle>
        </DialogHeader>

        {dialogError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{dialogError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Task name *</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Enter task name"
              className="text-sm"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Add a description…"
              maxLength={2000}
              className="w-full min-h-[72px] resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Bucket *</Label>
              <select
                value={form.bucketId}
                onChange={(e) => setForm((f) => ({ ...f, bucketId: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select a bucket…</option>
                {buckets
                  .filter((b) => !b.msdyn_projectbucketid.startsWith('optimistic-'))
                  .map((b) => (
                    <option key={b.msdyn_projectbucketid} value={b.msdyn_projectbucketid}>
                      {b.msdyn_name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Parent task</Label>
              <select
                value={form.parentTaskId}
                onChange={(e) => setForm((f) => ({ ...f, parentTaskId: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">None</option>
                {parentCandidates.map((t) => (
                  <option key={t.msdyn_projecttaskid} value={t.msdyn_projecttaskid}>
                    {t.msdyn_subject}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start date</Label>
              <Input
                type="date"
                value={form.scheduledStart}
                onChange={(e) => setForm((f) => ({ ...f, scheduledStart: e.target.value }))}
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due date</Label>
              <Input
                type="date"
                value={form.scheduledEnd}
                onChange={(e) => setForm((f) => ({ ...f, scheduledEnd: e.target.value }))}
                className="text-xs"
              />
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <select
              value={form.priority === '' ? '' : String(form.priority)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  priority: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">None</option>
              {TASK_PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Assignees */}
          {teamMembers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Assignees</Label>
              {selectedAssignees.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedAssignees.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary rounded-full px-2 py-0.5"
                    >
                      {m.name}
                      <button
                        type="button"
                        onClick={() => toggleAssignee(m.id)}
                        className="hover:text-destructive transition-colors"
                        aria-label={`Remove ${m.name}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  toggleAssignee(e.target.value);
                  e.target.value = '';
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Add an assignee…</option>
                {teamMembers
                  .filter((m) => !form.assigneeIds.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              id="milestone"
              type="checkbox"
              checked={form.isMilestone}
              onChange={(e) => setForm((f) => ({ ...f, isMilestone: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-border"
            />
            <label htmlFor="milestone" className="text-xs text-muted-foreground cursor-pointer">
              Milestone
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!form.subject.trim()}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>

      {/* Unsaved-changes guard. Radix routes both overlay-click and Escape
          through onOpenChange, so this covers both gestures. Sibling of the
          form dialog rather than nested -- nested Radix dialogs contend for
          focus and the inner one can end up unclickable. */}
      <Dialog open={discardPromptOpen} onOpenChange={setDiscardPromptOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Discard this task?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You have started filling in this task. Closing now discards it.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDiscardPromptOpen(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDiscard}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Re-export for callers that want the priority default.
export const DEFAULT_TASK_PRIORITY = TASK_PRIORITY.Medium;
