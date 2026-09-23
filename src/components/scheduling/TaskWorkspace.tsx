import { useState, useCallback, useMemo, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, AlertCircle, X, LayoutTemplate, Loader2, Link2, Trash2, Search, SlidersHorizontal, LayoutGrid, List, BarChart3, Users, GanttChart } from 'lucide-react';
import { Button } from '../ui/button';
import { BucketSection } from './BucketSection';
import { CreateTaskDialog, type CreateTaskExtras } from './CreateTaskDialog';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskFilterBar, EMPTY_FILTERS, hasActiveFilters, type TaskFilters } from './TaskFilterBar';
import { TaskListView } from './TaskListView';
import { TaskChartsView } from './TaskChartsView';
import { TaskPeopleView } from './TaskPeopleView';
import { useDegradedSaveWarning } from '../../lib/stagingOverlay';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { TaskTimelineView } from './TaskTimelineView';
import { useProjectLabels, useProjectTaskLabels } from '../../hooks/useProjectLabels';
import type { TaskLabelChip } from '../../lib/labelPalette';
import { BUCKET_KEYS, useReorderProjectBuckets, useDeleteProjectBucket, resolveDeferredReorder, resolveDeferredDelete } from '../../hooks/useProjectBucketMutations';
import { useTaskSource, usesCustomTables } from '../../lib/taskSource';
import { getBucketOrder } from '../../models/projectBucket.model';
import { createProjectBucket } from '../../api/projectBuckets.api';
import { createCustomBucket } from '../../api/customBuckets.api';
import { createCustomTask } from '../../api/customTasks.api';
import {
  enqueueBucketCreate,
  cancelBucketCreate,
  getPendingBucketCount,
  subscribeToBucketQueue,
} from '../../lib/bucketCreationQueue';
import { toFriendlyError, friendlyPermissionError, serializeError } from '../../lib/utils';
import type { TemplateTask } from '../../lib/projectTemplates';
import { applyProjectTemplate } from '../../lib/schedulingClient';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { PSS_DELAY } from '../../hooks/useProjectTaskMutations';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { ProjectTask } from '../../models/projectTask.model';
import type { ProjectBucket } from '../../models/projectBucket.model';
import type { ProjectTaskDependency } from '../../models/projectTaskDependency.model';
import type { ScheduleTaskCreate, ScheduleTaskUpdate } from '../../lib/schedulingClient';
import type { TaskAssignee, TaskTeamMember } from './TaskRow';
import { TASK_PRIORITY } from '../../lib/constants';
import type { TaskView } from '../../hooks/useUrlState';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';

interface Props {
  projectId: string;
  tasks: ProjectTask[];
  buckets: ProjectBucket[];
  dependencies: ProjectTaskDependency[];
  assignments: TaskAssignee[];
  teamMembers: TaskTeamMember[];
  onCreateTask: (params: ScheduleTaskCreate) => Promise<{ taskId?: string }>;
  onAfterCreateTask?: (params: ScheduleTaskCreate, extras: CreateTaskExtras, preAssignedTaskId?: string) => void;
  onUpdateTask: (taskId: string, subject?: string, progress?: number, scheduledStart?: string, scheduledEnd?: string, isMilestone?: boolean, effortCompleted?: number) => Promise<void>;
  onUpdateTaskFull: (params: ScheduleTaskUpdate) => Promise<void>;
  onUpdateTaskFullNoAudit?: (params: ScheduleTaskUpdate) => Promise<void>;
  onAuditTaskBatch?: (taskId: string, taskName: string, entries: import('../../hooks/useChangeAudit').ChangeAuditEntry[]) => void;
  onDeleteTask: (taskId: string, hasChildren: boolean) => Promise<void>;
  // Dependency callbacks — provided only on the custom source (Phase 0.2b).
  // On the PSS source they're omitted and the dep UI stays hidden, because
  // msdyn_PssCreateV1(dependency) fails with E_OPERATION_BLOCKED_BY_LICENSE.
  onCreateDependency?: (successorTaskId: string, predecessorTaskId: string, linkType?: number) => Promise<void>;
  onDeleteDependency?: (dependencyId: string) => Promise<void>;
  onAssign: (taskId: string, teamMemberId: string, initialHours?: number) => Promise<void>;
  onUnassign: (taskId: string, assignmentId: string) => Promise<void>;
  onTasksInvalidate: () => void;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  activeView: TaskView;
  onActiveViewChange: (view: TaskView) => void;
  canEdit: boolean;
  projectCreatedOn?: string;
  /** When true the project uses the New Resource Model (per-task contributed hours + rollups). */
  useNewResourceModel?: boolean;
  /** All pmo_taskassignment-derived assignees for this project (all tasks, not
   *  just the selected one). Lets TaskDetailPanel show each person running
   *  total across the whole project. */
  allProjectAssignees?: TaskAssignee[];
}

