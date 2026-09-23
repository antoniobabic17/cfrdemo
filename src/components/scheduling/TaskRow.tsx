import { useState, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Flag,
  MoreHorizontal,
  Trash2,
  Loader2,
  Calendar,
  Link2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import type { ProjectTask } from '../../models/projectTask.model';
import { getDisplayProgressPct, getTaskEffort, getTaskHoursDone } from '../../models/projectTask.model';
import { cn, toFriendlyError } from '../../lib/utils';
import { DeleteConfirmDialog, type DeleteChildSummary } from '../common/DeleteConfirmDialog';
import { TASK_PRIORITY_META, TASK_PRIORITY } from '../../lib/constants';
import { labelColorClass, labelNameFor } from '../../lib/labelPalette';
import type { TaskLabelChip } from '../../lib/labelPalette';
import { useTaskQueueState } from '../../lib/taskMutationQueue';
import { useTaskSubmitState } from '../../lib/submitProgressStore';
import { useIsPendingExtras, useOptimisticExtras } from '../../lib/pendingExtrasStore';
import { deriveTaskStatus, STATUS_META } from '../../lib/taskStatus';
import { formatDurationDays } from '../../lib/taskDuration';
import { TaskCompletionCheckbox } from './TaskCompletionCheckbox';

export interface TaskAssignee {
  assignmentId: string;
  taskId: string;
  teamMemberId: string;
  name: string;
  /** Per-assignment contributed hours (New Resource Model). Undefined on old model. */
  contributedHours?: number;
}

export interface TaskTeamMember {
  id: string;
  name: string;
}

interface Props {
  task: ProjectTask;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  predecessors: Array<{ depId: string; taskId: string; taskName: string }>;
  assignees: TaskAssignee[];
  teamMembers: TaskTeamMember[];
  onToggleCollapse: () => void;
  onUpdate: (
    taskId: string,
    subject?: string,
    progress?: number,
    scheduledStart?: string,
    scheduledEnd?: string,
    isMilestone?: boolean,
    effortCompleted?: number,
  ) => Promise<void>;
  onDelete: (taskId: string, hasChildren: boolean) => Promise<void>;
  /** @deprecated 2026-07-22: dep UI hidden pending Project Ops licensing. Kept optional so re-enable is a small commit. */
  onManageDependencies?: () => void;
  onAssign: (taskId: string, teamMemberId: string) => Promise<void>;
  onUnassign: (taskId: string, assignmentId: string) => Promise<void>;
  onError: (msg: string) => void;
  onSelectTask?: (taskId: string) => void;
  taskLabelMap?: Map<string, TaskLabelChip[]>;
  isDraggable?: boolean;
  canEdit?: boolean;
  /** Project id needed by TaskCompletionCheckbox mutations. */
  projectId: string;
  /** Whether the project uses the New Resource Model (drives completion guard). */
  useNewResourceModel?: boolean;
}

const INDENT_PX = 14;


function fmtDate(iso: string | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function TaskRow({
  task,
  depth,
  hasChildren,
  collapsed,
  predecessors,
  assignees,
  teamMembers,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onManageDependencies,
  onAssign,
  onUnassign,
  onError,
  onSelectTask,
  taskLabelMap,
  isDraggable,
  canEdit = true,
  projectId,
  useNewResourceModel = false,
}: Props) {
  const [editingSubject, setEditingSubject] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState(task.msdyn_subject);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Track mouse-down position to distinguish click vs drag for opening detail panel.
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const isOptimistic = task.msdyn_projecttaskid.startsWith('optimistic-');
  // Stage 4: surface in-flight queued PSS updates as a card-level spinner.
  const queueState = useTaskQueueState(task.msdyn_projecttaskid);
  // Stage 6.4: also lock the card while this task is in the submit pipeline
  // (active OR queued waiting its turn). Without this the user could click
  // into a queued task and edit it before its batch even started.
  const submitState = useTaskSubmitState(task.msdyn_projecttaskid);
  // Staging overlay rows are synthesized client-side without a `createdon`
  // timestamp (see stagingOverlay.taskFromCreate); real Dataverse rows always
  // have one. So a task with _saving=true AND no createdon is unambiguously
  // an in-flight staged create -- render its spinner.
  const isOverlayCreate = task._saving === true && !task.createdon;
  // Create-time extras (dates / priority / assignee) fire AFTER the base
  // create commits and the overlay row drops. Card must remain spinning
  // through the whole extras lifecycle -- pendingExtrasStore tracks that.
  const hasPendingExtras = useIsPendingExtras(task.msdyn_projecttaskid);
  // Optimistic patch: user-picked dates/priority that are still being
  // pushed. Layer them onto the display so the card shows what the user
  // asked for during the extras spin cycle, not the PSS defaults.
  const optimistic = useOptimisticExtras(task.msdyn_projecttaskid);
  const displayTask: ProjectTask = hasPendingExtras
    ? {
        ...task,
        msdyn_scheduledstart: optimistic.scheduledStart ?? task.msdyn_scheduledstart,
        msdyn_scheduledend: optimistic.scheduledEnd ?? task.msdyn_scheduledend,
        msdyn_priority: optimistic.priority ?? task.msdyn_priority,
      }
    : task;
  // Stage 6.5 hardening: trust the live signals (queue + submit pipeline
  // + overlay-create + pending-extras) over the cached _saving flag. A stuck
  // _saving (e.g. from an older session or a dropped invalidate) would
  // otherwise lock the card forever — user couldn't drag, couldn't click,
  // no spinner to indicate why. We only honor _saving when something is
  // actually happening for this task; for an optimistic create (id starts
  // with 'optimistic-') or an overlay-create row we still respect it since
  // those id placeholders aren't real Dataverse rows yet.
  const livelySaving = queueState.inFlight || submitState !== 'idle' || hasPendingExtras;
  const honorCachedSaving = livelySaving || isOptimistic || isOverlayCreate;
  const isSaving = (task._saving && honorCachedSaving) || isOptimistic || livelySaving || isOverlayCreate;

  const isClosed = task.statecode === 1;
  const status = deriveTaskStatus(task);
  const statusMeta = STATUS_META[status];
  const due = displayTask.msdyn_scheduledend ?? displayTask.msdyn_finish;
  // Stage 7: derive from hours when present so the bar always agrees with
  // 'Xh done / Yh total' even if msdyn_progress drifted on the server.
  const progress = getDisplayProgressPct(task);
  const isDone = isClosed || progress >= 100;
  const isOverdue = !isDone && due && new Date(due) < new Date();

  // Team members not yet assigned to this task
  const assignedIds = new Set(assignees.map((a) => a.teamMemberId));
  const unassignedMembers = teamMembers.filter((m) => !assignedIds.has(m.id));

  async function commitSubjectEdit() {
    const trimmed = subjectDraft.trim();
    setEditingSubject(false);
    if (!trimmed || trimmed === task.msdyn_subject) return;
    try {
      await onUpdate(task.msdyn_projecttaskid, trimmed);
    } catch (err) {
      onError(`Failed to rename task: ${toFriendlyError(err)}`);
      setSubjectDraft(task.msdyn_subject);
    }
  }

  // Child counts for the confirm dialog. Only what this row actually knows about.
  const deleteChildSummary: DeleteChildSummary[] = [];
  if (assignees.length > 0) deleteChildSummary.push({ label: 'assignee(s)', count: assignees.length });

  // Was a native confirm() gated on hasChildren, so deleting a normal top-level
  // task took one click with no warning. Now always confirmed via the shared
  // dialog (no type-to-confirm -- see DeleteConfirmDialog.requireTypedName).
  async function handleConfirmDelete() {
    try {
      await onDelete(task.msdyn_projecttaskid, hasChildren);
    } catch (err) {
      onError(`Failed to delete task: ${toFriendlyError(err)}`);
      throw err; // keep the dialog open so the error is visible
    }
  }

  async function handleAssign(teamMemberId: string) {
    try {
      await onAssign(task.msdyn_projecttaskid, teamMemberId);
    } catch (err) {
      onError(`Failed to assign resource: ${toFriendlyError(err)}`);
    }
  }

  async function handleUnassign(assignmentId: string) {
    try {
      await onUnassign(task.msdyn_projecttaskid, assignmentId);
    } catch (err) {
      onError(`Failed to remove assignment: ${toFriendlyError(err)}`);
    }
  }

  return (
    <div
      className={cn(
        'group relative flex items-start gap-1 rounded-md border-2 bg-card px-1.5 py-1.5 text-xs shadow-sm transition-colors',
        statusMeta.borderCls,
        statusMeta.bgCls,
        isSaving ? 'opacity-60' : 'hover:border-border hover:bg-card/80',
        task.msdyn_summary && 'font-medium bg-muted/40',
        isDone && !isSaving && 'opacity-60',
        isDraggable && !isSaving && 'cursor-grab active:cursor-grabbing',
      )}
      style={{ paddingLeft: `${6 + depth * INDENT_PX}px` }}
      draggable={isDraggable && !isSaving}
      onDragStart={
        isDraggable && !isSaving
          ? (e) => {
              e.dataTransfer.setData('application/x-task-id', task.msdyn_projecttaskid);
              e.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
      onMouseDown={(e) => {
        mouseDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (isSaving || editingSubject) return;
        // If the click originated on an interactive element (button, link, input, dropdown trigger),
        // let that element handle it — don't also open the detail panel.
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, textarea, select, [role="menuitem"], [data-radix-collection-item]')) {
          return;
        }
        // Distinguish click from drag: only open if the pointer barely moved.
        const start = mouseDownPos.current;
        if (start) {
          const dx = Math.abs(e.clientX - start.x);
          const dy = Math.abs(e.clientY - start.y);
          if (dx > 5 || dy > 5) return; // treat as drag, not click
        }
        onSelectTask?.(task.msdyn_projecttaskid);
      }}
    >
      {/* Completion checkbox -- leftmost. Marks Done or reopens per snapshot. */}
      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
        <TaskCompletionCheckbox task={task} projectId={projectId} disabled={!canEdit} useNewResourceModel={useNewResourceModel} assignees={assignees} />
      </div>

{/* Collapse toggle or spacer */}
      <button
        onClick={hasChildren ? onToggleCollapse : undefined}
        className={cn(
          'shrink-0 h-4 w-4 flex items-center justify-center rounded text-muted-foreground',
          hasChildren ? 'hover:text-foreground cursor-pointer' : 'cursor-default opacity-0',
        )}
        tabIndex={hasChildren ? 0 : -1}
      >
        {hasChildren ? (
          collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : null}
      </button>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Subject line */}
        <div className="flex items-start gap-1">
          {task.msdyn_ismilestone && (
            <Flag className="h-3 w-3 text-amber-500 mt-px shrink-0" />
          )}

          {editingSubject ? (
            <input
              ref={subjectRef}
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              onBlur={commitSubjectEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSubjectEdit();
                if (e.key === 'Escape') { setEditingSubject(false); setSubjectDraft(task.msdyn_subject); }
              }}
              className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-xs"
              autoFocus
            />
          ) : (
            <span
              className={cn(
                'flex-1 min-w-0 break-words leading-snug cursor-pointer hover:text-primary transition-colors',
                status === 'done' && 'line-through text-muted-foreground',
              )}
              onDoubleClick={(e) => {
                if (isSaving || !canEdit) return;
                e.stopPropagation();
                setSubjectDraft(task.msdyn_subject);
                setEditingSubject(true);
                setTimeout(() => subjectRef.current?.focus(), 50);
              }}
              title={canEdit ? "Click anywhere to open details · Double-click to edit name" : "Click to open details (read-only)"}
            >
              {task.pmo_taskid && (
                <span className="font-mono text-[10px] text-muted-foreground mr-1.5 tabular-nums">
                  {task.pmo_taskid}
                </span>
              )}
              {task.msdyn_subject}
            </span>
          )}

          {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
        </div>

        {/* Priority + milestone row */}
        <div className="flex items-center gap-1 flex-wrap">
          {displayTask.msdyn_priority !== undefined && displayTask.msdyn_priority !== null && (
            <span className={cn('text-[9px] font-medium px-1 rounded', TASK_PRIORITY_META[displayTask.msdyn_priority]?.cls ?? 'bg-muted text-muted-foreground')}>
              {TASK_PRIORITY_META[displayTask.msdyn_priority]?.label ?? TASK_PRIORITY_META[TASK_PRIORITY.Medium].label}
            </span>
          )}
          {task.msdyn_iscritical && (
            <span className="text-[9px] font-medium px-1 rounded bg-rose-100 text-rose-700">Critical Path</span>
          )}
        </div>

        {/* Progress indicator — visual only. Mark complete from the detail panel.
            Summary tasks show their rolled-up progress (computed by PSS) but cannot be
            edited — their value is derived from child tasks. */}
        {status !== 'done' && (
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Dates + status pill.
            Status pill lives in this row so it doesn't overlap the
            subject text at the top of the tile (operator report
            2026-07-18). It sits before the dates so the eye reads
            status -> dates -> effort as a compact horizontal strip. */}
        {/* Status pill on its own line. */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn(
            'text-[9px] font-medium px-1.5 py-0.5 rounded-full pointer-events-none shrink-0',
            statusMeta.pillCls,
          )}>
            {statusMeta.label}
          </span>
        </div>

        {/* Dates on a dedicated line BELOW the status. Start -> Due are kept on
            ONE line (no wrap between them) so the pair never splits across lines;
            the row can scroll rather than wrap the date pair. */}
        {(displayTask.msdyn_scheduledstart || due) && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden">
            {displayTask.msdyn_scheduledstart && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Calendar className="h-2.5 w-2.5" />
                {fmtDate(displayTask.msdyn_scheduledstart)}
              </span>
            )}
            {due && (
              <span className={cn('flex items-center gap-0.5 shrink-0', isOverdue && 'text-rose-500')}>
                {displayTask.msdyn_scheduledstart && '→'}
                {fmtDate(due)}
                {isOverdue && ' overdue'}
              </span>
            )}
            {!task.msdyn_summary && formatDurationDays(displayTask.msdyn_duration) && (
              <span className="text-muted-foreground/80 shrink-0" title="Duration">
                · {formatDurationDays(displayTask.msdyn_duration)}
              </span>
            )}
          </div>
        )}

        {/* Effort -- prefer CVS-owned pmo_taskeffort/hoursdone over PSS-owned msdyn_* */}
        {(() => {
          if (task.msdyn_summary) return null;
          const effort = getTaskEffort(task);
          const done = getTaskHoursDone(task);
          if (effort === undefined && done === undefined) return null;
          return (
            <p className="text-[10px] text-muted-foreground">
              {done ?? 0}h done
              {effort ? ` / ${effort}h total` : ''}
            </p>
          );
        })()}

        {/* Assignee chips */}
        {!task.msdyn_summary && (assignees.length > 0 || teamMembers.length > 0) && (
          <div className="flex items-center gap-1 flex-wrap">
            {assignees.map((a) => (
              <span
                key={a.assignmentId}
                title={a.name}
                className="inline-flex items-center gap-0.5 text-[9px] font-medium bg-primary/10 text-primary rounded px-1 py-0.5"
              >
                {initials(a.name)}
                <button
                  onClick={() => { if (canEdit) handleUnassign(a.assignmentId); }}
                  disabled={!canEdit}
                  className="hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-current"
                  title={canEdit ? `Remove ${a.name}` : 'Read-only'}
                >
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
            {unassignedMembers.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                    title="Assign resource"
                  >
                    <UserPlus className="h-2.5 w-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="text-xs min-w-[140px]">
                  {unassignedMembers.map((m) => (
                    <DropdownMenuItem key={m.id} disabled={!canEdit} onClick={() => { if (canEdit) handleAssign(m.id); }}>
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {/* Label chips */}
        {taskLabelMap && (() => {
          const chips = taskLabelMap.get(task.msdyn_projecttaskid);
          if (!chips || chips.length === 0) return null;
          return (
            <div className="flex items-center gap-0.5 flex-wrap">
              {chips.map((chip) => (
                <span
                  key={chip.labelId}
                  className={cn('text-[9px] font-semibold px-1.5 py-px rounded-full truncate max-w-[80px]', labelColorClass(chip.colorIndex))}
                  title={labelNameFor(chip.labelText, chip.colorIndex)}
                >
                  {labelNameFor(chip.labelText, chip.colorIndex)}
                </span>
              ))}
            </div>
          );
        })()}

        {/* Predecessors — read-only display. Clickable "Manage dependencies"
            removed 2026-07-22 pending Project Ops licensing (plan.md). */}
        {predecessors.length > 0 && (
          onManageDependencies ? (
            <button
              onClick={onManageDependencies}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors text-left"
              title="Manage dependencies"
            >
              <Link2 className="h-2.5 w-2.5 shrink-0" />
              {predecessors.length === 1
                ? `Depends on: ${predecessors[0].taskName}`
                : `Depends on ${predecessors.length} tasks`}
            </button>
          ) : (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Link2 className="h-2.5 w-2.5 shrink-0" />
              {predecessors.length === 1
                ? `Depends on: ${predecessors[0].taskName}`
                : `Depends on ${predecessors.length} tasks`}
            </div>
          )
        )}
      </div>

      {/* Actions menu */}
      {!isSaving && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="shrink-0 h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem
              disabled={!canEdit}
              onClick={() => {
                if (!canEdit) return;
                setSubjectDraft(task.msdyn_subject);
                setEditingSubject(true);
                setTimeout(() => subjectRef.current?.focus(), 50);
              }}
            >
              Edit name
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canEdit} onClick={() => { if (canEdit) onUpdate(task.msdyn_projecttaskid, undefined, undefined, undefined, undefined, !task.msdyn_ismilestone); }}>
              {task.msdyn_ismilestone ? 'Remove milestone' : 'Mark as milestone'}
            </DropdownMenuItem>
            {!task.msdyn_summary && unassignedMembers.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!canEdit}>
                  <UserPlus className="h-3.5 w-3.5 mr-2" />
                  Assign to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="text-xs">
                  {unassignedMembers.map((m) => (
                    <DropdownMenuItem key={m.id} disabled={!canEdit} onClick={() => { if (canEdit) handleAssign(m.id); }}>
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            {/* Manage-dependencies — only when the handler is wired (custom source, Phase 0.2b). */}
            {onManageDependencies && (
              <DropdownMenuItem disabled={!canEdit} onClick={() => { if (canEdit) onManageDependencies(); }}>
                <Link2 className="h-3.5 w-3.5 mr-2" />
                Manage dependencies
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!canEdit}
              className="text-destructive focus:text-destructive"
              onClick={() => { if (canEdit) setDeleteDialogOpen(true); }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete task"
        recordName={task.msdyn_subject ?? '(untitled task)'}
        childSummary={deleteChildSummary}
        requireTypedName={false}
        extraWarning={hasChildren
          ? 'This task has child tasks. Deleting it removes those child tasks too. There is no undo.'
          : 'There is no undo.'}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
