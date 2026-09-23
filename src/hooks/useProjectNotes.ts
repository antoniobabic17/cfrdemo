/**
 * React Query hooks for the project / task notes feature.
 *
 * Mirrors useProjectChecklists / useProjectLabels in shape: one read hook
 * per scope, three mutation hooks (create / update / delete) keyed by the
 * parent entity. After every successful mutation we invalidate both the
 * direct scope query AND the project rollup query so a task-note write
 * shows up immediately on the project's Notes tab too.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppMutation } from './useAppMutation';
import {
  listProjectNotes,
  listTaskNotes,
  listNotesForTasks,
  listFeedbackNotes,
  listLatestNotesForProjects,
  createNote,
  updateNote,
  deleteNote,
  type ProjectNote,
  type NoteCreateInput,
  type NoteUpdateInput,
} from '../api/projectNotes.api';
import { splitNoteMeta, joinNoteMeta, toggleNoteReaction } from '../lib/noteEnvelope';
import { touchCustomProject } from '../api/customProjects.api';

const KEYS = {
  project:        (projectId: string) => ['notes', 'project', projectId] as const,
  task:           (taskId: string) => ['notes', 'task', taskId] as const,
  feedback:       (feedbackId: string) => ['notes', 'feedback', feedbackId] as const,
  projectRollup:  (projectId: string) => ['notes', 'projectRollup', projectId] as const,
  latestForProjects: () => ['notes', 'latestForProjects'] as const,
};

export function useProjectNotes(projectId: string | undefined, projectTypeCode: 'msdyn_project' | 'pmo_project' = 'msdyn_project') {
  return useQuery<ProjectNote[]>({
    queryKey: [...KEYS.project(projectId ?? ''), projectTypeCode],
    queryFn: () => listProjectNotes(projectId!, projectTypeCode),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useTaskNotes(
  taskId: string | undefined,
  taskTypeCode: 'msdyn_projecttask' | 'pmo_task' = 'msdyn_projecttask',
) {
  return useQuery<ProjectNote[]>({
    queryKey: [...KEYS.task(taskId ?? ''), taskTypeCode],
    queryFn: () => listTaskNotes(taskId!, taskTypeCode),
    enabled: !!taskId,
    staleTime: 30 * 1000,
  });
}

/** Admin-response notes for a feedback record (annotation-backed, like project
 *  notes). Feeds the User Feedback detail page's response thread. */
export function useFeedbackNotes(feedbackId: string | undefined) {
  return useQuery<ProjectNote[]>({
    queryKey: [...KEYS.feedback(feedbackId ?? '')],
    queryFn: () => listFeedbackNotes(feedbackId!),
    enabled: !!feedbackId,
    staleTime: 30 * 1000,
  });
}

/**
 * Roll-up reader for the project Notes tab — every note attached to any
 * task in the supplied id list. Hook returns an empty list when no task
 * ids are provided, so callers can pass [] freely while tasks are still
 * loading.
 */
export function useTaskNotesRollup(
  projectId: string | undefined,
  taskIds: string[],
  taskTypeCode: 'msdyn_projecttask' | 'pmo_task' = 'msdyn_projecttask',
) {
  // Stable cache key that reflects the actual id set.
  const sortedKey = taskIds.slice().sort().join(',');
  return useQuery<ProjectNote[]>({
    queryKey: [...KEYS.projectRollup(projectId ?? ''), taskTypeCode, sortedKey],
    queryFn: () => listNotesForTasks(taskIds, taskTypeCode),
    enabled: !!projectId,
    staleTime: 30 * 1000,
  });
}

/**
 * Latest note per project for the Projects grid "Last Note" column.
 * LAZY: `enabled` gates the fetch so it only runs when the column is actually
 * active in the current view — the default projects grid pays nothing. Returns
 * a Map keyed by project id (_objectid_value).
 */
export function useLatestProjectNotes(
  projectIds: string[],
  projectTypeCode: 'msdyn_project' | 'pmo_project',
  enabled: boolean,
) {
  const sortedKey = projectIds.slice().sort().join(',');
  return useQuery<Map<string, ProjectNote>>({
    queryKey: [...KEYS.latestForProjects(), projectTypeCode, sortedKey],
    queryFn: () => listLatestNotesForProjects(projectIds, projectTypeCode),
    enabled: enabled && projectIds.length > 0,
    staleTime: 30 * 1000,
  });
}

/** Extra (optional) fields the composer can pass so the optimistic note row
 *  renders with a real author byline before the server round-trips. */
export interface NoteCreateVars extends NoteCreateInput {
  /** systemuserid of the author (current user), for the optimistic row. */
  authorId?: string;
  /** Display name of the author, for the optimistic byline. */
  authorName?: string;
}

interface CreateNoteCtx {
  snapshots: [readonly unknown[], ProjectNote[] | undefined][];
  tempId: string;
}

/**
 * Create a note. OPTIMISTIC: the note is inserted into every relevant cached
 * notes query immediately (onMutate) so it appears instantly and the composer
 * can close without waiting on the Dataverse round-trip. We reconcile on
 * settle (invalidate) and roll back on error. This removes the multi-second
 * "spinning Save button" the synchronous path had.
 */
