import { useState, useRef, useEffect, useCallback } from 'react';
import { Flag, Trash2, Loader2, Calendar, UserPlus, X, AlertCircle, Pencil, Check, RotateCcw, GripVertical } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  startSubmit,
  getPersistedDrafts,
  clearPersistedDrafts,
  consumePendingHighlight,
  useSubmitProgress,
  useTaskSubmitState,
  type TaskDraftSnapshot,
  type SubmitStep,
} from '../../lib/submitProgressStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ViewDetailPanel } from '../common/ViewDetailPanel';
import { DeleteConfirmDialog, type DeleteChildSummary } from '../common/DeleteConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { cn, toFriendlyError } from '../../lib/utils';
import type { ProjectTask } from '../../models/projectTask.model';
import { getTaskEffort, getTaskHoursDone } from '../../models/projectTask.model';
import { captureCompletionSnapshot, popCompletionSnapshot } from '../../lib/taskCompletionSnapshot';
import { GuardAlertDialog } from '../common/GuardAlertDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useUpdateTaskCustomFields } from '../../hooks/useProjectTaskMutations';
import { deriveTaskStatus, STATUS_META } from '../../lib/taskStatus';
import { computeDurationDays, formatDurationDays } from '../../lib/taskDuration';
import { TaskCompletionCheckbox } from './TaskCompletionCheckbox';
import type { TaskAssignee, TaskTeamMember } from './TaskRow';
import type { ScheduleTaskUpdate } from '../../lib/schedulingClient';
import { useTaskQueueState } from '../../lib/taskMutationQueue';
import { diffEntityUpdate, TASK_FIELD_LABELS } from '../../lib/changeAuditFields';
import { NotesSection } from '../projects/NotesSection';
import { TASK_PRIORITY_OPTIONS, TASK_PRIORITY_META } from '../../lib/constants';
import { useProjectLabels, useProjectTaskLabels, useAssignLabel, useRemoveLabel, useRenameLabel } from '../../hooks/useProjectLabels';
import { useTaskSource } from '../../lib/taskSource';
import { fmtDateOnly, dateInputValue, toDataverseDateOnly, todayLocalYmd } from '../../lib/dateOnly';
import { CustomLabelEditor } from './CustomLabelEditor';
import { DocumentLibrary } from '../projects/DocumentLibrary';
import { useProjectSprints, useSetTaskSprint } from '../../hooks/useProjectSprints';
import { useUpdateAssignmentHours } from '../../hooks/useResourceAssignmentMutations';
import {
  useProjectChecklists,
  useCreateChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  useReorderChecklist,
} from '../../hooks/useProjectChecklists';


function toDateInput(iso: string | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/**
 * Splice the user's picked YYYY-MM-DD onto the EXISTING time portion of
 * `original`. PSS-stored task dates carry a non-midnight time (e.g. 13:00Z
 * because the project calendar starts at 9am local). If we naively re-attach
 * `T00:00:00Z` we shift the date by hours, which:
 *   1) makes the field look "dirty" on first open,
 *   2) changes Duration -> forces PSS to recompute Effort ->
 *      cascades into a wrong %% complete on the card.
 * Preserving the original time keeps the field round-trip-stable.
 */
function fromDateInput(val: string, original?: string): string | undefined {
  if (!val) return undefined;
  if (original && original.length >= 10) {
    // Original ISO looks like "2026-05-13T13:00:00Z". Splice in the new
    // date, keep the original time + offset suffix.
    return `${val}${original.slice(10)}`;
  }
  return `${val}T00:00:00Z`;
}

/** Compare only the YYYY-MM-DD portion of two ISO date strings. */
function sameDay(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').slice(0, 10) === (b ?? '').slice(0, 10);
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Stage 4: tiny pulsing indicator placed beside a field label while the
// queued PSS update for that field is in flight or pending.
function SavingDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      title="Saving..."
      aria-label="Saving"
      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse align-middle"
    />
  );
}

interface Props {
  task: ProjectTask | null;
  projectId: string;
  hasChildren: boolean;
  predecessors: Array<{ depId: string; taskId: string; taskName: string }>;
  assignees: TaskAssignee[];
  teamMembers: TaskTeamMember[];
  onClose: () => void;
  onUpdate: (params: Omit<ScheduleTaskUpdate, 'taskId'> & { taskId: string }) => Promise<void>;
  /**
   * Called once at the end of a successful Submit with the full batched
   * audit entry list (field changes + label/assignee/checklist relationship
   * changes). Wave 1 — the parent computes the field-side diff and the
   * panel appends the relationship-side entries here. If undefined, no audit
   * row is emitted from the panel (parent is expected to auto-audit).
   */
  onAuditBatch?: (
    taskId: string,
    taskName: string,
    entries: import('../../hooks/useChangeAudit').ChangeAuditEntry[],
  ) => void;
  onDelete: (taskId: string, hasChildren: boolean) => Promise<void>;
  /** initialHours (New Resource Model only): contributed hours stamped on the brand-new assignment row at create time, so a value entered next to a just-added assignee persists on the first Save. Ignored on the old model. */
  onAssign: (taskId: string, teamMemberId: string, initialHours?: number) => Promise<void>;
  onUnassign: (taskId: string, assignmentId: string) => Promise<void>;
  /** @deprecated 2026-07-22: dep UI hidden pending Project Ops licensing. */
  onManageDependencies?: () => void;
  onError: (msg: string) => void;
  onTasksInvalidate: () => void;
  /** When false, the panel renders read-only: all inputs are disabled and
   *  the Save / Discard / Delete actions are hidden. */
  canEdit?: boolean;
  /** When true the project uses the New Resource Model: Hours Done is
   *  calculated from per-assignee contributed hours, and each assignee row
   *  gets an inline hours input. Old model: no change to existing behaviour. */
  useNewResourceModel?: boolean;
  /** All assignments for this project (all tasks), used for the per-person
   *  capacity hint (sum across tasks on this project per assignee). Optional —
   *  hint is omitted when not supplied. */
  allProjectAssignees?: TaskAssignee[];
}