export function TaskWorkspace({
  projectId,
  tasks,
  buckets,
  dependencies,
  assignments,
  teamMembers,
  onCreateTask,
  onAfterCreateTask,
  onUpdateTask,
  onUpdateTaskFull,
  onUpdateTaskFullNoAudit,
  onAuditTaskBatch,
  onDeleteTask,
  onCreateDependency,
  onDeleteDependency,
  useNewResourceModel,
  allProjectAssignees,
  onAssign,
  onUnassign,
  onTasksInvalidate,
  selectedTaskId,
  onSelectTask,
  activeView,
  onActiveViewChange,
  canEdit,
  projectCreatedOn,
}: Props) {
  // Degraded-save banner (fix 2026-07-20, option C). Fires when THIS user
  // has a Pending staging row that hasn't started flushing after 60s -- the
  // signal that the FlushPlugin async step is stuck (see Tracey Gallicchio
  // incident, 2026-07-20 15:41-16:55). Silent otherwise.
  const currentUserId = useCurrentUserId();
  const showDegradedBanner = useDegradedSaveWarning(projectId, currentUserId ?? undefined);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogBucketId, setCreateDialogBucketId] = useState<string | undefined>();
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templateApplying, setTemplateApplying] = useState(false);
  // Dep-manager state (Phase 0.2b) — only reachable when depsEnabled (custom source).
  const [depManagerTaskId, setDepManagerTaskId] = useState<string | null>(null);
  const [addingPredecessor, setAddingPredecessor] = useState(false);
  const [selectedPredecessorId, setSelectedPredecessorId] = useState('');
  const [selectedLinkType, setSelectedLinkType] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const HINT_KEY = 'planTab.dragHint.dismissed.v1';
  const [dragHintDismissed, setDragHintDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  });
  const [groupBy, setGroupBy] = useState<'bucket' | 'assignee' | 'priority' | 'progress'>('bucket');
  const [showFilters, setShowFilters] = useState(false);
  const qc = useQueryClient();
  const source = useTaskSource();
  // Dependency UI is available only on the custom source, where deps write
  // direct to pmo_taskdependency (HTTP 204). On PSS it stays hidden (the
  // PssCreateV1 license gate). Gate: source is custom AND the parent wired
  // the callbacks. See Phase 0.2 / plan.md.
  const depsEnabled = usesCustomTables(source) && !!onCreateDependency && !!onDeleteDependency;
  const pendingBucketNamesRef = useRef<Set<string>>(new Set());

  // Live count of in-flight bucket creates so the "Bucket is being created…"
  // info banner shows for as long as ANY optimistic bucket is still spinning
  // on the board, and hides automatically the moment the last one lands.
  const pendingBucketCount = useSyncExternalStore(
    subscribeToBucketQueue,
    getPendingBucketCount,
    getPendingBucketCount,
  );

  // Default "General" bucket landing spinner.
  // Every new project gets an auto-created "General" bucket during
  // onboarding (ProjectOnboardingWizard / intakeAutoConvert). That create
  // runs through PSS + the msdyn->pmo mirror, so on the custom source it
  // takes a few seconds to surface in pmo_buckets. If the user opens the
  // project in that window the board would look empty, so we show a
  // spinning "General" placeholder column until it lands.
  //
  // Bounded to freshly-created projects (createdon within the grace window)
  // so deleting every bucket on an OLD project never resurrects the spinner.
  const GENERAL_BUCKET_GRACE_MS = 3 * 60 * 1000;
  const isNewProject = useMemo(() => {
    if (!projectCreatedOn) return false;
    const created = new Date(projectCreatedOn).getTime();
    if (Number.isNaN(created)) return false;
    return Date.now() - created < GENERAL_BUCKET_GRACE_MS;
  }, [projectCreatedOn]);

  const awaitingGeneralBucket =
    isNewProject && buckets.length === 0 && pendingBucketCount === 0;

  // Poll the bucket query while waiting on the auto-created General bucket
  // to land. Stops the moment a bucket appears or the grace window closes.
  useEffect(() => {
    if (!awaitingGeneralBucket) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
    }, 3000);
    return () => clearInterval(t);
  }, [awaitingGeneralBucket, qc, projectId, source]);

  const handleError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  }, []);

  function dismissDragHint() {
    setDragHintDismissed(true);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (selectedTaskId && tasks.length > 0 && !tasks.some((t) => t.msdyn_projecttaskid === selectedTaskId)) {
      onSelectTask(null);
    }
  }, [selectedTaskId, tasks, onSelectTask]);

  const visibleTasks = tasks.filter((t) => (t.msdyn_outlinelevel ?? 1) > 0);
  const leafTasks = visibleTasks.filter((t) => !t.msdyn_summary && !t.msdyn_projecttaskid.startsWith('optimistic-'));
  const totalTasks = leafTasks.length;
  const completedTasks = leafTasks.filter((t) => {
    const p = t.msdyn_progress ?? 0;
    const pct = p > 0 && p <= 1 ? p * 100 : p;
    return t.statecode === 1 || pct >= 100;
  }).length;

  const dependencyMap = useMemo(() => {
    const map = new Map<string, Array<{ depId: string; taskId: string; taskName: string; linkType: number }>>();
    for (const dep of dependencies) {
      const succId = dep['_msdyn_successortask_value'];
      const predId = dep['_msdyn_predecessortask_value'];
      if (!succId || !predId) continue;
      const predTask = tasks.find((t) => t.msdyn_projecttaskid === predId);
      const entry = { depId: dep.msdyn_projecttaskdependencyid, taskId: predId, taskName: predTask?.msdyn_subject ?? predId, linkType: dep.msdyn_linktype ?? 0 };
      const existing = map.get(succId) ?? [];
      existing.push(entry);
      map.set(succId, existing);
    }
    return map;
  }, [dependencies, tasks]);

  const { data: projectLabels = [] } = useProjectLabels(projectId);
  const { data: allTaskLabels = [] } = useProjectTaskLabels(projectId);
  const taskLabelMap = useMemo((): Map<string, TaskLabelChip[]> => {
    const map = new Map<string, TaskLabelChip[]>();
    for (const tl of allTaskLabels) {
      const taskId = tl['_msdyn_projecttaskid_value'];
      const labelId = tl['_msdyn_projectlabelid_value'];
      if (!taskId || !labelId) continue;
      const label = projectLabels.find((l) => l.msdyn_projectlabelid === labelId);
      if (!label) continue;
      const chips = map.get(taskId) ?? [];
      chips.push({ labelId, colorIndex: label.msdyn_colorindex, labelText: label.msdyn_projectlabeltext ?? '' });
      map.set(taskId, chips);
    }
    return map;
  }, [allTaskLabels, projectLabels]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, TaskAssignee[]>();
    for (const a of assignments) {
      if (!a.taskId) continue;
      const existing = map.get(a.taskId) ?? [];
      existing.push(a);
      map.set(a.taskId, existing);
    }
    return map;
  }, [assignments]);

  const normalSearch = searchTerm.trim().toLowerCase();
  const matchingIds = useMemo(() => {
    if (!normalSearch) return null;
    const matched = new Set<string>();
    for (const t of visibleTasks) {
      if (t.msdyn_subject.toLowerCase().includes(normalSearch)) matched.add(t.msdyn_projecttaskid);
    }
    for (const t of visibleTasks) {
      if (t['_msdyn_parenttask_value'] && matched.has(t.msdyn_projecttaskid)) {
        matched.add(t['_msdyn_parenttask_value']!);
      }
    }
    return matched;
  }, [visibleTasks, normalSearch]);

  const searchFiltered = matchingIds ? visibleTasks.filter((t) => matchingIds.has(t.msdyn_projecttaskid)) : visibleTasks;

  const displayTasks = useMemo(() => {
    const noFiltersActive =
      filters.assigneeIds.length === 0 &&
      filters.priorities.length === 0 &&
      filters.progressStates.length === 0 &&
      filters.dueDateRange === 'all' &&
      filters.labelIds.length === 0;
    if (noFiltersActive) return searchFiltered;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const matchedLeaves = searchFiltered.filter((t) => {
      if (t.msdyn_summary || t.msdyn_projecttaskid.startsWith('optimistic-')) return false;

      if (filters.assigneeIds.length > 0) {
        const taskAssignees = assignmentMap.get(t.msdyn_projecttaskid) ?? [];
        if (!taskAssignees.some((a) => filters.assigneeIds.includes(a.teamMemberId))) return false;
      }

      if (filters.priorities.length > 0) {
        if (!filters.priorities.includes(t.msdyn_priority ?? 5)) return false;
      }

      if (filters.progressStates.length > 0) {
        const raw = t.msdyn_progress ?? 0;
        const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
        const isDone = t.statecode === 1 || pct >= 100;
        const isStarted = pct > 0;
        const matches =
          (filters.progressStates.includes('complete') && isDone) ||
          (filters.progressStates.includes('in_progress') && isStarted && !isDone) ||
          (filters.progressStates.includes('not_started') && !isStarted && !isDone);
        if (!matches) return false;
      }

      if (filters.dueDateRange !== 'all') {
        const due = t.msdyn_scheduledend ?? t.msdyn_finish;
        if (!due) return false;
        const dueDate = new Date(due); dueDate.setHours(0, 0, 0, 0);
        if (filters.dueDateRange === 'overdue' && !(dueDate < today)) return false;
        if (filters.dueDateRange === 'this_week' && !(dueDate >= today && dueDate <= weekEnd)) return false;
        if (filters.dueDateRange === 'this_month' && !(dueDate >= today && dueDate <= monthEnd)) return false;
      }

      if (filters.labelIds.length > 0) {
        const chips = taskLabelMap.get(t.msdyn_projecttaskid) ?? [];
        if (!chips.some((c) => filters.labelIds.includes(c.labelId))) return false;
      }

      return true;
    });

    const matchedIds = new Set(matchedLeaves.map((t) => t.msdyn_projecttaskid));
    const ancestorIds = new Set<string>();
    for (const t of matchedLeaves) {
      let parentId = t['_msdyn_parenttask_value'] ?? null;
      while (parentId && !ancestorIds.has(parentId)) {
        ancestorIds.add(parentId);
        const parent = searchFiltered.find((p) => p.msdyn_projecttaskid === parentId);
        parentId = parent?.['_msdyn_parenttask_value'] ?? null;
      }
    }

    return searchFiltered.filter((t) => matchedIds.has(t.msdyn_projecttaskid) || ancestorIds.has(t.msdyn_projecttaskid));
  }, [searchFiltered, filters, assignmentMap, taskLabelMap]);

  const unassignedTasks = displayTasks.filter((t) => !t['_msdyn_projectbucket_value']);
  const selectedTask = selectedTaskId ? (tasks.find((t) => t.msdyn_projecttaskid === selectedTaskId) ?? null) : null;
  const selectedTaskAssignees = selectedTaskId ? (assignmentMap.get(selectedTaskId) ?? []) : [];
  const selectedTaskPredecessors = selectedTaskId ? (dependencyMap.get(selectedTaskId) ?? []) : [];
  const selectedTaskHasChildren = selectedTaskId ? tasks.some((t) => t['_msdyn_parenttask_value'] === selectedTaskId) : false;

  const boardGroups = useMemo((): Array<{ key: string; name: string; tasks: ProjectTask[] }> | null => {
    if (groupBy === 'bucket') return null;

    if (groupBy === 'priority') {
      const groups = [
        { key: 'urgent', name: 'Urgent', value: TASK_PRIORITY.Urgent },
        { key: 'important', name: 'Important', value: TASK_PRIORITY.Important },
        { key: 'medium', name: 'Medium', value: TASK_PRIORITY.Medium },
        { key: 'low', name: 'Low', value: TASK_PRIORITY.Low },
      ];
      return groups.map(({ key, name, value }) => ({ key, name, tasks: displayTasks.filter((t) => (t.msdyn_priority ?? TASK_PRIORITY.Medium) === value) })).filter((g) => g.tasks.length > 0);
    }

    if (groupBy === 'assignee') {
      const groupMap = new Map<string, { name: string; tasks: ProjectTask[] }>();
      groupMap.set('__none', { name: 'Unassigned', tasks: [] });
      for (const tm of teamMembers) groupMap.set(tm.id, { name: tm.name, tasks: [] });
      for (const t of displayTasks) {
        const taskAssignees = assignmentMap.get(t.msdyn_projecttaskid) ?? [];
        if (taskAssignees.length === 0) groupMap.get('__none')!.tasks.push(t);
        else for (const a of taskAssignees) groupMap.get(a.teamMemberId)?.tasks.push(t);
      }
      return Array.from(groupMap.entries()).map(([key, { name, tasks }]) => ({ key, name, tasks })).filter((g) => g.tasks.length > 0);
    }

    if (groupBy === 'progress') {
      const isPct = (t: ProjectTask) => { const r = t.msdyn_progress ?? 0; return r > 0 && r <= 1 ? r * 100 : r; };
      return [
        { key: 'not_started', name: 'Not started', tasks: displayTasks.filter((t) => !t.msdyn_summary && isPct(t) === 0 && t.statecode !== 1) },
        { key: 'in_progress', name: 'In progress', tasks: displayTasks.filter((t) => !t.msdyn_summary && isPct(t) > 0 && isPct(t) < 100 && t.statecode !== 1) },
        { key: 'complete', name: 'Complete', tasks: displayTasks.filter((t) => !t.msdyn_summary && (t.statecode === 1 || isPct(t) >= 100)) },
      ].filter((g) => g.tasks.length > 0);
    }

    return null;
  }, [groupBy, displayTasks, assignmentMap, teamMembers]);

  const handleMoveTaskToBucket = useCallback((taskId: string, targetBucketId: string) => {
    const task = tasks.find((t) => t.msdyn_projecttaskid === taskId);
    if (!task || task['_msdyn_projectbucket_value'] === targetBucketId) return;
    onUpdateTaskFull({ taskId, bucketId: targetBucketId });
  }, [tasks, onUpdateTaskFull]);

  const reorderBucketsMutation = useReorderProjectBuckets(projectId);
  // Holds a reorder that was dropped on a still-creating bucket. Its id is a
  // client 'optimistic-<ts>' placeholder with no server row yet, so we can't
  // PATCH it. We stash the intent here and the effect below applies it once
  // the create settles and the real GUID appears (2026-07-28). Last drag
  // wins -- a single pending intent is enough for this workflow.
  const pendingBucketReorderRef = useRef<{ optimisticId: string; orderedIds: string[]; knownRealIds: Set<string> } | null>(null);
  const handleReorderBucket = useCallback((draggedBucketId: string, targetBucketId: string) => {
    // Compute the new ordered list: pull the dragged bucket out of its
    // current slot and insert it immediately BEFORE the target bucket.
    // Matches operator's ask: "drag a bucket to the left of General
    // and General slides one space to the right."
    const sorted = [...buckets].sort((a, b) => {
      const oa = getBucketOrder(a); const ob = getBucketOrder(b);
      if (oa !== ob) return oa - ob;
      return (a.createdon ?? '').localeCompare(b.createdon ?? '');
    });
    const ids = sorted.map((b) => b.msdyn_projectbucketid);
    const from = ids.indexOf(draggedBucketId);
    const to = ids.indexOf(targetBucketId);
    if (from < 0 || to < 0 || from === to) return;
    // Drop semantics depend on drag direction:
    //   - Dragging LEFT (from > to)   -> insert BEFORE target
    //   - Dragging RIGHT (from < to)  -> insert AFTER  target
    // This matches how every other Kanban board handles bucket drag
    // (users think of the target as a landing spot on the correct
    // side of the dragged bucket). Operator report 2026-07-18:
    // right-drag was snapping back because we always inserted BEFORE.
    //
    // Index math after the splice-out:
    //   from < to (right-drag, insert AFTER target): target moved
    //     down one, so its new index is (to - 1); insert AFTER means
    //     (to - 1) + 1 = to.
    //   from > to (left-drag, insert BEFORE target): target didn't
    //     move, insert BEFORE means insertAt = to.
    // Both branches collapse to insertAt = to. Nice.
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, draggedBucketId);
    if (next.every((id, i) => id === ids[i])) return;
    // Dropped bucket is still being created: defer. Record the target order
    // plus the real bucket ids known RIGHT NOW so the effect can spot the
    // freshly-created row (the one id it didn't know about) once it lands.
    if (draggedBucketId.startsWith('optimistic-')) {
      pendingBucketReorderRef.current = {
        optimisticId: draggedBucketId,
        orderedIds: next,
        knownRealIds: new Set(ids.filter((id) => !id.startsWith('optimistic-'))),
      };
      return;
    }
    reorderBucketsMutation.mutate({ orderedIds: next });
  }, [buckets, reorderBucketsMutation]);

  // Apply a deferred reorder once the still-creating bucket's real GUID lands.
  // Runs whenever the bucket list changes (the post-create invalidate refetch
  // is what surfaces the real row).
  useEffect(() => {
    const pending = pendingBucketReorderRef.current;
    if (!pending) return;
    const res = resolveDeferredReorder({
      orderedIds: pending.orderedIds,
      optimisticId: pending.optimisticId,
      buckets,
      knownRealIds: pending.knownRealIds,
    });
    if (res.status === 'wait') return;
    pendingBucketReorderRef.current = null;
    if (res.status === 'ready') {
      reorderBucketsMutation.mutate({ orderedIds: res.orderedIds });
    }
    // 'abandon' -> just clear; the create failed/cancelled or we couldn't
    // uniquely identify the new row.
  }, [buckets, reorderBucketsMutation]);

  // Delete-while-spinning. `cancelBucketCreate` only stops a create that
  // hasn't begun its PSS round-trip; an in-flight create (the usual case --
  // PSS takes ~15s) finishes server-side anyway and the post-create refetch
  // brings the row back. So we cancel (best-effort) AND record a delete
  // intent; the effect below deletes the real row once its GUID lands.
  // We intentionally do NOT drop the optimistic row from cache here: keeping
  // it lets resolveDeferredDelete correlate the new GUID, and it disappears
  // when the real delete completes (2026-07-28).
  const deleteBucketMutation = useDeleteProjectBucket(projectId);
  const pendingBucketDeletesRef = useRef<Array<{ optimisticId: string; knownRealIds: Set<string> }>>([]);
  const handleDeleteOptimisticBucket = useCallback((optimisticId: string) => {
    cancelBucketCreate(optimisticId);
    const knownRealIds = new Set(
      buckets.map((b) => b.msdyn_projectbucketid).filter((id) => !id.startsWith('optimistic-')),
    );
    pendingBucketDeletesRef.current.push({ optimisticId, knownRealIds });
    // A delete supersedes any queued reorder for the same in-flight bucket.
    if (pendingBucketReorderRef.current?.optimisticId === optimisticId) {
      pendingBucketReorderRef.current = null;
    }
  }, [buckets]);

  useEffect(() => {
    if (pendingBucketDeletesRef.current.length === 0) return;
    const stillPending: Array<{ optimisticId: string; knownRealIds: Set<string> }> = [];
    for (const intent of pendingBucketDeletesRef.current) {
      const res = resolveDeferredDelete(buckets, intent.optimisticId, intent.knownRealIds);
      if (res.status === 'wait') {
        stillPending.push(intent);
      } else if (res.status === 'delete') {
        deleteBucketMutation.mutate(res.realId);
      }
      // 'noop' -> cancel won the race; nothing to delete, drop the intent.
    }
    pendingBucketDeletesRef.current = stillPending;
  }, [buckets, deleteBucketMutation]);

  const dragEnabled = activeView === 'board' && groupBy === 'bucket' && canEdit;


  async function applyTemplateTasks(tTasks: TemplateTask[]) {
    if (!tTasks || tTasks.length === 0) return;
    setTemplateApplying(true);
    try {
      if (usesCustomTables(source)) {
        // Option-C custom path: create each template task directly on pmo_task.
        // Each createCustomTask is synchronous (real GUID), so there's no PSS
        // OperationSet + 50s PSS_DELAY.TEMPLATE wait. Templates carry only
        // subject + isMilestone (+ a duration hint with no dates); the custom
        // create leaves pmo_duration unset when there are no start/due dates,
        // matching the app's normal custom-create behavior.
        for (const t of tTasks) {
          await createCustomTask({ projectId, subject: t.subject, isMilestone: t.isMilestone });
        }
        onTasksInvalidate();
      } else {
        await applyProjectTemplate(projectId, tTasks);
        await new Promise((r) => setTimeout(r, PSS_DELAY.TEMPLATE));
        onTasksInvalidate();
      }
    } catch (err) {
      handleError(`Failed to apply template: ${toFriendlyError(err)}`);
    } finally {
      setTemplateApplying(false);
    }
  }

  function openCreateDialog(bucketId?: string) {
    setCreateDialogBucketId(bucketId);
    setCreateDialogOpen(true);
  }

  async function handleAddBucket() {
    // Name the new bucket after the highest existing 'Bucket N' index
    // (across BOTH persisted rows AND in-flight optimistic rows we've
    // already enqueued this session). Using `buckets.length + 1` was
    // brittle: when the user double-clicked Create Bucket, the first
    // optimistic might not yet be reflected in the cached array by the
    // time the second handler ran, so both attempts computed the same
    // name and the intent-key dedupe rejected the second with a false
    // "already being created" error. Counting existing 'Bucket N'
    // indices instead makes the numbering monotonically increasing
    // regardless of what the cache happens to hold at click time.
    const bucketNumRe = /^Bucket (\d+)$/;
    let highest = 0;
    for (const b of buckets) {
      const m = bucketNumRe.exec((b.msdyn_name ?? '').trim());
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }
    // Also account for names in-flight but not yet in the cached list
    // (rare, but possible in the millisecond between enqueue and cache
    // update). pendingBucketNamesRef stores '<projectId>::bucket N'
    // lowercased -- strip the prefix and re-parse.
    const pendingPrefix = `${projectId}::`;
    for (const key of pendingBucketNamesRef.current) {
      if (!key.startsWith(pendingPrefix)) continue;
      const bare = key.slice(pendingPrefix.length);
      const m = /^bucket (\d+)$/.exec(bare);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > highest) highest = n;
      }
    }
    const name = `Bucket ${highest + 1}`;
    const intentKey = `${projectId}::${name.trim().toLowerCase()}`;
    if (pendingBucketNamesRef.current.has(intentKey)) {
      // Should be unreachable now that we count pending entries, but
      // keep the guard as a belt-and-suspenders defense.
      handleError(`"${name}" is already being created.`);
      return;
    }

    const lastOrder = buckets[buckets.length - 1]?.msdyn_displayorder ?? 0;
    const displayOrder = lastOrder + 1000;
    const optimisticId = `optimistic-${Date.now()}`;

    pendingBucketNamesRef.current.add(intentKey);
    await qc.cancelQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });

    qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) => [
      ...(old ?? []),
      { msdyn_projectbucketid: optimisticId, msdyn_name: name, msdyn_displayorder: displayOrder, statecode: 0, '_msdyn_project_value': projectId },
    ]);

    if (usesCustomTables(source)) {
      // Option-C custom path: direct OData create on pmo_bucket. dv.create
      // returns the real GUID synchronously, so there is no PSS placeholder
      // window — skip enqueueBucketCreate / PSS_DELAY / pendingBucketNamesRef
      // (that machinery exists only to survive PSS's async commit). The
      // optimistic row shows instantly; the invalidate swaps in the real row.
      try {
        await createCustomBucket(projectId, name, displayOrder);
      } catch (err) {
        const raw = serializeError(err);
        if (friendlyPermissionError(raw) !== null) {
          qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
            old ? old.filter((b) => b.msdyn_projectbucketid !== optimisticId) : old,
          );
        }
        handleError(`Failed to create bucket: ${toFriendlyError(err)}`);
      } finally {
        pendingBucketNamesRef.current.delete(intentKey);
        qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) });
      }
      return;
    }

    enqueueBucketCreate(
      optimisticId,
      () => createProjectBucket(projectId, name, displayOrder)
        .then(() => new Promise<void>((r) => setTimeout(r, PSS_DELAY.BUCKET)))
        .catch((err) => {
          const raw = serializeError(err);
          const isPermError = friendlyPermissionError(raw) !== null;
          if (isPermError) {
            // Server rejected the create outright. No reconciliation will
            // ever replace this optimistic entry — leaving it in place shows
            // a bucket that spins forever under a permission-denied banner.
            // Cancel the queue slot and remove the ghost from the cache so
            // the board matches what the server actually has.
            cancelBucketCreate(optimisticId);
            qc.setQueryData<ProjectBucket[]>(BUCKET_KEYS.forProject(projectId, source), (old) =>
              old ? old.filter((b) => b.msdyn_projectbucketid !== optimisticId) : old,
            );
          }
          // Whether permission or transient PSS timeout, tell the user what
          // happened. For transient timeouts the bucket may still land after
          // the ~20s PSS delay; we intentionally keep the optimistic in
          // place in that case (the final invalidateQueries reconciles it).
          handleError(`Failed to create bucket: ${toFriendlyError(err)}`);
        })
        .finally(() => {
          pendingBucketNamesRef.current.delete(intentKey);
        }),
      () => qc.invalidateQueries({ queryKey: BUCKET_KEYS.forProject(projectId, source) }),
    );
  }

  // Dep-manager derived state + handlers (Phase 0.2b). Reachable only when
  // depsEnabled (custom source + callbacks wired).
  const depManagerTask = depManagerTaskId ? tasks.find((t) => t.msdyn_projecttaskid === depManagerTaskId) : null;
  const depManagerPredecessors = depManagerTaskId ? (dependencyMap.get(depManagerTaskId) ?? []) : [];
  const availablePredecessors = tasks.filter((t) => !t.msdyn_summary && t.msdyn_projecttaskid !== depManagerTaskId && !t.msdyn_projecttaskid.startsWith('optimistic-') && !depManagerPredecessors.some((p) => p.taskId === t.msdyn_projecttaskid));

  async function handleAddPredecessor() {
    if (!depManagerTaskId || !selectedPredecessorId || !onCreateDependency) return;
    setAddingPredecessor(true);
    try {
      await onCreateDependency(depManagerTaskId, selectedPredecessorId, selectedLinkType);
      setSelectedPredecessorId('');
    } catch (err) {
      handleError(`Failed to add dependency: ${toFriendlyError(err)}`);
    } finally {
      setAddingPredecessor(false);
    }
  }

  async function handleRemovePredecessor(depId: string) {
    if (!onDeleteDependency) return;
    try {
      await onDeleteDependency(depId);
    } catch (err) {
      handleError(`Failed to remove dependency: ${toFriendlyError(err)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground shrink-0">{totalTasks} task{totalTasks !== 1 ? 's' : ''} · {completedTasks} completed</p>
        <div className="relative flex-1 max-w-xs min-w-[160px]"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" /><input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search tasks…" className="w-full pl-8 pr-3 h-8 text-xs bg-muted/30 border border-border rounded-md outline-none focus:border-primary transition-colors" />{searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>}</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden"><button onClick={() => onActiveViewChange('board')} className={`px-2 py-1.5 text-xs flex items-center gap-1 transition-colors ${activeView === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><LayoutGrid className="h-3.5 w-3.5" /> Board</button><button onClick={() => onActiveViewChange('list')} className={`px-2 py-1.5 text-xs flex items-center gap-1 transition-colors ${activeView === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><List className="h-3.5 w-3.5" /> List</button><button onClick={() => onActiveViewChange('timeline')} className={`px-2 py-1.5 text-xs flex items-center gap-1 transition-colors ${activeView === 'timeline' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><GanttChart className="h-3.5 w-3.5" /> Timeline</button><button onClick={() => onActiveViewChange('charts')} className={`px-2 py-1.5 text-xs flex items-center gap-1 transition-colors ${activeView === 'charts' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><BarChart3 className="h-3.5 w-3.5" /> Charts</button><button onClick={() => onActiveViewChange('people')} className={`px-2 py-1.5 text-xs flex items-center gap-1 transition-colors ${activeView === 'people' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Users className="h-3.5 w-3.5" /> People</button></div>
          {activeView === 'board' && <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="text-xs border border-border rounded px-2 py-1 bg-muted/20 outline-none focus:border-primary h-8" title="Group by"><option value="bucket">Group: Bucket</option><option value="assignee">Group: Assignee</option><option value="priority">Group: Priority</option><option value="progress">Group: Progress</option></select>}
          <Button size="sm" variant={showFilters || hasActiveFilters(filters) ? 'default' : 'outline'} onClick={() => setShowFilters((v) => !v)} className={hasActiveFilters(filters) ? 'ring-2 ring-primary/40' : ''}><SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />Filters{hasActiveFilters(filters) ? ' •' : ''}</Button>
          <Button size="sm" variant="outline" onClick={() => setTemplateChooserOpen(true)} disabled={templateApplying || !canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}><LayoutTemplate className="h-3.5 w-3.5 mr-1.5" />Apply Template</Button>
          <Button size="sm" onClick={() => openCreateDialog()} disabled={!canEdit} title={!canEdit ? READ_ONLY_TOOLTIP : undefined}><Plus className="h-3.5 w-3.5 mr-1.5" />New Task</Button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError(null)} className="shrink-0 hover:opacity-70"><X className="h-3.5 w-3.5" /></button></div>}
      {showDegradedBanner && <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="flex-1"><strong>Saves are taking longer than usual.</strong> Your recent changes are preserved but the background save service is running slowly. IT has been notified — refreshing this page won't help, please wait a moment or try again shortly.</span></div>}
      {pendingBucketCount > 0 && <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /><span className="flex-1">{pendingBucketCount === 1 ? 'Bucket is being created — usually takes about 15 seconds.' : `${pendingBucketCount} buckets are being created — usually takes about 15 seconds each.`}</span></div>}
      {templateApplying && <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />{usesCustomTables(source) ? 'Applying template…' : 'Applying template… PSS takes ~25s to persist changes'}</div>}
      {showFilters && <div className="rounded-lg border border-border bg-muted/20 px-3 py-2"><TaskFilterBar filters={filters} teamMembers={teamMembers} assignments={assignments} projectLabels={projectLabels} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} /></div>}
      {activeView === 'list' && <TaskListView tasks={displayTasks.filter((t) => !t.msdyn_summary || displayTasks.some((c) => c['_msdyn_parenttask_value'] === t.msdyn_projecttaskid))} assignmentMap={assignmentMap} onSelectTask={onSelectTask} projectId={projectId} canEdit={canEdit} useNewResourceModel={useNewResourceModel} />}
      {activeView === 'timeline' && <TaskTimelineView tasks={displayTasks} dependencies={dependencies} onSelectTask={onSelectTask} projectId={projectId} canEdit={canEdit} />}
      {activeView === 'charts' && <TaskChartsView tasks={visibleTasks} buckets={buckets} />}
      {activeView === 'people' && <TaskPeopleView tasks={visibleTasks} assignments={assignments} teamMembers={teamMembers} buckets={buckets} projectId={projectId} canEdit={canEdit} useNewResourceModel={useNewResourceModel} />}
      {activeView === 'board' && !dragHintDismissed && <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"><span className="font-medium">Tip:</span><span className="flex-1">Drag tasks between buckets to organize work. Use <span className="font-medium">+ New bucket</span> on the right to create more.</span><button type="button" onClick={dismissDragHint} className="text-blue-700 hover:text-blue-900" aria-label="Dismiss tip" title="Dismiss"><X className="h-3.5 w-3.5" /></button></div>}
      {activeView === 'board' && <div className="flex gap-3 overflow-x-auto pb-4">{awaitingGeneralBucket && <div className="flex-shrink-0 w-60 flex flex-col rounded-xl border border-border bg-muted/20 overflow-hidden"><div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card/50"><div className="flex items-center gap-1.5 min-w-0"><Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" /><h4 className="text-xs font-semibold text-foreground truncate">General</h4></div></div><div className="px-3 py-4 text-[11px] text-muted-foreground">Setting up your first bucket…</div></div>}{boardGroups ? boardGroups.map((group) => <BucketSection key={group.key} projectId={projectId} bucket={null} groupDisplayName={group.name} tasks={group.tasks} dependencyMap={dependencyMap} assignmentMap={assignmentMap} taskLabelMap={taskLabelMap} teamMembers={teamMembers} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} onOpenCreateDialog={() => openCreateDialog(undefined)} onManageDependencies={depsEnabled ? setDepManagerTaskId : undefined} onAssign={onAssign} onUnassign={onUnassign} onError={handleError} onSelectTask={onSelectTask} forceExpandCompleted={filters.progressStates.includes('complete')} canEdit={canEdit} useNewResourceModel={useNewResourceModel} />) : <>{unassignedTasks.length > 0 && <BucketSection projectId={projectId} bucket={null} tasks={unassignedTasks} dependencyMap={dependencyMap} assignmentMap={assignmentMap} taskLabelMap={taskLabelMap} teamMembers={teamMembers} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} onOpenCreateDialog={() => openCreateDialog(undefined)} onManageDependencies={depsEnabled ? setDepManagerTaskId : undefined} onAssign={onAssign} onUnassign={onUnassign} onError={handleError} onSelectTask={onSelectTask} forceExpandCompleted={filters.progressStates.includes('complete')} enableDrag={dragEnabled} canEdit={canEdit} useNewResourceModel={useNewResourceModel} />}{buckets.map((bucket) => <BucketSection key={bucket.msdyn_projectbucketid} projectId={projectId} bucket={bucket} tasks={displayTasks.filter((t) => t['_msdyn_projectbucket_value'] === bucket.msdyn_projectbucketid)} dependencyMap={dependencyMap} assignmentMap={assignmentMap} taskLabelMap={taskLabelMap} teamMembers={teamMembers} onCreateTask={onCreateTask} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} onOpenCreateDialog={() => openCreateDialog(bucket.msdyn_projectbucketid)} onManageDependencies={depsEnabled ? setDepManagerTaskId : undefined} onAssign={onAssign} onUnassign={onUnassign} onError={handleError} onSelectTask={onSelectTask} forceExpandCompleted={filters.progressStates.includes('complete')} onMoveTaskToBucket={handleMoveTaskToBucket} onReorderBucket={handleReorderBucket} onDeleteOptimisticBucket={handleDeleteOptimisticBucket} enableDrag={dragEnabled} canEdit={canEdit} useNewResourceModel={useNewResourceModel} />)}<div className="flex-shrink-0 flex items-start pt-2"><button onClick={handleAddBucket} disabled={!canEdit} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border-2 border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title={!canEdit ? READ_ONLY_TOOLTIP : 'Create a new bucket to group related tasks'}><Plus className="h-4 w-4" /><span>New bucket</span></button></div></>}</div>}

      <CreateTaskDialog open={createDialogOpen} projectId={projectId} buckets={buckets} defaultBucketId={createDialogBucketId} tasks={visibleTasks} teamMembers={teamMembers} onCreateTask={onCreateTask} onAfterCreate={onAfterCreateTask} onError={handleError} onClose={() => setCreateDialogOpen(false)} />
      <ApplyTemplateDialog
        open={templateChooserOpen}
        onClose={() => setTemplateChooserOpen(false)}
        applying={templateApplying}
        boardTasks={visibleTasks.map((t) => ({ subject: t.msdyn_subject, isMilestone: !!t.msdyn_ismilestone }))}
        onApply={async (tasks) => { await applyTemplateTasks(tasks); setTemplateChooserOpen(false); }}
      />
      {selectedTask && <TaskDetailPanel task={selectedTask} projectId={projectId} hasChildren={selectedTaskHasChildren} predecessors={selectedTaskPredecessors} assignees={selectedTaskAssignees} teamMembers={teamMembers} onClose={() => onSelectTask(null)} onUpdate={onUpdateTaskFullNoAudit ?? onUpdateTaskFull} onAuditBatch={onAuditTaskBatch} onDelete={onDeleteTask} onAssign={onAssign} onUnassign={onUnassign} onManageDependencies={depsEnabled ? () => setDepManagerTaskId(selectedTask.msdyn_projecttaskid) : undefined} onError={handleError} onTasksInvalidate={onTasksInvalidate} canEdit={canEdit} useNewResourceModel={useNewResourceModel} allProjectAssignees={allProjectAssignees} />}
      {/* Dependencies dialog (Phase 0.2b) — only reachable on the custom source (depsEnabled). */}
      {depsEnabled && <Dialog open={!!depManagerTaskId} onOpenChange={(o) => { if (!o) setDepManagerTaskId(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Dependencies</DialogTitle><DialogDescription>{depManagerTask ? depManagerTask.msdyn_subject.length > 55 ? `${depManagerTask.msdyn_subject.slice(0, 55)}…` : depManagerTask.msdyn_subject : ''}</DialogDescription></DialogHeader><div className="space-y-4 py-1 max-h-80 overflow-y-auto">{depManagerPredecessors.length > 0 ? <div className="space-y-2"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Predecessors</p>{depManagerPredecessors.map((pred) => { const lt = ['FS','FF','SS','SF'][pred.linkType] ?? 'FS'; return <div key={pred.depId} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"><div className="flex items-center gap-2 min-w-0"><Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span className="truncate text-xs">{pred.taskName}</span><span className="text-[10px] font-medium px-1 rounded bg-muted text-muted-foreground shrink-0">{lt}</span></div><button onClick={() => handleRemovePredecessor(pred.depId)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button></div>; })}</div> : <p className="text-xs text-muted-foreground">No predecessors defined.</p>}{availablePredecessors.length > 0 && <div className="space-y-2 border-t border-border pt-4"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Add Predecessor</p><div className="flex gap-2"><Select value={selectedPredecessorId} onValueChange={setSelectedPredecessorId}><SelectTrigger className="flex-1 h-9 text-sm"><SelectValue placeholder="— Select task —" /></SelectTrigger><SelectContent>{availablePredecessors.map((t) => <SelectItem key={t.msdyn_projecttaskid} value={t.msdyn_projecttaskid}>{t.msdyn_subject}</SelectItem>)}</SelectContent></Select><select value={selectedLinkType} onChange={(e) => setSelectedLinkType(Number(e.target.value))} className="text-xs border border-border rounded px-2 h-9 bg-muted/20 outline-none focus:border-primary" title="Link type"><option value={0}>FS</option><option value={1}>FF</option><option value={2}>SS</option><option value={3}>SF</option></select><Button size="sm" disabled={!selectedPredecessorId || addingPredecessor} onClick={handleAddPredecessor}>{addingPredecessor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}</Button></div></div>}</div><DialogFooter><Button variant="outline" onClick={() => setDepManagerTaskId(null)}>Close</Button></DialogFooter></DialogContent></Dialog>}
    </div>
  );
}
