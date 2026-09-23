/**
 * NotesSection — composer + recent feed, used in two places:
 *   1) Project detail page → "Notes" tab. Composer creates project notes.
 *      The feed shows project notes PLUS rolled-up task notes (each task note
 *      carries a small "Task" badge with the task name).
 *   2) Task detail panel → "Notes" section. Composer creates task notes; the
 *      feed shows only this task's notes.
 *
 * Every note round-trips through the Dataverse `annotation` table so the
 * model-driven Timeline + org automations keep firing.
 *
 * Teams/bulletin-style features (2026-08):
 *   - Collapsed composer: a full-width "+ New Note" pill expands into the
 *     title+body composer; Cancel / successful save collapses it back.
 *   - @mentions over ALL environment users (org-wide async search via
 *     useUserSearch), stored inline as `@[Name](systemuserid)` chips and
 *     rendered as highlighted chips. A mention fires an in-app notification.
 *   - emoji insert in the composer + emoji REACTIONS on posted notes.
 *   - body is plain text; reactions ride in a trailing sentinel tag inside
 *     notetext (lib/noteEnvelope) so Timeline stays readable.
 */
import { useEffect, useMemo, useState } from 'react';
import { useDataSource, usesCustomTables } from '../../lib/taskSource';
import { Loader2, Pencil, Trash2, Search, FileText, Plus, Send, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { cn } from '../../lib/utils';
import { useCurrentUserId } from '../../hooks/useCurrentUserId';
import { useEffectiveAdminRole } from '../../providers/ConfigurationProvider';
import {
  useProjectNotes,
  useTaskNotes,
  useTaskNotesRollup,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useToggleNoteReaction,
  useFeedbackNotes,
} from '../../hooks/useProjectNotes';
import type { ProjectNote } from '../../api/projectNotes.api';
import { RichNoteEditor } from '../common/RichNoteEditor';
import { renderRichText, isRichTextEmpty } from '../common/RichTextEditor';
import { emitFeedbackMention } from '../../lib/notesNotify';
import { splitNoteMeta, joinNoteMeta } from '../../lib/noteEnvelope';
import { extractMentionUserIds, canonicalMentionsToChips } from '../../lib/richMentions';
import { ReactionBar } from '../teams/ReactionBar';
import { emitNoteMention } from '../../lib/notesNotify';

type NotesScope =
  | { kind: 'project'; projectId: string; projectName?: string; rollupTasks?: { id: string; name: string }[] }
  | { kind: 'task'; projectId: string; taskId: string; taskName?: string }
  | { kind: 'feedback'; feedbackId: string; feedbackTitle?: string };

/**
 * Feed mode for the project Notes tab.
 *  - 'merged'      → project notes + rolled-up task notes (default)
 *  - 'projectOnly' → only project-level notes
 *  - 'tasksOnly'   → only rolled-up task notes
 * Ignored when scope.kind === 'task'.
 */
export type NotesMode = 'merged' | 'projectOnly' | 'tasksOnly';

interface Props {
  scope: NotesScope;
  /** Optional: render compact (used inside the slim TaskDetailPanel). */
  compact?: boolean;
  /** Filter the project-tab feed; defaults to 'merged'. */
  mode?: NotesMode;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  if (!name) return '··';
  // "O.Keen, Teresa" → "OT"; "Antonio Lima" → "AL"
  const cleaned = name.replace(/[.,]/g, ' ').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0];
  const second = parts[parts.length - 1][0];
  return (first + second).toUpperCase();
}

/**
 * Build a one-line preview for a collapsed note. Prefers the subject; falls
 * back to the note body with HTML/mention markup stripped to plain text and
 * clamped so a collapsed row stays a single line.
 */
function notePreview(subject: string | undefined, body: string): string {
  const s = (subject ?? '').trim();
  if (s) return s;
  const plain = body
    // legacy canonical mentions → the display name only
    .replace(/@\[([^\]]+)\]\([^)]*\)/g, '@$1')
    // strip any HTML tags (rich body / mention chips)
    .replace(/<[^>]*>/g, ' ')
    // collapse whitespace / entities
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '(no content)';
  return plain.length > 90 ? plain.slice(0, 90).trimEnd() + '…' : plain;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Decide whether the current user is the author of a note. Fall back to hiding
 * edit/delete affordances when we can't resolve identity — safer than showing
 * them and 403-ing on click.
 */