export function TaskDetailPanel({
  task,
  projectId,
  hasChildren,
  predecessors: _predecessors,
  assignees,
  teamMembers,
  onClose,
  onUpdate,
  onAuditBatch,
  onDelete,
  onAssign,
  onUnassign,
  onManageDependencies: _onManageDependencies,
  onError,
  onTasksInvalidate: _onTasksInvalidate,
  canEdit = true,
  useNewResourceModel = false,
  allProjectAssignees,
}: Props) {
  const [subjectDraft, setSubjectDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [effortDraft, setEffortDraft] = useState('');
  // Stage 7: explicit Hours done input replaces the slider. The user types
  // hours directly; %% complete becomes a derived read-only display.
  const [hoursDoneDraft, setHoursDoneDraft] = useState('');
  // Batched-edit drafts — changes don't persist until the user clicks Save.
  const [milestoneDraft, setMilestoneDraft] = useState(false);
  const [priorityDraft, setPriorityDraft]   = useState<number>(5);
  const [startDraft, setStartDraft]         = useState('');  // ISO
  const [endDraft, setEndDraft]             = useState('');  // ISO
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [discardPromptOpen, setDiscardPromptOpen] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [newChecklistText, setNewChecklistText] = useState('');
  const subjectRef = useRef<HTMLInputElement>(null);
  const checklistInputRef = useRef<HTMLInputElement>(null);

  // Checklist hooks
  const taskIdForChecklist = task?.msdyn_projecttaskid ?? null;
  const { data: checklists = [] } = useProjectChecklists(taskIdForChecklist);
  const createChecklist = useCreateChecklistItem(taskIdForChecklist ?? '', projectId);
  const updateChecklist = useUpdateChecklistItem(taskIdForChecklist ?? '');
  const deleteChecklist = useDeleteChecklistItem(taskIdForChecklist ?? '', projectId);
  const reorderChecklist = useReorderChecklist(taskIdForChecklist ?? '');

  // Label hooks
  const { data: projectLabels = [] } = useProjectLabels(projectId);
  const { data: allTaskLabels = [] } = useProjectTaskLabels(projectId);
  const assignLabel = useAssignLabel(projectId);
  const removeLabel = useRemoveLabel(projectId);
  const renameLabel = useRenameLabel(projectId);
  const labelSource = useTaskSource();
  const isCustomLabels = labelSource !== 'pss';
  const updateCustomFields = useUpdateTaskCustomFields(projectId);
  const [renamingLabelId, setRenamingLabelId] = useState<string | null>(null);
  const [renameLabelDraft, setRenameLabelDraft] = useState('');

  // Stage 6.2: label changes are draft-only — they only fire when the user
  // hits Submit. Assigns and removes are stored as Sets keyed by labelId
  // (NOT junctionId so a remove-then-re-add cancels cleanly). Renames are a
  // Map<labelId, newName>.
  const [labelDraftAssign, setLabelDraftAssign] = useState<Set<string>>(new Set());
  const [labelDraftRemove, setLabelDraftRemove] = useState<Set<string>>(new Set());
  const [labelDraftRenames, setLabelDraftRenames] = useState<Map<string, string>>(new Map());

  // Stage 6.5: assignee changes are draft-only too. Add set is keyed by
  // teamMemberId (what the assign API takes). Remove set is keyed by
  // assignmentId (the existing junction record id needed for delete).
  const [assigneeDraftAdd, setAssigneeDraftAdd] = useState<Set<string>>(new Set());
  const [assigneeDraftRemove, setAssigneeDraftRemove] = useState<Set<string>>(new Set());

  // Stage 6.5: checklist drafts. Adds carry the full payload (name + order)
  // because there's no server id yet — we generate a tempId for the React
  // key. Removes are keyed by checklistId (existing item). Toggles are keyed
  // by checklistId, value = the desired completed state.
  const [checklistDraftAdd, setChecklistDraftAdd] = useState<Array<{ tempId: string; name: string; completed: boolean; dueDate?: string | null }>>([]);
  const [checklistDraftRemove, setChecklistDraftRemove] = useState<Set<string>>(new Set());
  const [checklistDraftToggle, setChecklistDraftToggle] = useState<Map<string, boolean>>(new Map());
  // Jira-style checklist (custom source only): due-date edits + drag reorder.
  // dueDate: server item id -> YYYY-MM-DD | null (null clears). Pending adds carry
  // their own dueDate on the draftAdd entry. order: draft display order of ids.
  const [checklistDraftDueDate, setChecklistDraftDueDate] = useState<Map<string, string | null>>(new Map());
  const [checklistOrder, setChecklistOrder] = useState<string[] | null>(null);
  const [clDragId, setClDragId] = useState<string | null>(null);
  const [clDragOverId, setClDragOverId] = useState<string | null>(null);
  // New Resource Model: per-assignee contributed hours drafts.
  // Keyed by assignmentId (server rows) or 'pending-<teamMemberId>' (draft adds).
  const [assigneeHoursDraft, setAssigneeHoursDraft] = useState<Map<string, string>>(new Map());
  const updateAssignmentHours = useUpdateAssignmentHours(projectId);
  const checklistSourceIsCustom = useTaskSource() !== 'pss';
  // Confirm dialog when a checklist due date falls outside the task window.
  // The out-of-window value is ALREADY staged (applied silently on change) by
  // the time this prompt appears — it fires on blur, not on every change — so
  // Cancel reverts to `revertYmd` (the value captured when the input was
  // focused) and "Set anyway" is a no-op keep.
  const [dueWarn, setDueWarn] = useState<{ itemId: string; isDraftAdd: boolean; ymd: string; kind: 'before-start' | 'after-due'; revertYmd: string | null } | null>(null);
  // Per-item baseline captured on focus, so a cancelled out-of-window edit can
  // roll the staged draft back to what it was before the user opened the picker.
  const dueEditBaselineRef = useRef<Map<string, string | null>>(new Map());

  // Fix 2026-07-16: TaskCompletionCheckbox 'draft' mode -- clicking the
  // circle inside the panel sets this draft instead of firing mutations
  // immediately. Save Changes commits it as a normal SubmitStep so the
  // panel closes (onClose runs before startSubmit) and the tile on the
  // board carries the spinner state until success/failure. null means
  // user hasn't touched the checkbox this session.
  const [completionDraft, setCompletionDraft] = useState<boolean | null>(null);

  // Sprint hooks
  const { data: sprints = [] } = useProjectSprints(projectId);
  const setSprintMutation = useSetTaskSprint(projectId);

  // Stage 4: subscribe to per-task save queue for header spinner + per-field dots.
  const queueState = useTaskQueueState(task?.msdyn_projecttaskid);
  const savingFields = new Set(queueState.fields);

  // Stage 6: routing + global submit-progress for Submit/Discard + auto-nav return.
  const navigate = useNavigate();
  const location = useLocation();
  const submitProgress = useSubmitProgress();
  const isSubmitting = submitProgress.active?.status === 'running' && submitProgress.active.taskId === task?.msdyn_projecttaskid;
  // Stage 6.4: 'active' = this task's batch is running, 'queued' = waiting in line.
  // Either state means the panel must be locked (no edits while a save is pending).
  const taskSubmitState = useTaskSubmitState(task?.msdyn_projecttaskid);
  const pipelineLockedRaw = taskSubmitState !== 'idle';
  // Treat read-only (!canEdit) as a panel-wide lock so every existing
  // `disabled={pipelineLocked}` predicate downstream also disables inputs
  // when the user lacks edit permission. Saves one prop drill across ~30
  // form controls in this file.
  const pipelineLocked = pipelineLockedRaw || !canEdit;
  // Inline error pinned to specific field keys after a failed Submit auto-nav.
  const [inlineError, setInlineError] = useState<{ fields: readonly string[]; message: string } | null>(null);

  const showError = useCallback((msg: string) => {
    setPanelError(msg);
    onError(msg);
    setTimeout(() => setPanelError(null), 15000);
  }, [onError]);

  const commitChecklistItem = useCallback(() => {
    // Stage 6.5: push into the add-draft array instead of firing immediately.
    // The actual create runs as a SubmitStep on Submit.
    const text = newChecklistText.trim();
    if (!text || !taskIdForChecklist) return;
    setNewChecklistText('');
    setChecklistDraftAdd((prev) => [
      ...prev,
      { tempId: `cl-draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: text, completed: false },
    ]);
  }, [newChecklistText, taskIdForChecklist]);

  // Stage 6: drafts are local. They reset on task switch only — not on every
  // task field change from the cache. This is what makes "type 8 things, hit
  // Submit" work without a slider snap-back race.
  // On task switch we also re-hydrate from any persisted drafts pinned by
  // submitProgressStore (after a failed Submit auto-navigated us back).
  useEffect(() => {
    if (!task) return;
    const persisted = getPersistedDrafts(task.msdyn_projecttaskid);
    if (persisted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubjectDraft(persisted.subject ?? task.msdyn_subject);
      setDescDraft(persisted.description ?? task.msdyn_description ?? '');
      {
        const eff = task.pmo_taskeffort ?? task.msdyn_effort;
        const done = task.pmo_taskhoursdone ?? task.msdyn_effortcompleted;
        setEffortDraft(persisted.effort !== undefined ? String(persisted.effort) : (eff !== undefined ? String(eff) : ''));
        setHoursDoneDraft(
          persisted.effortCompleted !== undefined ? String(persisted.effortCompleted)
          : (done !== undefined ? String(done) : '')
        );
      }
      setMilestoneDraft(persisted.isMilestone ?? task.msdyn_ismilestone ?? false);
      setPriorityDraft(persisted.priority ?? task.msdyn_priority ?? 5);
      setStartDraft(persisted.scheduledStart ?? task.msdyn_scheduledstart ?? '');
      setEndDraft(persisted.scheduledEnd ?? task.msdyn_scheduledend ?? task.msdyn_finish ?? '');
      setCompletionDraft(null);
    } else {
      setSubjectDraft(task.msdyn_subject);
      setDescDraft(task.msdyn_description ?? '');
      {
        const eff = task.pmo_taskeffort ?? task.msdyn_effort;
        const done = task.pmo_taskhoursdone ?? task.msdyn_effortcompleted;
        setEffortDraft(eff !== undefined ? String(eff) : '');
        setHoursDoneDraft(done !== undefined ? String(done) : '');
      }
      setMilestoneDraft(task.msdyn_ismilestone ?? false);
      setPriorityDraft(task.msdyn_priority ?? 5);
      setStartDraft(task.msdyn_scheduledstart ?? '');
      setEndDraft((task.msdyn_scheduledend ?? task.msdyn_finish) ?? '');
      setCompletionDraft(null);
    }
    // Surface any pending inline highlight from a failed Submit — once.
    const hl = consumePendingHighlight(task.msdyn_projecttaskid);
    if (hl) setInlineError(hl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.msdyn_projecttaskid]);


  if (!task) return null;

  // Capture non-null for use in async closures (TypeScript doesn't narrow props inside closures).
  const t = task;

  // Treat any task whose staging Create row is still Pending / InFlight
  // (t._saving === true, set by stagingOverlay for synthetic-Create rows)
  // as "optimistic" for the purposes of gating downstream write UI.
  // Without this, users could click Complete, edit effort, or post notes
  // on a task whose server-side row doesn't exist yet — producing the
  // "Invalid entity msdyn_projecttask" and "Entity … Does Not Exist"
  // errors Tracey hit on 2026-07-20. Existing `optimistic-` prefix path
  // (task create via direct-PSS legacy fallback) is kept for parity.
  const isOptimistic = t.msdyn_projecttaskid.startsWith('optimistic-') || t._saving === true;
  // Stage 6.5: apply assignee drafts on top of server state for an optimistic preview.
  const visibleAssignees = assignees.filter((a) => !assigneeDraftRemove.has(a.assignmentId));
  const draftedAddedAsAssignees: TaskAssignee[] = Array.from(assigneeDraftAdd).flatMap((id) => {
    const m = teamMembers.find((tm) => tm.id === id);
    return m ? [{ assignmentId: `pending-${id}`, taskId: task?.msdyn_projecttaskid ?? '', teamMemberId: id, name: m.name }] : [];
  });
  const effectiveAssignees = [...visibleAssignees, ...draftedAddedAsAssignees];
  const effectiveAssignedTeamIds = new Set(effectiveAssignees.map((a) => a.teamMemberId));
  const unassignedMembers = teamMembers.filter((m) => !effectiveAssignedTeamIds.has(m.id));

  // ---- Stage 6: drafts only — nothing fires until Submit. ------------------
  // The commit* helpers below are draft setters now. The previous fire-and-forget
  // model caused a slider-snap-back race when the user changed progress and then
  // changed another field, because each field's mutation re-rendered the panel
  // before the progress flight had landed. Submit batches everything into one
  // ScheduleTaskUpdate that goes through the per-task queue (Stage 3).

  const effortDraftNum = effortDraft === '' ? undefined : parseFloat(effortDraft);
  const effortInvalid = effortDraft !== '' && (isNaN(effortDraftNum!) || effortDraftNum! < 0);

  function commitPriority(next: number) { setPriorityDraft(next); }
  function commitStartDate(iso: string)   { setStartDraft(iso); }
  function commitEndDate(iso: string)     { setEndDraft(iso); }
  // Title/description/effort drafts are already updated onChange. These onBlur
  // stubs keep the existing JSX bindings working without firing PSS.
  function commitSubject() { /* draft already updated onChange */ }
  function commitEffort()  { /* draft already updated onChange */ }

  // ---- Dirty check + Submit / Discard ----------------------------------------
  // Hours done parsed once with the same '> 0 or empty' validation as effort.
  const hoursDoneDraftNum = hoursDoneDraft === '' ? undefined : parseFloat(hoursDoneDraft);
  const hoursDoneInvalid = hoursDoneDraft !== '' && (isNaN(hoursDoneDraftNum!) || hoursDoneDraftNum! < 0);
  // Hours done can't exceed effort (PSS would clamp anyway, but inline beats round-trip).
  // Effort + hours-done are now CVS-owned columns (pmo_taskeffort +
  // pmo_taskhoursdone). Fall back to msdyn_effort / msdyn_effortcompleted
  // for pre-migration rows via the helpers.
  const currentEffort = getTaskEffort(t);
  const currentHoursDone = getTaskHoursDone(t);
  const effortForCheck = effortDraftNum ?? currentEffort ?? 0;
  const hoursDoneTooHigh = hoursDoneDraftNum !== undefined && hoursDoneDraftNum > effortForCheck;
  // Note: previously blocked Submit when the user zeroed effort while
  // Hours done was still > 0 -- that was a PSS constraint. Custom columns
  // have no such restriction; the two values are independent decimals.
  // We just let the user do it. Reports read both fields directly.

  // ---- New Resource Model computed values ------------------------------------
  // Hours Done = Σ contributed hours across all effective assignees (read-only
  // under the new model; replaces the manual hoursDoneDraft for display).
  const newModelHoursDone = useNewResourceModel
    ? effectiveAssignees.reduce((sum, a) => {
        const draftStr = assigneeHoursDraft.get(a.assignmentId);
        const draftVal = draftStr !== undefined ? parseFloat(draftStr) : NaN;
        const val = !isNaN(draftVal) ? draftVal : (a.contributedHours ?? 0);
        return sum + val;
      }, 0)
    : 0;
  // Guardrail: Σ assignee hours > effort -> block save.
  // Over-guard: fires when assignee hours exceed effort, OR when effort is 0/null
  // but hours are > 0 (null effort is treated as 0 — user must set effort >= hours).
  const newModelOverGuard = useNewResourceModel && newModelHoursDone > effortForCheck;
  const [completionGuardError, setCompletionGuardError] = useState<{ message: string } | null>(null);
  // NRM save-time prompt: Σ assignee hours exceed Effort. Effort is NEVER
  // auto-bumped while editing; the user resolves the mismatch only here, on
  // Save, by choosing to bump Effort up to the assignee-hours total or to go
  // back and adjust the assignee hours instead.
  const [hoursExceedPrompt, setHoursExceedPrompt] = useState<{ total: number; effort: number } | null>(null);
  // Per-person capacity hint: total contributed hours per assignee across ALL
  // tasks on this project (using allProjectAssignees if supplied).
  const projectHoursByMemberId = useNewResourceModel && allProjectAssignees
    ? allProjectAssignees.reduce((map, a) => {
        if (!a.teamMemberId) return map;
        map.set(a.teamMemberId, (map.get(a.teamMemberId) ?? 0) + (a.contributedHours ?? 0));
        return map;
      }, new Map<string, number>())
    : null;
  // Whether any assigneeHoursDraft entry differs from the server value.
  const assigneeHoursDirty = useNewResourceModel && assigneeHoursDraft.size > 0 &&
    Array.from(assigneeHoursDraft.entries()).some(([asgId, str]) => {
      const num = str === '' ? undefined : parseFloat(str);
      const server = effectiveAssignees.find((a) => a.assignmentId === asgId)?.contributedHours;
      return num !== server;
    });
  const isDirty = (
    subjectDraft.trim() !== (t.msdyn_subject ?? '').trim() ||
    descDraft.trim() !== (t.msdyn_description ?? '').trim() ||
    effortDraftNum !== currentEffort ||
    hoursDoneDraftNum !== currentHoursDone ||
    priorityDraft !== (t.msdyn_priority ?? 5) ||
    !sameDay(startDraft || undefined, t.msdyn_scheduledstart) ||
    !sameDay(endDraft || undefined, t.msdyn_scheduledend ?? t.msdyn_finish) ||
    labelDraftAssign.size > 0 ||
    labelDraftRemove.size > 0 ||
    labelDraftRenames.size > 0 ||
    assigneeDraftAdd.size > 0 ||
    assigneeDraftRemove.size > 0 ||
    checklistDraftAdd.length > 0 ||
    checklistDraftRemove.size > 0 ||
    checklistDraftToggle.size > 0 ||
    checklistDraftDueDate.size > 0 ||
    checklistOrder !== null ||
    completionDraft !== null ||
    assigneeHoursDirty
  );

  function buildDraftSnapshot(): TaskDraftSnapshot {
    return {
      subject: subjectDraft,
      description: descDraft,
      priority: priorityDraft,
      isMilestone: milestoneDraft,
      scheduledStart: startDraft || undefined,
      scheduledEnd: endDraft || undefined,
      effort: effortDraftNum,
      effortCompleted: hoursDoneDraftNum,
    };
  }

  /**
   * Build the PSS scheduling patch. Effort + effortCompleted are NO LONGER
   * included here -- those live in CVS-owned pmo_taskeffort / pmo_taskhoursdone
   * columns and are written via useUpdateTaskCustomFields (direct OData PATCH).
   * That decouples the scheduling triangle: dates never fight with effort.
   */
  function buildPatch(): { patch: Omit<ScheduleTaskUpdate, 'taskId'>; fields: string[] } {
    const patch: Omit<ScheduleTaskUpdate, 'taskId'> = {};
    const fields: string[] = [];
    const trimmedSubject = subjectDraft.trim();
    if (trimmedSubject && trimmedSubject !== t.msdyn_subject) { patch.subject = trimmedSubject; fields.push('subject'); }
    const trimmedDesc = descDraft.trim();
    if (trimmedDesc !== (t.msdyn_description ?? '').trim()) { patch.description = trimmedDesc; fields.push('description'); }
    if (priorityDraft !== (t.msdyn_priority ?? 5)) { patch.priority = priorityDraft; fields.push('priority'); }
    // Summary tasks own dates via PSS rollup. Skip.
    if (!t.msdyn_summary) {
      if (!sameDay(startDraft || undefined, t.msdyn_scheduledstart)) { patch.scheduledStart = startDraft || undefined; fields.push('scheduledStart'); }
      if (!sameDay(endDraft || undefined, t.msdyn_scheduledend ?? t.msdyn_finish)) { patch.scheduledEnd = endDraft || undefined; fields.push('scheduledEnd'); }
    }
    // When dates change, include duration so PSS knows the intended window
    // (staging plugin will inject one if missing, but including it here is
    // belt-and-suspenders for the direct-PSS path).
    if (patch.scheduledStart !== undefined || patch.scheduledEnd !== undefined) {
      const startIso = patch.scheduledStart ?? (startDraft || t.msdyn_scheduledstart);
      const endIso   = patch.scheduledEnd   ?? (endDraft   || t.msdyn_scheduledend || t.msdyn_finish);
      if (startIso && endIso) {
        const sd = new Date(startIso);
        const ed = new Date(endIso);
        if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed.getTime() >= sd.getTime()) {
          let workDays = 0;
          const cursor = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate(), 12));
          const stop   = new Date(Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth(), ed.getUTCDate(), 12));
          while (cursor.getTime() <= stop.getTime()) {
            const dow = cursor.getUTCDay();
            if (dow !== 0 && dow !== 6) workDays += 1;
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }
          const newDuration = Math.max(workDays, 1) * 8;
          if (newDuration !== t.msdyn_duration) {
            patch.duration = newDuration;
            if (!fields.includes('duration')) fields.push('duration');
          }
        }
      }

      // Pin both endpoints so PSS has zero degrees of freedom on the window.
      if (patch.scheduledStart === undefined) patch.scheduledStart = startDraft || t.msdyn_scheduledstart;
      if (patch.scheduledEnd   === undefined) patch.scheduledEnd   = endDraft   || t.msdyn_scheduledend || t.msdyn_finish;
      for (const f of ['scheduledStart','scheduledEnd']) if (!fields.includes(f)) fields.push(f);
    }
    return { patch, fields };
  }

  /**
   * Build the CVS-owned effort patch (pmo_taskeffort + pmo_taskhoursdone).
   * Direct OData PATCH -- no PSS involvement, no triangle constraints.
   */
  function buildCustomFieldsPatch(effortOverride?: number): {
    patch: { pmo_taskeffort?: number | null; pmo_taskhoursdone?: number | null };
    fields: string[];
  } {
    const patch: { pmo_taskeffort?: number | null; pmo_taskhoursdone?: number | null } = {};
    const fields: string[] = [];
    if (t.msdyn_summary) return { patch, fields };
    // effortOverride is supplied only when the user chose "Bump Effort" from the
    // save-time hoursExceedPrompt; it forces Effort up to the assignee-hours total.
    const effectiveEffort = effortOverride !== undefined ? effortOverride : effortDraftNum;
    if (!effortInvalid && effectiveEffort !== currentEffort) {
      patch.pmo_taskeffort = effectiveEffort === undefined ? null : effectiveEffort;
      fields.push('effort');
    }
    if (!hoursDoneInvalid && hoursDoneDraftNum !== currentHoursDone) {
      patch.pmo_taskhoursdone = hoursDoneDraftNum === undefined ? null : hoursDoneDraftNum;
      fields.push('effortCompleted');
    }
    return { patch, fields };
  }

  function resetDrafts() {
    setSubjectDraft(t.msdyn_subject);
    setDescDraft(t.msdyn_description ?? '');
    {
      const eff = t.pmo_taskeffort ?? t.msdyn_effort;
      const done = t.pmo_taskhoursdone ?? t.msdyn_effortcompleted;
      setEffortDraft(eff !== undefined ? String(eff) : '');
      setHoursDoneDraft(done !== undefined ? String(done) : '');
    }
    setMilestoneDraft(t.msdyn_ismilestone ?? false);
    setPriorityDraft(t.msdyn_priority ?? 5);
    setStartDraft(t.msdyn_scheduledstart ?? '');
    setEndDraft((t.msdyn_scheduledend ?? t.msdyn_finish) ?? '');
    setInlineError(null);
    setLabelDraftAssign(new Set());
    setLabelDraftRemove(new Set());
    setLabelDraftRenames(new Map());
    setAssigneeDraftAdd(new Set());
    setAssigneeDraftRemove(new Set());
    setChecklistDraftAdd([]);
    setChecklistDraftRemove(new Set());
    setChecklistDraftToggle(new Map());
    setChecklistDraftDueDate(new Map());
    setChecklistOrder(null);
    setCompletionDraft(null);
    setAssigneeHoursDraft(new Map());
    clearPersistedDrafts(t.msdyn_projecttaskid);
  }

  async function handleSubmit() {
    if (isOptimistic || !isDirty || effortInvalid || hoursDoneInvalid || hoursDoneTooHigh) return;
    // NRM over-guard (Save Changes path): Σ assignee hours exceed Effort. Rather
    // than silently blocking Save (or auto-bumping Effort while the user typed),
    // prompt them with an explicit choice — bump Effort up to the total, or go
    // back and adjust the assignee hours. proceedSubmit runs the actual save.
    if (newModelOverGuard) {
      setHoursExceedPrompt({ total: newModelHoursDone, effort: effortForCheck });
      return;
    }
    await proceedSubmit();
  }

  // Runs the completion guard + builds/dispatches the save. effortOverride is
  // passed only when the user chose "Bump Effort" from the hoursExceedPrompt.
  async function proceedSubmit(effortOverride?: number) {
    // NRM completion guard (Save Changes path). Uses the DRAFT-AWARE computed values
    // (effortForCheck already combines effortDraft ?? serverEffort ?? 0;
    //  newModelHoursDone already sums assigneeHoursDraft ?? server contributedHours)
    // so the check reflects what will actually be written, not stale server state.
    // This is the ONLY enforcement point for draft-mode completion — the circle click
    // no longer runs this guard (it would read stale server data mid-edit).
    if (completionDraft === true && useNewResourceModel) {
      const draftEffort = effortOverride ?? effortForCheck;
      const draftAssigneeHours = newModelHoursDone;
      const draftAssigneeCount = effectiveAssignees.length;
      if (draftEffort <= 0) {
        setCompletionGuardError({ message: 'This task has no Effort set. Set an Effort value before marking it complete.' });
        return;
      }
      if (draftAssigneeCount === 0) {
        setCompletionGuardError({ message: `This task has no one assigned. Assign at least one person and log hours totaling ${draftEffort}h before marking it complete.` });
        return;
      }
      if (draftAssigneeHours !== draftEffort) {
        setCompletionGuardError({ message: `Assignee hours (${draftAssigneeHours}h) don't add up to this task's Effort (${draftEffort}h). Adjust assignee hours so they total exactly ${draftEffort}h before marking it complete.` });
        return;
      }
    }
    const built = buildPatch();
    const customFields = buildCustomFieldsPatch(effortOverride);
    setInlineError(null);

    // Bail out only if NOTHING is being submitted (no PSS fields, no custom
    // fields, no relationship changes). Effort + hoursDone now count via the
    // customFields.fields list.
    const hasRelationshipChanges =
      labelDraftAssign.size > 0 || labelDraftRemove.size > 0 || labelDraftRenames.size > 0 ||
      assigneeDraftAdd.size > 0 || assigneeDraftRemove.size > 0 ||
      checklistDraftAdd.length > 0 || checklistDraftRemove.size > 0 || checklistDraftToggle.size > 0 ||
      checklistDraftDueDate.size > 0 || checklistOrder !== null ||
      // Completion checkbox draft counts as a change here -- runSubmit
      // builds its own SubmitStep for it. Without this condition,
      // clicking ONLY the completion circle and hitting Save Changes
      // falls through to onClose() below and silently does nothing
      // (operator report 2026-07-17).
      completionDraft !== null ||
      // New Resource Model: per-assignee hours changes.
      assigneeHoursDirty;
    if (built.fields.length === 0 && customFields.fields.length === 0 && !hasRelationshipChanges) {
      onClose();
      return;
    }
    await runSubmit(built.patch, built.fields, customFields.patch, customFields.fields);
  }

  // Extracted from handleSubmit. Now takes both the PSS scheduling patch
  // AND the CVS-owned custom-fields patch (pmo_taskeffort / pmo_taskhoursdone).
  async function runSubmit(
    patch: Omit<ScheduleTaskUpdate, 'taskId'>,
    fields: string[],
    customFieldsPatch: { pmo_taskeffort?: number | null; pmo_taskhoursdone?: number | null } = {},
    customFieldsFields: string[] = [],
  ) {

    // Build label steps from the three label drafts. Each step labels itself
    // with the label name so the SubmitProgressBar reads e.g. "Adding label P0".
    const labelNameById = new Map(projectLabels.map((l) => [
      l.msdyn_projectlabelid,
      l.msdyn_projectlabeltext || `Label`,
    ]));
    const labelSteps: SubmitStep[] = [];
    // Removes need the junction id, not the label id.
    const taskJunctionsByLabel = new Map<string, string>();
    for (const tl of allTaskLabels) {
      if (tl['_msdyn_projecttaskid_value'] === t.msdyn_projecttaskid) {
        taskJunctionsByLabel.set(tl['_msdyn_projectlabelid_value'] as string, tl.msdyn_projecttasktolabelid as string);
      }
    }
    let stepCounter = 0;
    labelDraftRemove.forEach((labelId) => {
      const junctionId = taskJunctionsByLabel.get(labelId);
      if (!junctionId) return;
      const name = labelNameById.get(labelId) ?? 'label';
      labelSteps.push({
        id: `label-remove-${stepCounter++}`,
        label: `Removing label "${name}"`,
        fields: [],
        run: () => removeLabel.mutateAsync(junctionId),
      });
    });
    labelDraftAssign.forEach((labelId) => {
      const name = labelNameById.get(labelId) ?? 'label';
      labelSteps.push({
        id: `label-assign-${stepCounter++}`,
        label: `Adding label "${name}"`,
        fields: [],
        run: () => assignLabel.mutateAsync({ taskId: t.msdyn_projecttaskid, labelId }),
      });
    });
    labelDraftRenames.forEach((newName, labelId) => {
      labelSteps.push({
        id: `label-rename-${stepCounter++}`,
        label: `Renaming label to "${newName}"`,
        fields: [],
        run: () => renameLabel.mutateAsync({ labelId, name: newName }),
      });
    });

    // Stage 6.5: assignee steps. Removes go first (in case the user is doing
    // a swap — dropping then re-adding the same person), then adds.
    const teamMemberNameById = new Map(teamMembers.map((m) => [m.id, m.name]));
    const assigneeNameByAssignmentId = new Map(assignees.map((a) => [a.assignmentId, a.name]));
    const assigneeSteps: SubmitStep[] = [];
    let aStepCounter = 0;
    // New Resource Model: read any hours the user typed next to a just-added (not-yet-persisted) assignee. Keyed 'pending-<teamMemberId>' until the server row exists. Returned so the create call stamps it on the first Save.
    const pendingAddInitialHours = (teamMemberId: string): number | undefined => {
      if (!useNewResourceModel) return undefined;
      const draftStr = assigneeHoursDraft.get(`pending-${teamMemberId}`);
      if (draftStr === undefined || draftStr === '') return undefined;
      const parsed = parseFloat(draftStr);
      return !isNaN(parsed) && parsed >= 0 ? parsed : undefined;
    };
    assigneeDraftRemove.forEach((assignmentId) => {
      const name = assigneeNameByAssignmentId.get(assignmentId) ?? 'team member';
      assigneeSteps.push({
        id: `assignee-remove-${aStepCounter++}`,
        label: `Removing ${name}`,
        fields: [],
        run: () => onUnassign(t.msdyn_projecttaskid, assignmentId),
      });
    });
    assigneeDraftAdd.forEach((teamMemberId) => {
      const name = teamMemberNameById.get(teamMemberId) ?? 'team member';
      assigneeSteps.push({
        id: `assignee-add-${aStepCounter++}`,
        label: `Adding ${name}`,
        fields: [],
        run: () => onAssign(t.msdyn_projecttaskid, teamMemberId, pendingAddInitialHours(teamMemberId)),
      });
    });
    // New Resource Model: contributed-hours updates for existing server assignments.
    if (useNewResourceModel) {
      assigneeHoursDraft.forEach((str, assignmentId) => {
        if (assignmentId.startsWith('pending-')) return; // draft-add — no server row yet
        const hours = str === '' ? null : parseFloat(str);
        const server = effectiveAssignees.find((a) => a.assignmentId === assignmentId)?.contributedHours;
        const hoursNum = typeof hours === 'number' && !isNaN(hours) ? hours : null;
        if (hoursNum === (server ?? null)) return; // unchanged
        const name = effectiveAssignees.find((a) => a.assignmentId === assignmentId)?.name ?? 'assignee';
        assigneeSteps.push({
          id: `assignee-hours-${aStepCounter++}`,
          label: `Updating hours for ${name}`,
          fields: [],
          run: () => updateAssignmentHours.mutateAsync({ assignmentId, hours: hoursNum }),
        });
      });
    }

    // Stage 6.5: checklist steps. Removes first, then toggles, then adds.
    const checklistSteps: SubmitStep[] = [];
    let cStepCounter = 0;
    const checklistNameById = new Map(checklists.map((c) => [c.msdyn_projectchecklistid, c.msdyn_name ?? 'item']));
    checklistDraftRemove.forEach((checklistId) => {
      const name = checklistNameById.get(checklistId) ?? 'item';
      checklistSteps.push({
        id: `checklist-remove-${cStepCounter++}`,
        label: `Removing checklist item "${name}"`,
        fields: [],
        run: () => deleteChecklist.mutateAsync(checklistId),
      });
    });
    checklistDraftToggle.forEach((completed, checklistId) => {
      const name = checklistNameById.get(checklistId) ?? 'item';
      checklistSteps.push({
        id: `checklist-toggle-${cStepCounter++}`,
        label: `${completed ? 'Checking' : 'Unchecking'} "${name}"`,
        fields: [],
        run: () => updateChecklist.mutateAsync({ projectId, checklistId, completed }),
      });
    });
    // Adds need a stable order; baseline = the highest server order, then +1 per add.
    const baseOrder = (checklists[checklists.length - 1]?.msdyn_projectchecklistorder ?? 0);
    checklistDraftAdd.forEach((draft, i) => {
      const order = baseOrder + i + 1;
      checklistSteps.push({
        id: `checklist-add-${cStepCounter++}`,
        label: `Adding checklist item "${draft.name}"`,
        fields: [],
        run: () => createChecklist.mutateAsync({
          projectId,
          taskId: t.msdyn_projecttaskid,
          name: draft.name,
          order,
          completed: draft.completed,
          dueDate: draft.dueDate ?? null,
        }),
      });
    });

    // Jira-style (custom source): due-date edits on existing items.
    checklistDraftDueDate.forEach((dueDate, checklistId) => {
      if (checklistDraftRemove.has(checklistId)) return;
      const name = checklistNameById.get(checklistId) ?? 'item';
      checklistSteps.push({
        id: `checklist-duedate-${cStepCounter++}`,
        label: dueDate ? `Setting due date on "${name}"` : `Clearing due date on "${name}"`,
        fields: [],
        run: () => updateChecklist.mutateAsync({ projectId, checklistId, dueDate }),
      });
    });

    // Jira-style (custom source): persist a drag-reordered list. Only items
    // whose position changed vs the server order are written.
    if (checklistSourceIsCustom && checklistOrder) {
      const serverOrderIds = checklists
        .slice()
        .sort((a, b) => (a.msdyn_projectchecklistorder ?? 0) - (b.msdyn_projectchecklistorder ?? 0))
        .map((c) => c.msdyn_projectchecklistid);
      const targetIds = checklistOrder.filter(
        (id) => serverOrderIds.includes(id) && !checklistDraftRemove.has(id),
      );
      const remainingServer = serverOrderIds.filter((id) => !checklistDraftRemove.has(id));
      const changed = targetIds.length !== remainingServer.length
        || targetIds.some((id, i) => remainingServer[i] !== id);
      if (changed && targetIds.length > 0) {
        const items = targetIds.map((id, i) => ({ id, order: i + 1 }));
        checklistSteps.push({
          id: `checklist-reorder-${cStepCounter++}`,
          label: 'Reordering checklist',
          fields: [],
          run: () => reorderChecklist.mutateAsync(items),
        });
      }
    }

    // 2026-07-17: the panel's completion step is now a NO-OP for effort
    // and hoursdone writes. When the user clicks the checkbox we
    // pre-fill the effortDraft + hoursDoneDraft inputs from either the
    // seeded 100% values (mark complete) or the popped snapshot
    // (reopen); the normal custom-fields step handles the actual write
    // via those drafts. If the user typed different numbers before
    // hitting Save Changes, their values live in the drafts and win.
    // The completion step is retained only so we still emit the audit
    // entry via runSubmit's ONE-batched onAuditBatch path below.
    //
    // NB: the tile-checkbox (commit-mode, board views) still fires PSS
    // + custom-fields writes directly via TaskCompletionCheckbox --
    // this bail-out only affects the detail-panel flow.
    // FIX: this step MUST write the progress signal deriveTaskStatus reads.
    // For a task with NO effort estimate, getDisplayProgressPct falls back to
    // msdyn_progress / pmo_progress, so completing via the custom-fields
    // (effort/hours) drafts alone never flips it to Done -- this is why "Done"
    // saved from the tile circle but not from Task Details (operator report,
    // TASK-10206, blank effort). Mirror buildCompletePayload().pss.progress:
    //   complete -> 100; reopen -> restored hours/effort ratio (draft
    //   precedence -- the snapshot value seeded into hoursDoneDraft on the
    //   reopen click wins unless the user then edited Hours done), else 0.
    const completionSteps: SubmitStep[] = [];
    if (completionDraft !== null) {
      const completionProgress = completionDraft
        ? 100
        : (effortDraftNum !== undefined && effortDraftNum > 0 && hoursDoneDraftNum !== undefined
            ? Math.min(100, (hoursDoneDraftNum / effortDraftNum) * 100)
            : 0);
      completionSteps.push({
        id: completionDraft ? 'completion-complete' : 'completion-reopen',
        label: completionDraft ? 'Marking task complete' : 'Reopening task',
        fields: [],
        run: () => onUpdate({ taskId: t.msdyn_projecttaskid, progress: completionProgress }),
      });
    }

    // Bail out only if NOTHING is being submitted (PSS fields, custom fields,
    // labels, assignees, checklists, completion all zero).
    if (
      fields.length === 0 &&
      customFieldsFields.length === 0 &&
      labelSteps.length === 0 &&
      assigneeSteps.length === 0 &&
      checklistSteps.length === 0 &&
      completionSteps.length === 0
    ) return;

    const returnTo = `${location.pathname}${location.search}`;
    // Close the panel immediately — the header SubmitProgressBar keeps the
    // user informed wherever they navigate. On failure the SubmitFailureRouter
    // re-opens this panel via URL change so the inline error + persisted drafts
    // re-hydrate as the panel re-mounts.
    onClose();
    const status = await startSubmit({
      projectId,
      taskId: t.msdyn_projecttaskid,
      taskSubject: t.msdyn_subject,
      returnTo,
      draftSnapshot: buildDraftSnapshot(),
      steps: [
        // Custom-fields step (pmo_taskeffort + pmo_taskhoursdone). Direct
        // OData PATCH -- runs first because it is fast + independent of PSS.
        ...(customFieldsFields.length > 0 ? [{
          id: 'custom-fields',
          label: `Saving ${customFieldsFields.length} effort field${customFieldsFields.length === 1 ? '' : 's'}`,
          fields: customFieldsFields,
          run: () => updateCustomFields.mutateAsync({ taskId: t.msdyn_projecttaskid, patch: customFieldsPatch }),
        }] : []),
        // PSS field step — only included when there's something to send.
        ...(fields.length > 0 ? [{
          id: 'fields',
          label: `Saving ${fields.length} change${fields.length === 1 ? '' : 's'}`,
          fields,
          run: () => onUpdate({ taskId: t.msdyn_projecttaskid, ...patch }),
        }] : []),
        // Label steps — one per assign / remove / rename.
        ...labelSteps,
        // Assignee steps — one per add / remove.
        ...assigneeSteps,
        // Completion toggle -- runs before checklist so the tile
        // visually flips first, matching operator's expectation that
        // clicking Save Changes shows the completed state on the board
        // right away.
        ...completionSteps,
        // Checklist steps — one per remove / toggle / add.
        ...checklistSteps,
      ],
    });
    // Done handling: returnTo nav is unnecessary here because we already
    // closed the panel without leaving the user's current route. On failure
    // the failure router auto-navs back to the task panel; on its eventual
    // success the next handleSubmit call (after the user fixes the field)
    // will route them back via submitProgress.active?.returnTo.
    if (status === 'done') {
      // Wave 1 batched audit: emit ONE row per panel Submit covering
      // relationship changes (field changes are emitted by the parent's
      // auto-audit on the same mutation — unless the parent provided a
      // no-audit mutator and onAuditBatch, in which case the parent is
      // delegating the entire row build to us).
      if (onAuditBatch) {
        const entries: import('../../hooks/useChangeAudit').ChangeAuditEntry[] = [];
        // Field changes — derive from the patch we just sent. Translate
        // domain keys (subject, scheduledStart, effort, etc.) back to the
        // Dataverse column names that TASK_FIELD_LABELS expects.
        if (fields.length > 0) {
          const after: Record<string, unknown> = {};
          if (patch.subject !== undefined)         after.msdyn_subject = patch.subject;
          if (patch.description !== undefined)     after.msdyn_description = patch.description;
          if (patch.scheduledStart !== undefined)  after.msdyn_scheduledstart = patch.scheduledStart;
          if (patch.scheduledEnd !== undefined)    after.msdyn_scheduledend = patch.scheduledEnd;
          if (patch.duration !== undefined)        after.msdyn_duration = patch.duration;
          if (patch.effort !== undefined)          after.msdyn_effort = patch.effort;
          if (patch.effortCompleted !== undefined) after.msdyn_effortcompleted = patch.effortCompleted;
          if (patch.priority !== undefined)        after.msdyn_priority = patch.priority;
          if (patch.isMilestone !== undefined)     after.msdyn_ismilestone = patch.isMilestone;
          if (patch.bucketId !== undefined)        after.msdyn_projectbucket = patch.bucketId;
          const fieldDiffs = diffEntityUpdate(t as unknown as Record<string, unknown>, after, TASK_FIELD_LABELS);
          entries.push(...fieldDiffs);
        }
        // Labels.
        labelDraftRemove.forEach((labelId) => {
          const name = labelNameById.get(labelId) ?? 'label';
          entries.push({ kind: 'relationship', relation: 'label', action: 'remove', label: name });
        });
        labelDraftAssign.forEach((labelId) => {
          const name = labelNameById.get(labelId) ?? 'label';
          entries.push({ kind: 'relationship', relation: 'label', action: 'add', label: name });
        });
        labelDraftRenames.forEach((newName, labelId) => {
          const oldName = labelNameById.get(labelId) ?? 'label';
          entries.push({ kind: 'relationship', relation: 'label', action: 'update', label: newName, old: oldName, new: newName });
        });
        // Assignees.
        assigneeDraftRemove.forEach((assignmentId) => {
          const name = assigneeNameByAssignmentId.get(assignmentId) ?? 'team member';
          // audit deferred to ProjectDetailPage.handleUnassign to avoid dupes (2026-07-20)
          void name;
        });
        assigneeDraftAdd.forEach((teamMemberId) => {
          const name = teamMemberNameById.get(teamMemberId) ?? 'team member';
          // audit deferred to ProjectDetailPage.handleAssign to avoid dupes (2026-07-20)
          void name;
        });
        // Checklist.
        checklistDraftRemove.forEach((checklistId) => {
          const name = checklistNameById.get(checklistId) ?? 'item';
          entries.push({ kind: 'relationship', relation: 'checklist', action: 'remove', label: name });
        });
        checklistDraftToggle.forEach((completed, checklistId) => {
          const name = checklistNameById.get(checklistId) ?? 'item';
          entries.push({ kind: 'relationship', relation: 'checklist', action: 'update', label: name, old: !completed, new: completed });
        });
        checklistDraftAdd.forEach((draft) => {
          entries.push({ kind: 'relationship', relation: 'checklist', action: 'add', label: draft.name });
        });
        // Completion toggle: if the user flipped the completion circle
        // in this Submit, emit an audit entry alongside any other
        // batched changes so Admin > Change History shows "marked
        // complete" / "reopened" grouped with whatever else was saved.
        if (completionDraft !== null) {
          entries.push({
            kind: 'relationship',
            relation: 'completion',
            action: 'update',
            label: completionDraft ? 'marked complete' : 'reopened',
            old: !completionDraft,
            new: completionDraft,
          });
        }
        if (entries.length > 0) {
          onAuditBatch(t.msdyn_projecttaskid, t.msdyn_subject, entries);
        }
      }
      const target = submitProgress.active?.returnTo;
      if (target && target !== returnTo) navigate(target);
    }
  }

  function handleDiscard() {
    resetDrafts();
  }

  // Child counts for the confirm dialog, built from data already loaded on this
  // panel so the warning costs no extra round-trip.
  const deleteChildSummary: DeleteChildSummary[] = [];
  if (visibleAssignees.length > 0) deleteChildSummary.push({ label: 'assignee(s)', count: visibleAssignees.length });
  if (checklists.length > 0) deleteChildSummary.push({ label: 'checklist item(s)', count: checklists.length });

  // Previously a native confirm() that fired ONLY when the task had children --
  // so a normal top-level task was deleted on a single click with no warning at
  // all. Now always routed through the shared DeleteConfirmDialog.
  // requireTypedName is false: retyping a subject for a routine task delete is
  // friction out of proportion to the risk (operator decision 2026-08-04).
  async function handleConfirmDelete() {
    setSaving(true);
    try {
      await onDelete(t.msdyn_projecttaskid, hasChildren);
      onClose();
    } catch (err) {
      showError(`Failed to delete task: ${toFriendlyError(err)}`);
      setSaving(false);
      throw err; // keep the dialog open so the error stays visible
    }
  }


  return (
    <ViewDetailPanel
      open={true}
      onClose={onClose}
      // Backdrop click / Escape must not silently discard pending edits. isDirty
      // is the SAME expression that gates the Save and Discard buttons, so the
      // three can never disagree about whether there is work to lose.
      isDirty={isDirty}
      onDismissAttempt={() => setDiscardPromptOpen(true)}
      title={t.pmo_taskid ? `Task Details · ${t.pmo_taskid}` : 'Task Details'}
      subtitle={t.msdyn_summary ? 'Summary task' : undefined}
      icon={t.msdyn_ismilestone ? <Flag className="h-5 w-5 text-amber-500" /> : undefined}
      actions={(
        <>
          {(saving || queueState.inFlight || isSubmitting || pipelineLocked) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={!isDirty || isSubmitting || pipelineLocked}
            title={!canEdit ? 'Read-only — you cannot modify this task' : (isDirty ? 'Discard all changes' : 'No changes to discard')}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!isDirty || effortInvalid || hoursDoneInvalid || hoursDoneTooHigh || isOptimistic || isSubmitting || pipelineLocked}
            title={!canEdit ? 'Read-only — you cannot modify this task' : (isDirty ? 'Save your pending changes' : 'No changes to save')}
            className="h-8 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Save changes
          </Button>
        </>
      )}
    >
      <div className="space-y-5 text-sm">

        {!canEdit && (
          <div className="flex items-start gap-2 border border-border bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>You aren't assigned to this project. Ask the Primary Team to add your team in the Collaborate tab to edit tasks.</span>
          </div>
        )}

        {/* Error banner — sticky to top of scroll area so it's always visible */}
        {panelError && (
          <div className="sticky top-0 z-10 -mx-6 -mt-5 mb-2 flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="flex-1 break-words">{panelError}</span>
            <button onClick={() => setPanelError(null)} className="shrink-0 hover:opacity-70"><X className="h-3 w-3" /></button>
          </div>
        )}

        {/* Stage 6: inline error pinned after a failed Submit auto-nav. Surfaces
            exactly which fields PSS rejected so the user knows what to fix. */}
        {inlineError && (
          <div className="flex items-start gap-2 border border-rose-300 bg-rose-50 rounded-lg px-3 py-2 text-xs text-rose-900">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-600" />
            <div className="flex-1 space-y-0.5">
              <div className="font-semibold">Couldn't save your changes</div>
              <div className="opacity-80 break-words">{inlineError.message}</div>
            </div>
            <button onClick={() => setInlineError(null)} className="shrink-0 hover:opacity-70"><X className="h-3 w-3" /></button>
          </div>
        )}

        {/* Stage 6.4: lock banner. The panel is editable but everything is
            disabled while this task is in the submit pipeline (active or
            queued). Without this banner the user has no idea why their
            inputs aren't responding. */}
        {pipelineLocked && (
          <div className="flex items-center gap-2 border border-blue-300 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-900">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />
            <span className="font-semibold">
              {taskSubmitState === 'active' ? 'Saving changes…' : 'Waiting in queue…'}
            </span>
            <span className="opacity-80">
              Editing is locked until your last submit finishes.
            </span>
          </div>
        )}

        {/* Status + draft-mode complete/reopen. Clicking the checkbox
            here sets completionDraft instead of firing mutations
            immediately -- the write runs as part of Save Changes so the
            panel closes first and the tile on the board carries the
            spinner. See TaskCompletionCheckbox 'draft' mode. */}
        <div className="flex items-center gap-2">
          <TaskCompletionCheckbox
            task={t}
            projectId={projectId}
            disabled={!canEdit || pipelineLocked}
            size="md"
            mode="draft"
            draftValue={completionDraft}
            useNewResourceModel={useNewResourceModel}
            assignees={effectiveAssignees}
            onDraftChange={(next) => {
              // Snapshot + pre-fill drafts based on the transition.
              // Only fire the seed once, on the transition from null -> value.
              if (next !== null && completionDraft === null) {
                if (next === true) {
                  // Complete: freeze current server state so a later
                  // reopen can restore precisely. Effort is USER-OWNED
                  // and never overwritten by this seeding step -- if
                  // the user has effort=20/hoursdone=10 and clicks
                  // Complete, effort stays 20 and hoursdone bumps to
                  // 20 so %% complete resolves to 100. When effort is
                  // blank we leave BOTH drafts alone: the panel still
                  // marks the task done via completionDraft + the
                  // change-history entry, and the user can type
                  // hoursdone manually before Save Changes.
                  //
                  // Prior behavior clobbered effortDraft with either
                  // currEffort (no-op) or a hardcoded 1 (data loss);
                  // both produced surprise writes to pmo_taskeffort
                  // that lost the user's estimate on any task whose
                  // effort was blank at the time of completion.
                  captureCompletionSnapshot(t.msdyn_projecttaskid, t);
                  const currEffort = getTaskEffort(t);
                  if (currEffort !== undefined && currEffort > 0) {
                    setHoursDoneDraft(String(currEffort));
                  }
                  // effortDraft: DO NOT TOUCH.
                } else {
                  // Reopen: pop the snapshot captured on the earlier
                  // complete and pre-fill the drafts. If the user
                  // typed a fresh hoursdone AFTER seeing the seed,
                  // their value wins because it's what's in the input
                  // at Save Changes time -- normal draft precedence.
                  //
                  // Snapshot is session-scoped (see
                  // taskCompletionSnapshot.ts); on a refresh or
                  // panel-close-and-reopen it disappears. When it's
                  // absent we leave the drafts as the useEffect at
                  // ~line 281 already initialized them (from server
                  // values), so the user sees the last-saved effort
                  // + hoursdone in the fields and can edit hoursdone
                  // freely before Save Changes. Prior behavior zeroed
                  // hoursdone silently on any refresh path, which
                  // discarded the user's pre-completion value.
                  const snap = popCompletionSnapshot(t.msdyn_projecttaskid);
                  if (snap) {
                    if (snap.effort !== undefined) {
                      setEffortDraft(String(snap.effort));
                    }
                    setHoursDoneDraft(String(snap.effortCompleted ?? 0));
                  }
                  // else: leave drafts as-is (server values from the
                  // load-time useEffect). User adjusts hoursdone.
                }
              }
              setCompletionDraft(next);
            }}
          />
          {completionGuardError && (
            <GuardAlertDialog
              open={!!completionGuardError}
              title="Can't complete this task"
              message={completionGuardError.message}
              onClose={() => setCompletionGuardError(null)}
            />
          )}
          {hoursExceedPrompt && (
            <ConfirmDialog
              open={!!hoursExceedPrompt}
              title="Assignee hours exceed Effort"
              message={`Assignee hours (${hoursExceedPrompt.total}h) are more than this task's Effort (${hoursExceedPrompt.effort}h). Bump Effort up to ${hoursExceedPrompt.total}h to match, or go back and adjust the assignee hours so they fit the current Effort.`}
              confirmLabel={`Bump Effort to ${hoursExceedPrompt.total}h`}
              onConfirm={() => {
                const bumpTo = hoursExceedPrompt.total;
                setHoursExceedPrompt(null);
                // Reflect the bump in the visible Effort input, then save with an
                // explicit override so the async setState can't race the submit.
                setEffortDraft(String(bumpTo));
                void proceedSubmit(bumpTo);
              }}
              onCancel={() => setHoursExceedPrompt(null)}
            />
          )}
          {(() => {
            // The pill reflects what the task WILL look like after Save
            // Changes commits the current drafts, not just the server
            // state -- otherwise editing hoursdone in the panel leaves
            // the pill stuck on the pre-edit status until refresh.
            //
            // Precedence:
            //   1. explicit completionDraft (user clicked the circle)
            //   2. draft-derived: run deriveTaskStatus() against a
            //      preview ProjectTask built from the current drafts.
            //      This flips the pill in real time when the user
            //      types 20 into hoursdone on a task with effort=20,
            //      or knocks it back down to 10 on a done task.
            //   3. server status (unchanged behavior)
            const serverStatus = deriveTaskStatus(t);
            // Build a preview task from the drafts. Only override the
            // fields deriveTaskStatus actually reads -- statecode,
            // getDisplayProgressPct inputs (effort + hoursdone in both
            // pmo_* and msdyn_* form), and the scheduled-end for the
            // overdue/at-risk branches.
            const preview: ProjectTask = {
              ...t,
              pmo_taskeffort: effortDraftNum ?? t.pmo_taskeffort,
              msdyn_effort: effortDraftNum ?? t.msdyn_effort,
              pmo_taskhoursdone: hoursDoneDraftNum ?? t.pmo_taskhoursdone,
              msdyn_effortcompleted: hoursDoneDraftNum ?? t.msdyn_effortcompleted,
            };
            const draftStatus = deriveTaskStatus(preview);
            // Explicit user click always wins. If the user typed drafts
            // that push the status to a different value from server, we
            // show that -- even without a click.
            const effectiveStatus =
              completionDraft === true ? 'done'
              : completionDraft === false ? (draftStatus === 'done' ? 'in-progress' : draftStatus)
              : draftStatus;
            const meta = STATUS_META[effectiveStatus];
            const isDrafted =
              completionDraft !== null || effectiveStatus !== serverStatus;
            return (
              <>
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', meta.pillCls)}>
                  {meta.label}
                </span>
                {isDrafted && (
                  <span className="text-[10px] text-muted-foreground italic">(unsaved)</span>
                )}
              </>
            );
          })()}
        </div>

        {/* Title */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Title<SavingDot active={savingFields.has('subject')} /></label>
          <input
            ref={subjectRef}
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            onBlur={commitSubject}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setSubjectDraft(t.msdyn_subject); e.currentTarget.blur(); }
            }}
            disabled={isOptimistic || saving || pipelineLocked}
            className="w-full bg-transparent border-b border-border focus:border-primary outline-none text-sm font-medium pb-1 transition-colors disabled:opacity-50"
            placeholder="Task name"
          />
        </div>

        {/* Priority + badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Priority — editable (S2 PASS: 1=Urgent,3=Important,5=Medium,9=Low) */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Priority<SavingDot active={savingFields.has('priority')} /></label>
            <select
              value={priorityDraft}
              onChange={(e) => commitPriority(Number(e.target.value))}
              disabled={saving || isOptimistic || pipelineLocked}
              className={cn(
                'text-[11px] border rounded px-1.5 py-0.5 outline-none focus:border-primary disabled:opacity-50',
                TASK_PRIORITY_META[priorityDraft]?.cls ?? 'bg-muted/20 border-border',
              )}
            >
              {TASK_PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {t.msdyn_ismilestone && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-0.5">
              <Flag className="h-2.5 w-2.5" /> Milestone
            </span>
          )}
          {t.msdyn_iscritical && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Critical Path</span>
          )}
        </div>

        {isCustomLabels && (
          <CustomLabelEditor
            projectId={projectId}
            taskId={t.msdyn_projecttaskid}
            labelText={t.pmo_tasklabel}
            canEdit={canEdit}
            disabled={isOptimistic}
          />
        )}

        {/* Labels — assigned chips + dropdown to add/rename, matching Planner UX */}
        {!isCustomLabels && projectLabels.length > 0 && (() => {
          // Planner default names and colors — order matches Planner UI (confirmed from screenshot)
          const PLANNER_NAMES = [
            'Pink','Red','Yellow','Green','Blue','Purple','Bronze','Lime',
            'Aqua','Gray','Silver','Brown','Cranberry','Orange','Peach',
            'Marigold','Light green','Dark green','Teal','Light blue',
            'Dark blue','Lavender','Plum','Light gray','Dark gray',
          ];
          const PALETTE = [
            'bg-pink-400 text-white','bg-red-600 text-white','bg-yellow-300 text-yellow-900',
            'bg-green-600 text-white','bg-blue-600 text-white','bg-violet-600 text-white',
            'bg-amber-700 text-white','bg-lime-500 text-lime-900','bg-cyan-500 text-white',
            'bg-gray-400 text-white','bg-gray-300 text-gray-700','bg-amber-900 text-white',
            'bg-rose-800 text-white','bg-orange-500 text-white','bg-orange-300 text-orange-900',
            'bg-amber-400 text-amber-900','bg-emerald-400 text-emerald-900','bg-emerald-800 text-white',
            'bg-teal-600 text-white','bg-sky-400 text-sky-900','bg-blue-800 text-white',
            'bg-violet-300 text-violet-900','bg-purple-800 text-white','bg-slate-300 text-slate-700',
            'bg-slate-600 text-white',
          ];
          const idx = (ci: number) => (ci >= 192350000 ? ci - 192350000 : ci) % 25;
          const nameFor = (l: typeof projectLabels[0]) =>
            labelDraftRenames.get(l.msdyn_projectlabelid)
            ?? l.msdyn_projectlabeltext
            ?? PLANNER_NAMES[idx(l.msdyn_colorindex)]
            ?? 'Label';
          const colorFor = (ci: number) => PALETTE[idx(ci)] ?? 'bg-muted text-foreground';
          const taskJunctions = allTaskLabels.filter((tl) => tl['_msdyn_projecttaskid_value'] === t.msdyn_projecttaskid);
          const serverAssignedIds = new Set(taskJunctions.map((tl) => tl['_msdyn_projectlabelid_value'] as string));
          // Stage 6.2: apply local label drafts on top of server state for an
          // optimistic preview while the user composes their submit.
          const effectiveAssignedIds = new Set(serverAssignedIds);
          labelDraftRemove.forEach((id) => effectiveAssignedIds.delete(id));
          labelDraftAssign.forEach((id) => effectiveAssignedIds.add(id));
          const assigned = projectLabels.filter((l) => effectiveAssignedIds.has(l.msdyn_projectlabelid));
          const available = projectLabels.filter((l) => !effectiveAssignedIds.has(l.msdyn_projectlabelid));
          return (
            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Labels</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {assigned.map((label) => {
                  if (renamingLabelId === label.msdyn_projectlabelid) {
                    return (
                      <span key={label.msdyn_projectlabelid} className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', colorFor(label.msdyn_colorindex))}>
                        <input
                          autoFocus
                          value={renameLabelDraft}
                          onChange={(e) => setRenameLabelDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { setRenamingLabelId(null); return; }
                            if (e.key === 'Enter') {
                              const name = renameLabelDraft.trim();
                              if (name && name !== nameFor(label)) {
                                // Stage 6.2: stage the rename in the draft map.
                                setLabelDraftRenames((prev) => {
                                  const next = new Map(prev);
                                  next.set(label.msdyn_projectlabelid, name);
                                  return next;
                                });
                              }
                              setRenamingLabelId(null);
                            }
                          }}
                          onBlur={() => {
                            const name = renameLabelDraft.trim();
                            if (name && name !== nameFor(label)) {
                              setLabelDraftRenames((prev) => {
                                const next = new Map(prev);
                                next.set(label.msdyn_projectlabelid, name);
                                return next;
                              });
                            }
                            setRenamingLabelId(null);
                          }}
                          className="bg-transparent outline-none border-b border-current w-20 text-[10px]"
                        />
                        <button onClick={() => setRenamingLabelId(null)} className="hover:opacity-70" title="Cancel">
                          <Check className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  }
                  return (
                    <span key={label.msdyn_projectlabelid} className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', colorFor(label.msdyn_colorindex))}>
                      {nameFor(label)}
                      <button
                        onClick={() => { setRenameLabelDraft(nameFor(label)); setRenamingLabelId(label.msdyn_projectlabelid); }}
                        className="hover:opacity-70 ml-0.5" title="Rename label"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => {
                          // Stage 6.2: draft only. If this label was a pending add,
                          // cancel that. Otherwise mark for removal on Submit.
                          const id = label.msdyn_projectlabelid;
                          setLabelDraftAssign((prev) => {
                            if (!prev.has(id)) return prev;
                            const next = new Set(prev); next.delete(id); return next;
                          });
                          setLabelDraftRemove((prev) => {
                            if (prev.has(id)) return prev;
                            const next = new Set(prev); next.add(id); return next;
                          });
                          // Also drop any pending rename for this label.
                          setLabelDraftRenames((prev) => {
                            if (!prev.has(id)) return prev;
                            const next = new Map(prev); next.delete(id); return next;
                          });
                        }}
                        className="hover:opacity-70" title="Remove label"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
                {available.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-foreground transition-colors">
                        + Add label
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="text-xs max-h-60 overflow-y-auto">
                      {available.map((label) => (
                        <DropdownMenuItem
                          key={label.msdyn_projectlabelid}
                          onClick={() => {
                            // Stage 6.2: draft only. If this label was a pending
                            // remove, cancel that. Otherwise mark for assign on Submit.
                            const id = label.msdyn_projectlabelid;
                            setLabelDraftRemove((prev) => {
                              if (!prev.has(id)) return prev;
                              const next = new Set(prev); next.delete(id); return next;
                            });
                            setLabelDraftAssign((prev) => {
                              if (prev.has(id)) return prev;
                              const next = new Set(prev); next.add(id); return next;
                            });
                          }}
                        >
                          <span className={cn('inline-block w-3 h-3 rounded-full mr-2 shrink-0', colorFor(label.msdyn_colorindex))} />
                          {nameFor(label)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          );
        })()}

        {/* Description — added 2026-07-22. State (descDraft), diff, patch,
            audit, staging payload all already wired; only the JSX input was
            missing so real users had no way to enter a task description. */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Description<SavingDot active={savingFields.has('description')} />
          </label>
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="Add a description…"
            disabled={!canEdit}
            title={!canEdit ? 'Read-only — you cannot modify this task' : undefined}
            maxLength={2000}
            className="w-full min-h-[72px] resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {/* Sprint */}
        {sprints.length > 0 && (
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Sprint</label>
            <select
              value={t['_msdyn_projectsprint_value'] ?? ''}
              onChange={async (e) => {
                const val = e.target.value || null;
                const oldSprintId = t['_msdyn_projectsprint_value'] ?? null;
                const oldName = sprints.find((s) => s.msdyn_projectsprintid === oldSprintId)?.msdyn_name ?? 'no sprint';
                const newName = val ? (sprints.find((s) => s.msdyn_projectsprintid === val)?.msdyn_name ?? 'sprint') : 'no sprint';
                setSaving(true);
                try {
                  await setSprintMutation.mutateAsync({ taskId: t.msdyn_projecttaskid, sprintId: val });
                  // Sprint changes are immediate (not part of the panel's
                  // batched Submit), so emit a single-entry audit row of
                  // their own. relation='sprint' lets Wave 2 group them.
                  if (onAuditBatch) {
                    onAuditBatch(t.msdyn_projecttaskid, t.msdyn_subject, [
                      { kind: 'relationship', relation: 'sprint', action: 'update', label: newName, old: oldName, new: newName },
                    ]);
                  }
                } catch (err) {
                  showError(`Failed to set sprint: ${toFriendlyError(err)}`);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || isOptimistic || setSprintMutation.isPending || pipelineLocked}
              className="text-xs border border-border rounded px-2 py-1.5 bg-muted/20 outline-none focus:border-primary disabled:opacity-50 w-full"
            >
              <option value="">No sprint</option>
              {sprints.map((s) => (
                <option key={s.msdyn_projectsprintid} value={s.msdyn_projectsprintid}>
                  {s.msdyn_name ?? s.msdyn_projectsprintid.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stage 7: Effort + Hours done are the only editable progress inputs
            under the Old Resource Model. % Complete is a read-only derived
            display below them — always shows (hoursDone / effort) on the
            user's draft, mirroring what PSS will compute. The card's progress
            bar is the canonical % display; this line in the panel is just
            feedback while the user types.
            New Resource Model: Hours done becomes a read-only calculated
            value (Σ assignee contributed hours, see Assignees section below)
            with a hint pointing the user there; Effort stays manually
            editable and is the guardrail ceiling for that sum. */}
        {!t.msdyn_summary && (() => {
          const hoursDoneDisabled = saving || isOptimistic || pipelineLocked || effortForCheck === 0;
          const effectiveHoursDone = useNewResourceModel ? newModelHoursDone : hoursDoneDraftNum;
          const previewPct = effortForCheck > 0 && effectiveHoursDone !== undefined
            ? Math.min(100, Math.round((effectiveHoursDone / effortForCheck) * 100))
            : 0;
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                    Hours done<SavingDot active={savingFields.has('effortCompleted')} />
                  </label>
                  {useNewResourceModel ? (
                    <div
                      className="w-full text-xs bg-muted/20 border border-border rounded px-2 py-1.5 text-muted-foreground"
                      title="Calculated from assignee hours — add or edit hours in the Assignees section below."
                    >
                      {newModelHoursDone}h
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={hoursDoneDraft}
                      onChange={(e) => setHoursDoneDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      disabled={hoursDoneDisabled}
                      placeholder="hours"
                      title={effortForCheck === 0 ? 'Set effort first' : undefined}
                      className="w-full text-xs bg-muted/30 border border-border rounded px-2 py-1.5 outline-none focus:border-primary disabled:opacity-50"
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Effort (hours)<SavingDot active={savingFields.has('effort')} /></label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={effortDraft}
                    onChange={(e) => setEffortDraft(e.target.value)}
                    onBlur={commitEffort}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    disabled={saving || isOptimistic || pipelineLocked}
                    placeholder="hours"
                    className="w-full text-xs bg-muted/30 border border-border rounded px-2 py-1.5 outline-none focus:border-primary disabled:opacity-50"
                  />
                </div>
              </div>
              {useNewResourceModel && (
                <div className="text-[10px] text-muted-foreground">Calculated from assignee hours — add or edit hours in the Assignees section below.</div>
              )}
              {!useNewResourceModel && hoursDoneTooHigh && (
                <div className="text-[11px] text-rose-700">Hours done can't exceed Effort ({effortForCheck}h).</div>
              )}
              {useNewResourceModel && newModelOverGuard && (
                <div className="flex items-center gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                  <span className="flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5 shrink-0" /> Assignee hours ({newModelHoursDone}h) exceed Effort ({effortForCheck}h). You'll be asked to bump Effort or adjust hours when you save.</span>
                </div>
              )}
              {!useNewResourceModel && effortForCheck === 0 && hoursDoneDraft === '' && (
                <div className="text-[10px] text-muted-foreground">Set Effort to enable Hours done.</div>
              )}
              {effortForCheck > 0 && (
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', previewPct >= 100 ? 'bg-emerald-500' : 'bg-primary')}
                      style={{ width: `${previewPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums w-10 text-right">{previewPct}%</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Milestone — read-only display; PSS does not allow updating msdyn_ismilestone (AV-0002) */}
        {!t.msdyn_summary && t.msdyn_ismilestone && (
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Milestone</label>
            <span className="text-[10px] font-medium px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-700 flex items-center gap-1">
              <Flag className="h-2.5 w-2.5" /> Milestone
            </span>
          </div>
        )}

        {/* Dates. Summary tasks are read-only — their dates are rolled up
            from child tasks by PSS, and editing them directly drifts the
            rollup until PSS re-syncs. */}
        {t.msdyn_summary ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Start
              </label>
              <div className="w-full text-xs bg-muted/20 border border-border rounded px-2 py-1.5 text-muted-foreground">
                {toDateInput(t.msdyn_scheduledstart) || '—'}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Due
              </label>
              <div className="w-full text-xs bg-muted/20 border border-border rounded px-2 py-1.5 text-muted-foreground">
                {toDateInput(t.msdyn_scheduledend ?? t.msdyn_finish) || '—'}
              </div>
            </div>
            <div className="col-span-2 text-[10px] text-muted-foreground">
              Rolled up from child tasks. Edit dates on the children to change them.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Start<SavingDot active={savingFields.has('scheduledStart')} />
              </label>
              <input
                type="date"
                value={toDateInput(startDraft)}
                onChange={(e) => commitStartDate(fromDateInput(e.target.value, startDraft || t.msdyn_scheduledstart) ?? '')}
                disabled={saving || isOptimistic || pipelineLocked}
                className="w-full text-xs bg-muted/30 border border-border rounded px-2 py-1.5 outline-none focus:border-primary transition-colors disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Due<SavingDot active={savingFields.has('scheduledEnd')} />
              </label>
              <input
                type="date"
                value={toDateInput(endDraft)}
                onChange={(e) => commitEndDate(fromDateInput(e.target.value, endDraft || t.msdyn_scheduledend || t.msdyn_finish) ?? '')}
                disabled={saving || isOptimistic || pipelineLocked}
                className="w-full text-xs bg-muted/30 border border-border rounded px-2 py-1.5 outline-none focus:border-primary transition-colors disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {/* Duration -- read-only, PSS-derived (weekdays inclusive x 8h). Matches PROD. */}
        {!t.msdyn_summary && (() => {
          const durDays = t.msdyn_duration ?? computeDurationDays(startDraft || t.msdyn_scheduledstart, endDraft || t.msdyn_scheduledend || t.msdyn_finish);
          const durText = formatDurationDays(durDays);
          if (!durText) return null;
          return (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Duration</label>
              <div className="text-xs text-muted-foreground">{durText}<span className="ml-1 text-muted-foreground/60">(calculated from start &amp; due)</span></div>
            </div>
          );
        })()}

        {/* Assignees */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Assignees</label>
          {useNewResourceModel ? (
            <div className="space-y-1.5">
              {effectiveAssignees.map((a) => {
                const isPendingAdd = a.assignmentId.startsWith('pending-');
                const draftStr = assigneeHoursDraft.get(a.assignmentId);
                const inputValue = draftStr !== undefined
                  ? draftStr
                  : (a.contributedHours !== undefined ? String(a.contributedHours) : '');
                // Capacity hint: this person's Σ contributed hours across ALL
                // tasks on the project (from allProjectAssignees), informational
                // only -- never blocks.
                const projectTotal = projectHoursByMemberId?.get(a.teamMemberId) ?? 0;
                return (
                  <div
                    key={a.assignmentId}
                    className="flex items-center gap-2 text-xs bg-muted/20 border border-border rounded px-2 py-1.5"
                  >
                    <span className="text-[10px] font-semibold shrink-0">{initials(a.name)}</span>
                    <span className="flex-1 truncate" title={a.name}>{a.name}</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={inputValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAssigneeHoursDraft((prev) => {
                          const next = new Map(prev);
                          next.set(a.assignmentId, val);
                          return next;
                        });
                        // Effort is intentionally NOT auto-bumped here. Editing an
                        // assignee's hours must never silently change the task's
                        // Effort. If the resulting Σ assignee hours exceed Effort,
                        // the warning banner surfaces it and the mismatch is resolved
                        // at Save time via the hoursExceedPrompt dialog.
                      }}
                      disabled={saving || isOptimistic || pipelineLocked}
                      placeholder="hrs"
                      title="Contributed hours on this task"
                      className="w-14 text-xs bg-background border border-border rounded px-1.5 py-1 outline-none focus:border-primary disabled:opacity-50"
                    />
                    <span className="text-[10px] text-muted-foreground shrink-0" title="Total contributed hours on this project">
                      {projectTotal}h on project
                    </span>
                    <button
                      onClick={() => {
                        if (isPendingAdd) {
                          const teamMemberId = a.teamMemberId;
                          setAssigneeDraftAdd((prev) => {
                            if (!prev.has(teamMemberId)) return prev;
                            const next = new Set(prev); next.delete(teamMemberId); return next;
                          });
                        } else {
                          setAssigneeDraftRemove((prev) => {
                            if (prev.has(a.assignmentId)) return prev;
                            const next = new Set(prev); next.add(a.assignmentId); return next;
                          });
                        }
                        setAssigneeHoursDraft((prev) => {
                          if (!prev.has(a.assignmentId)) return prev;
                          const next = new Map(prev); next.delete(a.assignmentId); return next;
                        });
                      }}
                      className="hover:text-destructive transition-colors shrink-0"
                      title={`Remove ${a.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {effectiveAssignees.map((a) => {
              const isPendingAdd = a.assignmentId.startsWith('pending-');
              return (
              <span
                key={a.assignmentId}
                className="inline-flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary rounded-full px-2.5 py-1"
              >
                <span className="text-[10px] font-semibold">{initials(a.name)}</span>
                <span className="text-[10px] font-normal">{a.name.split(' ')[0]}</span>
                <button
                  onClick={() => {
                    // Stage 6.5: draft only.
                    if (isPendingAdd) {
                      // It was a pending add — cancel.
                      const teamMemberId = a.teamMemberId;
                      setAssigneeDraftAdd((prev) => {
                        if (!prev.has(teamMemberId)) return prev;
                        const next = new Set(prev); next.delete(teamMemberId); return next;
                      });
                    } else {
                      // Existing server assignment — mark for removal.
                      setAssigneeDraftRemove((prev) => {
                        if (prev.has(a.assignmentId)) return prev;
                        const next = new Set(prev); next.add(a.assignmentId); return next;
                      });
                    }
                  }}
                  className="hover:text-destructive transition-colors ml-0.5"
                  title={`Remove ${a.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              );
            })}
          </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {unassignedMembers.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-full px-2.5 py-1 transition-colors">
                    <UserPlus className="h-3 w-3" />
                    Assign
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="text-xs">
                  {unassignedMembers.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => {
                        // Stage 6.5: draft only. If this person had a pending
                        // remove (existing server assignment), cancel that
                        // instead of staging a duplicate add.
                        const existingAssignment = assignees.find((a) => a.teamMemberId === m.id);
                        if (existingAssignment && assigneeDraftRemove.has(existingAssignment.assignmentId)) {
                          setAssigneeDraftRemove((prev) => {
                            if (!prev.has(existingAssignment.assignmentId)) return prev;
                            const next = new Set(prev); next.delete(existingAssignment.assignmentId); return next;
                          });
                          return;
                        }
                        setAssigneeDraftAdd((prev) => {
                          if (prev.has(m.id)) return prev;
                          const next = new Set(prev); next.add(m.id); return next;
                        });
                      }}
                    >
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {effectiveAssignees.length === 0 && unassignedMembers.length === 0 && (
              <p className="text-xs text-muted-foreground">No team members</p>
            )}
          </div>
        </div>

        {/* Checklist — S6 PASS: msdyn_projectchecklist, FK _msdyn_projecttaskid_value */}
        {!t.msdyn_summary && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Checklist {checklists.length > 0 && `(${checklists.filter((c) => c.msdyn_projectchecklistcompleted).length}/${checklists.length})`}
            </label>
            {(() => {
              // Stage 6.5: apply checklist drafts on top of server state for the
              // optimistic preview while the user composes their submit.
              const visibleServerItems = checklists
                .filter((c) => !checklistDraftRemove.has(c.msdyn_projectchecklistid))
                .map((c) => ({
                  id: c.msdyn_projectchecklistid,
                  name: c.msdyn_name ?? '',
                  completed: checklistDraftToggle.get(c.msdyn_projectchecklistid) ?? c.msdyn_projectchecklistcompleted ?? false,
                  dueDate: checklistDraftDueDate.has(c.msdyn_projectchecklistid)
                    ? checklistDraftDueDate.get(c.msdyn_projectchecklistid) ?? null
                    : (c.dueDate ?? null),
                  isDraftAdd: false,
                  isOptimistic: c.msdyn_projectchecklistid.startsWith('optimistic-'),
                }));
              const draftAddedItems = checklistDraftAdd.map((draft) => ({
                id: draft.tempId,
                name: draft.name,
                completed: draft.completed,
                dueDate: draft.dueDate ?? null,
                isDraftAdd: true,
                isOptimistic: false,
              }));
              const unorderedItems = [...visibleServerItems, ...draftAddedItems];
              // Apply the draft display order (custom source drag-reorder) if set.
              const effectiveItems = checklistOrder
                ? [...unorderedItems].sort((a, b) => {
                    const ia = checklistOrder.indexOf(a.id);
                    const ib = checklistOrder.indexOf(b.id);
                    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
                  })
                : unorderedItems;
              // Snapshot of the current display id order — used to seed a reorder draft on first drag.
              const currentOrderIds = effectiveItems.map((it) => it.id);
              const overdueYmd = todayLocalYmd();
              return (
                <div className="space-y-1">
                  {effectiveItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 group/cl rounded px-1 -mx-1',
                        clDragOverId === item.id && 'border-t-2 border-primary',
                        clDragId === item.id && 'opacity-50',
                      )}
                      draggable={checklistSourceIsCustom && !item.isOptimistic}
                      onDragStart={checklistSourceIsCustom ? (e) => {
                        setClDragId(item.id);
                        e.dataTransfer.effectAllowed = 'move';
                      } : undefined}
                      onDragOver={checklistSourceIsCustom && clDragId ? (e) => {
                        e.preventDefault();
                        if (item.id !== clDragOverId) setClDragOverId(item.id);
                      } : undefined}
                      onDragLeave={checklistSourceIsCustom ? () => setClDragOverId((cur) => (cur === item.id ? null : cur)) : undefined}
                      onDrop={checklistSourceIsCustom && clDragId ? (e) => {
                        e.preventDefault();
                        const from = clDragId;
                        const to = item.id;
                        setClDragId(null);
                        setClDragOverId(null);
                        if (!from || from === to) return;
                        const base = checklistOrder ?? currentOrderIds;
                        const next = base.filter((id) => id !== from);
                        const idx = next.indexOf(to);
                        next.splice(idx < 0 ? next.length : idx, 0, from);
                        setChecklistOrder(next);
                      } : undefined}
                      onDragEnd={checklistSourceIsCustom ? () => { setClDragId(null); setClDragOverId(null); } : undefined}
                    >
                      {checklistSourceIsCustom && (
                        <GripVertical
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-muted-foreground/50',
                            item.isOptimistic ? 'opacity-30' : 'cursor-grab active:cursor-grabbing group-hover/cl:text-muted-foreground',
                          )}
                        />
                      )}
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => {
                          // Pending add: flip the completed flag on the draft
                          // entry directly so the box can be ticked before save.
                          if (item.isDraftAdd) {
                            setChecklistDraftAdd((prev) =>
                              prev.map((dr) =>
                                dr.tempId === item.id ? { ...dr, completed: !dr.completed } : dr,
                              ),
                            );
                            return;
                          }
                          // Server item: stage the toggle in the draft map. If a
                          // draft toggle would put the item back to its server
                          // state, drop the entry instead.
                          const serverItem = checklists.find((c) => c.msdyn_projectchecklistid === item.id);
                          const serverCompleted = serverItem?.msdyn_projectchecklistcompleted ?? false;
                          const next = !item.completed;
                          setChecklistDraftToggle((prev) => {
                            const m = new Map(prev);
                            if (next === serverCompleted) m.delete(item.id);
                            else m.set(item.id, next);
                            return m;
                          });
                        }}
                        disabled={item.isOptimistic}
                        className="h-3.5 w-3.5 rounded accent-primary shrink-0"
                      />
                      <span className={cn('flex-1 text-xs', item.completed && 'line-through text-muted-foreground')}>
                        {item.name}
                      </span>
                      {/* Jira-style due date (custom source only). Compact native date input;
                          shows the picked day, tinted red when overdue + not completed. */}
                      {checklistSourceIsCustom && (() => {
                        // Stage the picked value into the draft, silently. No bounds
                        // prompt here — see checkBounds below (fires on blur).
                        const applyDue = (ymd: string | null) => {
                          if (item.isDraftAdd) {
                            setChecklistDraftAdd((prev) => prev.map((dr) => dr.tempId === item.id ? { ...dr, dueDate: ymd } : dr));
                            return;
                          }
                          const serverItem = checklists.find((c) => c.msdyn_projectchecklistid === item.id);
                          const serverDue = serverItem?.dueDate ?? null;
                          setChecklistDraftDueDate((prev) => {
                            const m = new Map(prev);
                            if ((ymd ?? null) === (serverDue ?? null)) m.delete(item.id);
                            else m.set(item.id, ymd);
                            return m;
                          });
                        };
                        // Task window bounds as YYYY-MM-DD (from the panel's start/end drafts).
                        const taskStartYmd = dateInputValue(startDraft || t.msdyn_scheduledstart);
                        const taskDueYmd = dateInputValue(endDraft || t.msdyn_scheduledend || t.msdyn_finish);
                        // Blur-time bounds check. The value is already staged via
                        // applyDue on change; if it landed outside the task window we
                        // prompt now — NOT on change, which fired mid-interaction
                        // (clicking the calendar's month arrows keeps the day selected
                        // and emits a change before the user commits a day, popping the
                        // warning prematurely). Compare bare YYYY-MM-DD so a due date on
                        // the start/due boundary counts as in-window.
                        const checkBounds = (rawYmd: string | null) => {
                          const bare = rawYmd ? rawYmd.slice(0, 10) : null;
                          if (!bare) return;
                          const revertYmd = dueEditBaselineRef.current.get(item.id) ?? null;
                          if (taskStartYmd && bare < taskStartYmd) {
                            setDueWarn({ itemId: item.id, isDraftAdd: item.isDraftAdd, ymd: rawYmd!, kind: 'before-start', revertYmd });
                          } else if (taskDueYmd && bare > taskDueYmd) {
                            setDueWarn({ itemId: item.id, isDraftAdd: item.isDraftAdd, ymd: rawYmd!, kind: 'after-due', revertYmd });
                          }
                        };
                        const overdue = !!item.dueDate && !item.completed && item.dueDate < overdueYmd;
                        return (
                          <span className="relative shrink-0 inline-flex items-center">
                            <input
                              type="date"
                              value={dateInputValue(item.dueDate)}
                              // Capture the pre-edit value on focus so a cancelled
                              // out-of-window edit can roll the staged draft back.
                              onFocus={() => dueEditBaselineRef.current.set(item.id, item.dueDate ?? null)}
                              // Apply silently on every change (keeps the picker
                              // responsive during month navigation); warn only on blur.
                              onChange={(e) => applyDue(e.target.value ? toDataverseDateOnly(e.target.value) ?? null : null)}
                              onBlur={(e) => checkBounds(e.target.value ? toDataverseDateOnly(e.target.value) ?? null : null)}
                              disabled={item.isOptimistic}
                              title={item.dueDate ? `Due ${fmtDateOnly(item.dueDate)}` : 'Set due date'}
                              className={cn(
                                'text-[10px] rounded border px-1 py-0.5 bg-transparent outline-none focus:border-primary transition-colors',
                                item.dueDate ? (overdue ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground')
                                             : 'border-dashed border-border/60 text-muted-foreground/60',
                              )}
                            />
                          </span>
                        );
                      })()}
                      <button
                        onClick={() => {
                          // Stage 6.5: draft only. Pending adds: drop from add list.
                          // Server items: stage for removal.
                          if (item.isDraftAdd) {
                            setChecklistDraftAdd((prev) => prev.filter((dr) => dr.tempId !== item.id));
                            return;
                          }
                          setChecklistDraftRemove((prev) => {
                            if (prev.has(item.id)) return prev;
                            const next = new Set(prev); next.add(item.id); return next;
                          });
                          // Also drop any pending toggle on this item — about to be removed.
                          setChecklistDraftToggle((prev) => {
                            if (!prev.has(item.id)) return prev;
                            const m = new Map(prev); m.delete(item.id); return m;
                          });
                        }}
                        disabled={item.isOptimistic}
                        className="opacity-0 group-hover/cl:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="flex items-center gap-1.5">
              <input
                ref={checklistInputRef}
                value={newChecklistText}
                onChange={(e) => setNewChecklistText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitChecklistItem(); }
                  if (e.key === 'Escape') setNewChecklistText('');
                }}
                placeholder="Add item…"
                className="flex-1 text-xs bg-muted/30 border border-border rounded px-2 py-1.5 outline-none focus:border-primary transition-colors"
              />
              {newChecklistText.trim() && (
                <button
                  type="button"
                  onClick={commitChecklistItem}
                  title="Add item"
                  className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Documents */}
        {!t.msdyn_summary && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Attachments</label>
            <DocumentLibrary
              compact
              recordType="Task"
              recordId={t.msdyn_projecttaskid}
              recordName={t.msdyn_subject ?? ''}
              projectId={projectId}
              taskId={t.msdyn_projecttaskid}
            />
          </div>
        )}

        {/* Notes — Dataverse annotation rows scoped to this task. Roll up
            into the project Notes tab via _objectid_value lookup. */}
        {!t.msdyn_summary && !isOptimistic && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Notes</label>
            <NotesSection
              compact
              scope={{ kind: 'task', projectId, taskId: t.msdyn_projecttaskid, taskName: t.msdyn_subject }}
            />
          </div>
        )}

        {/* Delete */}
        {!t.msdyn_summary && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full justify-start"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={saving || isOptimistic || pipelineLocked}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete task
            </Button>
          </div>
        )}

      </div>

      {/* Unsaved-changes guard. Only reachable when isDirty -- a clean panel
          closes straight away on backdrop click or Escape. */}
      <Dialog open={discardPromptOpen} onOpenChange={setDiscardPromptOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Discard unsaved changes?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This task has edits you have not saved yet. Closing now loses them.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardPromptOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => { setDiscardPromptOpen(false); resetDrafts(); onClose(); }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checklist due-date outside the task window confirm. */}
      <Dialog open={dueWarn !== null} onOpenChange={(o) => { if (!o) setDueWarn(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              {dueWarn?.kind === 'before-start' ? 'Due date before task start' : 'Due date after task due date'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {dueWarn?.kind === 'before-start'
              ? `This checklist item's due date (${fmtDateOnly(dueWarn?.ymd)}) is BEFORE the task's start date (${fmtDateOnly(startDraft || t.msdyn_scheduledstart)}). Are you sure you want to set it earlier than the task starts?`
              : `This checklist item's due date (${fmtDateOnly(dueWarn?.ymd)}) is AFTER the task's due date (${fmtDateOnly(endDraft || t.msdyn_scheduledend || t.msdyn_finish)}). Are you sure you want it due after the task itself?`}
          </p>
          <DialogFooter>
            {/* The out-of-window value is ALREADY staged (applied on change). Cancel
                rolls the draft back to the pre-edit baseline captured on focus. */}
            <Button
              variant="ghost"
              onClick={() => {
                const w = dueWarn;
                setDueWarn(null);
                if (!w) return;
                if (w.isDraftAdd) {
                  setChecklistDraftAdd((prev) => prev.map((dr) => dr.tempId === w.itemId ? { ...dr, dueDate: w.revertYmd } : dr));
                  return;
                }
                const serverItem = checklists.find((c) => c.msdyn_projectchecklistid === w.itemId);
                const serverDue = serverItem?.dueDate ?? null;
                setChecklistDraftDueDate((prev) => {
                  const m = new Map(prev);
                  if ((w.revertYmd ?? null) === (serverDue ?? null)) m.delete(w.itemId);
                  else m.set(w.itemId, w.revertYmd);
                  return m;
                });
              }}
            >
              Cancel
            </Button>
            {/* Value is already staged; keeping it is just closing the prompt. */}
            <Button onClick={() => setDueWarn(null)}>
              Set anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete task"
        recordName={t.msdyn_subject ?? '(untitled task)'}
        childSummary={deleteChildSummary}
        requireTypedName={false}
        extraWarning={hasChildren
          ? 'This task has child tasks. Deleting it removes those child tasks too. There is no undo.'
          : 'There is no undo.'}
        onConfirm={handleConfirmDelete}
      />
    </ViewDetailPanel>
  );
}