export function useCreateNote(_projectId: string, touchProjectId?: string) {
  const qc = useQueryClient();
  return useAppMutation<NoteCreateVars, ProjectNote, CreateNoteCtx>({
    action: 'create note',
    mutationFn: (input) => createNote(input),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const tempId = `optimistic-note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();
      const objectType =
        vars.parentEntitySet === 'msdyn_projects' ? 'msdyn_project'
        : vars.parentEntitySet === 'pmo_projects' ? 'pmo_project'
        : vars.parentEntitySet === 'pmo_tasks' ? 'pmo_task'
        : vars.parentEntitySet === 'pmo_userfeedbacks' ? 'pmo_userfeedback'
        : 'msdyn_projecttask';
      const optimistic: ProjectNote = {
        annotationid: tempId,
        subject: vars.title,
        notetext: vars.body,
        createdon: nowIso,
        modifiedon: nowIso,
        '_objectid_value': vars.parentId,
        objecttypecode: objectType,
        '_createdby_value': vars.authorId,
        '_createdby_value@OData.Community.Display.V1.FormattedValue': vars.authorName ?? 'You',
      };
      const snapshots = qc.getQueriesData<ProjectNote[]>({ queryKey: ['notes'] });
      for (const [key, data] of snapshots) {
        // Match the note to the query it belongs in:
        //  - project scope → the ['notes','project',projectId] query
        //  - task scope    → the task query AND any project rollup query
        const k = key as unknown[];
        const kind = k[1];
        const isProjectScope = vars.parentEntitySet === 'msdyn_projects' || vars.parentEntitySet === 'pmo_projects';
        const isFeedbackScope = vars.parentEntitySet === 'pmo_userfeedbacks';
        const belongs =
          (isFeedbackScope && kind === 'feedback' && k[2] === vars.parentId) ||
          (!isFeedbackScope && isProjectScope && kind === 'project' && k[2] === vars.parentId) ||
          (!isFeedbackScope && !isProjectScope && kind === 'task' && k[2] === vars.parentId) ||
          (!isFeedbackScope && !isProjectScope && kind === 'projectRollup');
        if (!belongs) continue;
        qc.setQueryData<ProjectNote[]>(key, [optimistic, ...(data ?? [])]);
      }
      return { snapshots, tempId };
    },
    onError: (_err, _vars, context) => {
      if (!context?.snapshots) return;
      for (const [key, data] of context.snapshots) qc.setQueryData(key, data);
    },
    onSettled: () => {
      // Reconcile the whole notes tree with the server (replaces the optimistic
      // row with the persisted one, refreshes rollups). Low-volume → cheap.
      qc.invalidateQueries({ queryKey: ['notes'] });
      // Bump the parent project modifiedon/by so the SLA report reflects the note.
      if (touchProjectId) void touchCustomProject(touchProjectId);
    },
  });
}

export function useUpdateNote(_projectId: string, _scope: { kind: 'project' | 'task'; parentId: string }, touchProjectId?: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'update note',
    mutationFn: (input: NoteUpdateInput) => updateNote(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      if (touchProjectId) void touchCustomProject(touchProjectId);
    },
  });
}

export function useDeleteNote(_projectId: string, _scope: { kind: 'project' | 'task'; parentId: string }, touchProjectId?: string) {
  const qc = useQueryClient();
  return useAppMutation({
    action: 'delete note',
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
      if (touchProjectId) void touchCustomProject(touchProjectId);
    },
  });
}

interface ToggleReactionVars {
  note: ProjectNote;
  emoji: string;
  /** Lower-case current-user systemuserid. */
  userId: string;
}
interface ToggleReactionCtx {
  snapshots: [readonly unknown[], ProjectNote[] | undefined][];
}

/**
 * Toggle the current user's emoji reaction on a note. Reactions live in a
 * trailing sentinel tag inside annotation.notetext (see lib/noteEnvelope), so a
 * toggle decodes the current notetext, flips the reaction, re-encodes, and
 * PATCHes notetext. Optimistic: rewrite every cached notes query that holds the
 * note, roll back on error, and invalidate on settle for consistency.
 */
export function useToggleNoteReaction(_projectId: string) {
  const qc = useQueryClient();
  return useAppMutation<ToggleReactionVars, string, ToggleReactionCtx>({
    action: 'toggle note reaction',
    mutationFn: async (vars) => {
      const { body, meta } = splitNoteMeta(vars.note.notetext);
      const nextReactions = toggleNoteReaction(meta.reactions, vars.emoji, vars.userId);
      const nextNotetext = joinNoteMeta(body, { reactions: nextReactions });
      await updateNote({ noteId: vars.note.annotationid, body: nextNotetext });
      return nextNotetext;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['notes'] });
      const snapshots = qc.getQueriesData<ProjectNote[]>({ queryKey: ['notes'] });
      const { body, meta } = splitNoteMeta(vars.note.notetext);
      const optimisticNotetext = joinNoteMeta(body, {
        reactions: toggleNoteReaction(meta.reactions, vars.emoji, vars.userId),
      });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData<ProjectNote[]>(
          key,
          data.map((n) =>
            n.annotationid === vars.note.annotationid ? { ...n, notetext: optimisticNotetext } : n,
          ),
        );
      }
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context?.snapshots) return;
      for (const [key, data] of context.snapshots) qc.setQueryData(key, data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}