function isOwnNote(note: ProjectNote, currentUserId: string | null | undefined): boolean {
  if (!currentUserId) return false;
  return (note['_createdby_value'] ?? '').toLowerCase() === currentUserId.toLowerCase();
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  onSave,
  onCancel,
  initialTitle = '',
  initialBody = '',
  saveLabel = 'Add note',
  isPending,
  compact,
  resetSignal,
  onImagePaste,
}: {
  onSave: (title: string, body: string) => void;
  onCancel?: () => void;
  initialTitle?: string;
  /** Stored body value — sanitized HTML (may contain legacy @[Name](id) which the
   *  editor/renderer upgrades to chips). */
  initialBody?: string;
  saveLabel?: string;
  isPending: boolean;
  compact?: boolean;
  /** Bumped by the parent after a successful save to clear the composer. */
  resetSignal?: number;
  /** Optional image-paste handler (attach a screenshot). */
  onImagePaste?: (file: File) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  // Body is now rich HTML (RichNoteEditor). Legacy canonical mentions in
  // initialBody are upgraded to chips so editing an old note shows them.
  const [body, setBody] = useState(() => canonicalMentionsToChips(initialBody));

  // Clear/reset the composer when the parent bumps resetSignal (post-save).
  useEffect(() => {
    if (resetSignal === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(initialTitle);
    setBody(canonicalMentionsToChips(initialBody));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const dirty = title.trim() !== initialTitle.trim() || !isRichTextEmpty(body);

  function handleSave() {
    if (isRichTextEmpty(body)) return;
    onSave(title.trim(), body);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 relative">
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isPending}
        className="text-sm"
      />
      <RichNoteEditor
        value={body}
        onChange={setBody}
        placeholder="Write a note… use @ to mention someone"
        rows={compact ? 3 : 5}
        disabled={isPending}
        onImagePaste={onImagePaste}
        onSubmitShortcut={handleSave}
      />
      <div className="flex items-center gap-1">
        <div className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={handleSave} disabled={isPending || isRichTextEmpty(body) || !dirty}>
          {isPending ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Send className="h-3 w-3 mr-1.5" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

// ── Note row ─────────────────────────────────────────────────────────────────

function NoteRow({
  note,
  taskName,
  currentUserId,
  canModify,
  onEdit,
  onDelete,
  onToggleReaction,
  isEditing,
  onCancelEdit,
  onSaveEdit,
  isSaving,
  expanded,
  onToggleExpand,
}: {
  note: ProjectNote;
  taskName?: string;
  currentUserId: string | null | undefined;
  /** True when the current user may edit/delete this note (creator OR admin). */
  canModify: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleReaction: (emoji: string) => void;
  isEditing: boolean;
  onCancelEdit: () => void;
  onSaveEdit: (title: string, body: string) => void;
  isSaving: boolean;
  /** When false the body/reactions collapse to a one-line preview. */
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const author =
    (note['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined) ?? '—';
  const wasEdited = note.modifiedon && note.createdon && note.modifiedon !== note.createdon;
  // Strip the trailing reaction sentinel before displaying the body.
  const { body, meta } = useMemo(() => splitNoteMeta(note.notetext), [note.notetext]);
  const lowerUser = (currentUserId ?? '').toLowerCase();
  // Visual cue for status-change system notes (feedback): green = Resolved,
  // pink/red = On Hold. Matched on the fixed title suffix the resolver writes.
  const subj = note.subject ?? '';
  const statusTint = /changed the ticket status to Resolved$/i.test(subj)
    ? 'bg-emerald-50 dark:bg-emerald-500/10'
    : /changed the ticket status to On Hold$/i.test(subj)
      ? 'bg-rose-50 dark:bg-rose-500/10'
      : '';

  return (
    <div className={cn('flex items-start gap-3 px-3 py-3 border-t border-border first:border-t-0', statusTint)}>
      <div
        className="h-8 w-8 rounded-full bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center shrink-0 cursor-default"
        title={author}
      >
        {initials(author)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded min-w-0"
            aria-expanded={expanded}
            title={expanded ? 'Collapse note' : 'Expand note'}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')} />
            <FileText className="h-3 w-3 shrink-0" />
            {!expanded && !isEditing ? (
              <span className="truncate text-foreground font-normal">{notePreview(note.subject, body)}</span>
            ) : (
              <span>Note</span>
            )}
          </button>
          {taskName && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 shrink-0">
              Task: {taskName}
            </span>
          )}
          {canModify && !isEditing && expanded && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button onClick={onEdit} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Edit note" aria-label="Edit note">
                <Pencil className="h-3 w-3" />
              </button>
              <button onClick={onDelete} className="text-muted-foreground hover:text-destructive p-1 rounded" title="Delete note" aria-label="Delete note">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {(expanded || isEditing) && (
          <p className="text-[11px] text-muted-foreground mb-1">By: {author}</p>
        )}

        {isEditing ? (
          <Composer
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
            initialTitle={note.subject ?? ''}
            initialBody={body}
            saveLabel="Save changes"
            isPending={isSaving}
            compact
          />
        ) : expanded ? (
          <>
            {note.subject && (
              <p className="text-sm font-medium text-foreground mb-0.5">{note.subject}</p>
            )}
            {body && (
              <div
                className={cn(
                  'text-sm text-foreground leading-relaxed',
                  '[&_a]:text-primary [&_a]:underline',
                  '[&_a.mention]:no-underline [&_a.mention]:bg-primary/10 [&_a.mention]:text-primary [&_a.mention]:font-medium [&_a.mention]:rounded [&_a.mention]:px-1',
                  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
                )}
                dangerouslySetInnerHTML={renderRichText(body)}
              />
            )}
            <div className="mt-1.5">
              <ReactionBar
                reactions={meta.reactions}
                currentUserId={lowerUser}
                canReact={!!currentUserId}
                onToggle={onToggleReaction}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {formatTimestamp(note.createdon)}
              {wasEdited && <span className="ml-1.5 italic">(edited)</span>}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function NotesSection({ scope, compact, mode = 'merged' }: Props) {
  // Generic cache-scoping id: the project for project/task scope, the feedback
  // record for feedback scope. Used only to key mutations/queries.
  const scopeId = scope.kind === 'feedback' ? scope.feedbackId : scope.projectId;
  const projectId = scopeId;
  // Custom-source tasks live in pmo_task (no msdyn_projecttask twin), so task
  // notes must bind to / read from pmo_task. Projects always use the shell GUID.
  const dataSource = useDataSource();
  const taskTypeCode = usesCustomTables(dataSource) ? 'pmo_task' as const : 'msdyn_projecttask' as const;
  const taskNoteSet = usesCustomTables(dataSource) ? 'pmo_tasks' as const : 'msdyn_projecttasks' as const;
  // Custom-source projects: pmo_project is Notes-enabled, so project notes bind
  // to / read from pmo_project (not the msdyn shell). PSS source keeps msdyn_project.
  const projectTypeCode = usesCustomTables(dataSource) ? 'pmo_project' as const : 'msdyn_project' as const;
  const projectNoteSet = usesCustomTables(dataSource) ? 'pmo_projects' as const : 'msdyn_projects' as const;
  const projectNotesQuery = useProjectNotes(scope.kind === 'project' ? projectId : undefined, projectTypeCode);
  const taskNotesQuery = useTaskNotes(scope.kind === 'task' ? scope.taskId : undefined, taskTypeCode);
  const feedbackNotesQuery = useFeedbackNotes(scope.kind === 'feedback' ? scope.feedbackId : undefined);
  const taskRollupTaskIds =
    scope.kind === 'project' ? (scope.rollupTasks ?? []).map((t) => t.id) : [];
  const taskRollupQuery = useTaskNotesRollup(
    scope.kind === 'project' ? projectId : undefined,
    taskRollupTaskIds,
    taskTypeCode,
  );

  // Mutations.
  // Real project GUID for the SLA "touch" (bump project modifiedon/by on any
  // note write). Only set for project/task scope — feedback notes have no project.
  const touchProjectId = scope.kind === 'feedback' ? undefined : projectId;
  const createMutation = useCreateNote(projectId, touchProjectId);
  const noteScope: { kind: 'project' | 'task'; parentId: string } =
    scope.kind === 'task'
      ? { kind: 'task', parentId: scope.taskId }
      : { kind: 'project', parentId: projectId };
  const updateMutation = useUpdateNote(projectId, noteScope, touchProjectId);
  const deleteMutation = useDeleteNote(projectId, noteScope, touchProjectId);
  const toggleReactionMutation = useToggleNoteReaction(projectId);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectNote | null>(null);
  const [composerResetSignal, setComposerResetSignal] = useState(0);
  // Collapsible notes: everything starts collapsed to a one-line preview so a
  // project with hundreds of notes stays scannable. `allExpanded` drives the
  // Expand-all / Collapse-all toggle; `expandOverrides` records per-note user
  // toggles that win over the bulk state. Notes being edited and (when a search
  // is active) matching notes are always shown expanded regardless.
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandOverrides, setExpandOverrides] = useState<Record<string, boolean>>({});
  // Client-side notes paging: the full (already-fetched) feed is filtered by
  // the search box first, then shown NOTES_PAGE_SIZE at a time.
  const [notePage, setNotePage] = useState(1);
  const currentUserId = useCurrentUserId();
  // Admins (pmo_admin / system_admin) may edit/delete ANY note for moderation;
  // everyone else may only modify their own. Uses the effective role so admin
  // impersonation correctly downgrades to a regular user.
  const isAdmin = useEffectiveAdminRole() !== 'none';

  // ── Build the merged feed ─────────────────────────────────────────────────
  const feed = useMemo(() => {
    type FeedItem = { note: ProjectNote; taskName?: string };
    const items: FeedItem[] = [];
    if (scope.kind === 'project') {
      if (mode !== 'tasksOnly') {
        for (const n of projectNotesQuery.data ?? []) items.push({ note: n });
      }
      if (mode !== 'projectOnly') {
        const taskNameById = new Map((scope.rollupTasks ?? []).map((t) => [t.id, t.name]));
        for (const n of taskRollupQuery.data ?? []) {
          items.push({ note: n, taskName: taskNameById.get(n['_objectid_value'] ?? '') ?? 'Task' });
        }
      }
    } else if (scope.kind === 'feedback') {
      for (const n of feedbackNotesQuery.data ?? []) items.push({ note: n });
    } else {
      for (const n of taskNotesQuery.data ?? []) items.push({ note: n });
    }
    items.sort((a, b) => {
      const at = a.note.createdon ? new Date(a.note.createdon).getTime() : 0;
      const bt = b.note.createdon ? new Date(b.note.createdon).getTime() : 0;
      return bt - at;
    });
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      ({ note, taskName }) =>
        (note.subject ?? '').toLowerCase().includes(q) ||
        splitNoteMeta(note.notetext).body.toLowerCase().includes(q) ||
        (taskName ?? '').toLowerCase().includes(q) ||
        ((note['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined) ?? '')
          .toLowerCase()
          .includes(q),
    );
  }, [scope, mode, projectNotesQuery.data, taskNotesQuery.data, taskRollupQuery.data, feedbackNotesQuery.data, search]);

  const isLoading =
    (scope.kind === 'project' && (projectNotesQuery.isLoading || taskRollupQuery.isLoading)) ||
    (scope.kind === 'task' && taskNotesQuery.isLoading);

  // Page the (already search-filtered) feed 10 at a time. safePage clamps so
  // filtering down can never strand the user on an empty high page.
  const NOTES_PAGE_SIZE = 10;
  const notePageCount = Math.max(1, Math.ceil(feed.length / NOTES_PAGE_SIZE));
  const safeNotePage = Math.min(notePage, notePageCount);
  const pagedFeed = feed.slice((safeNotePage - 1) * NOTES_PAGE_SIZE, safeNotePage * NOTES_PAGE_SIZE);
  // Reset to page 1 whenever the search query changes (search narrows the full
  // set first, then we page the result).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNotePage(1); }, [search]);

  // Resolve a note's expanded state: an explicit per-note override wins;
  // otherwise fall back to the bulk `allExpanded` flag. Callers OR-in the
  // always-expand cases (editing / active search match) at the call site.
  const searching = search.trim().length > 0;
  function isNoteExpanded(noteId: string): boolean {
    return expandOverrides[noteId] ?? allExpanded;
  }
  function toggleNoteExpanded(noteId: string) {
    setExpandOverrides((prev) => ({ ...prev, [noteId]: !(prev[noteId] ?? allExpanded) }));
  }
  function setAllNotesExpanded(next: boolean) {
    setAllExpanded(next);
    // Clear per-note overrides so the bulk action applies uniformly.
    setExpandOverrides({});
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  function fireMentionNotifications(body: string) {
    // body is now rich HTML — pull ids from chip anchors AND any legacy
    // canonical @[Name](id) tokens.
    for (const id of extractMentionUserIds(body)) {
      if (scope.kind === 'feedback') {
        void emitFeedbackMention({
          mentionedUserId: id,
          actorUserId: currentUserId ?? undefined,
          feedbackId: scope.feedbackId,
          feedbackTitle: scope.feedbackTitle,
        });
      } else {
        void emitNoteMention({
          mentionedUserId: id,
          actorUserId: currentUserId ?? undefined,
          scope: scope.kind,
          projectId,
          taskId: scope.kind === 'task' ? scope.taskId : undefined,
          entityName: scope.kind === 'task' ? scope.taskName : scope.projectName,
        });
      }
    }
  }

  function handleCreate(title: string, body: string) {
    if (isRichTextEmpty(body)) return;
    // Close + reset the composer IMMEDIATELY — the create is optimistic (the
    // note appears in the feed at once), so the user never waits on the
    // Dataverse round-trip. Mentions fire in the background too.
    setComposing(false);
    setComposerResetSignal((n) => n + 1);
    fireMentionNotifications(body);
    createMutation.mutate(
      scope.kind === 'project'
        ? { parentId: projectId, parentEntitySet: projectNoteSet, title, body, authorId: currentUserId ?? undefined }
        : scope.kind === 'feedback'
          ? { parentId: scope.feedbackId, parentEntitySet: 'pmo_userfeedbacks' as const, title, body, authorId: currentUserId ?? undefined }
          : { parentId: scope.taskId, parentEntitySet: taskNoteSet, title, body, authorId: currentUserId ?? undefined },
    );
  }

  function handleSaveEdit(noteId: string, title: string, body: string) {
    // Preserve any existing reactions tag when editing the body.
    const existing = feed.find((f) => f.note.annotationid === noteId)?.note;
    const reactionsTag = existing ? splitNoteMeta(existing.notetext).meta : { reactions: {} };
    // Re-attach any existing reactions to the edited plain body.
    const nextBody = joinNoteMeta(body, reactionsTag);
    updateMutation.mutate(
      { noteId, title, body: nextBody },
      { onSuccess: () => setEditingId(null) },
    );
  }

  function handleConfirmedDelete() {
    if (!confirmDelete) return;
    deleteMutation.mutate(confirmDelete.annotationid, { onSuccess: () => setConfirmDelete(null) });
  }

  function handleToggleReaction(note: ProjectNote, emoji: string) {
    if (!currentUserId) return;
    toggleReactionMutation.mutate({ note, emoji, userId: currentUserId.toLowerCase() });
  }

  const showComposer = scope.kind === 'task' || mode === 'merged' || mode === 'projectOnly';
  const hasNotes = feed.length > 0 || !!search.trim();

  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      {/* Composer — expands inline from the compact "+ New Note" link on the
          action row below. Hidden in tasksOnly mode (task notes are authored
          from the task panel). */}
      {showComposer && composing && (
        <Composer
          onSave={handleCreate}
          onCancel={() => setComposing(false)}
          isPending={createMutation.isPending}
          compact={compact}
          resetSignal={composerResetSignal}
        />
      )}

      {/* Action row — compact "+ New Note" link beside the search box + count +
          Expand/Collapse-all toggle. Always rendered (even with zero notes) so
          the New Note affordance never pushes the feed down a full column. */}
      {(showComposer || hasNotes) && (
        <div className="flex items-center gap-2">
          {showComposer && !composing && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 active:scale-[0.98] transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              New Note
            </button>
          )}
          {hasNotes && (
            <div className="relative flex-1 min-w-0 max-w-sm">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-sm"
              />
            </div>
          )}
          {hasNotes && (
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {feed.length > 1 && (
                <button
                  type="button"
                  onClick={() => setAllNotesExpanded(!allExpanded)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {feed.length} note{feed.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading notes…</span>
        </div>
      ) : feed.length === 0 ? (
        search ? (
          <p className="px-1 py-3 text-xs text-muted-foreground">No notes match “{search}”.</p>
        ) : (
          <p className="px-1 py-2 text-xs text-muted-foreground">No notes yet.</p>
        )
      ) : (
        <>
        <div className="rounded-xl border border-border bg-card divide-y overflow-hidden">
          {pagedFeed.map(({ note, taskName }) => (
            <NoteRow
              key={note.annotationid}
              note={note}
              taskName={taskName}
              currentUserId={currentUserId}
              canModify={isAdmin || isOwnNote(note, currentUserId)}
              onEdit={() => setEditingId(note.annotationid)}
              onDelete={() => setConfirmDelete(note)}
              onToggleReaction={(emoji) => handleToggleReaction(note, emoji)}
              isEditing={editingId === note.annotationid}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(t, b) => handleSaveEdit(note.annotationid, t, b)}
              isSaving={updateMutation.isPending && editingId === note.annotationid}
              expanded={
                isNoteExpanded(note.annotationid) ||
                editingId === note.annotationid ||
                searching
              }
              onToggleExpand={() => toggleNoteExpanded(note.annotationid)}
            />
          ))}
        </div>
        {notePageCount > 1 && (
          <div className="flex items-center justify-between px-1 pt-2">
            <span className="text-xs text-muted-foreground">
              Page {safeNotePage} of {notePageCount}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => setNotePage((p) => Math.max(1, p - 1))}
                disabled={safeNotePage <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => setNotePage((p) => Math.min(notePageCount, p + 1))}
                disabled={safeNotePage >= notePageCount}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this note?"
        message="This action can't be undone."
        confirmLabel="Delete"
        isLoading={deleteMutation.isPending}
        onConfirm={handleConfirmedDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
