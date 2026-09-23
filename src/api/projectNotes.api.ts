/**
 * Project / task notes — backed by the Dataverse `annotation` table.
 *
 * Per the manager's requirement: notes use the built-in Dataverse Notes
 * (annotation) entity rather than a custom table. This is the same table
 * that powers the model-driven app Timeline control, so all the existing
 * org automations that listen on annotation continue to fire when the
 * Code App writes through here.
 *
 * Polymorphic parent: an annotation row's `objectid` lookup can point at
 * any entity type. We use it to bind notes either to a project
 * (msdyn_projects) or to a task (msdyn_projecttasks). The `_objecttypecode`
 * field on the row tells us which one when reading back; we also store
 * the parent project id implicitly (the task's parent) so the project
 * rollup can fetch task notes via a single OData IN clause.
 *
 * Files / attachments are explicitly OUT of scope here (filter `isdocument
 * eq false` on reads). Attachments use the same table but a different
 * shape — the intakeAttachments.api.ts module already handles those.
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

const SET = ENTITY_SETS.annotation;

export interface ProjectNote {
  annotationid: string;
  subject?: string;     // title
  notetext?: string;    // body
  createdon?: string;
  modifiedon?: string;
  /** Owning record GUID (project or task). */
  '_objectid_value'?: string;
  /** Owning record entity logical name — 'msdyn_project' | 'msdyn_projecttask'. */
  objecttypecode?: string;
  /** Display name of the creator, surfaced via OData formatted-value annotation. */
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  '_modifiedby_value'?: string;
  '_modifiedby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

export interface NoteCreateInput {
  /** Parent record GUID (project or task). */
  parentId: string;
  /** Parent entity set name — 'msdyn_projects' for projects, 'msdyn_projecttasks' for tasks. */
  /** 'msdyn_projects' for projects; for tasks 'msdyn_projecttasks' (PSS) or
   *  'pmo_tasks' (custom — the task lives in pmo_task with no msdyn twin, so a
   *  msdyn_projecttask bind fails). NotesSection picks the task set by source. */
  parentEntitySet: 'msdyn_projects' | 'pmo_projects' | 'msdyn_projecttasks' | 'pmo_tasks' | 'pmo_userfeedbacks';
  title: string;
  body: string;
}

export interface NoteUpdateInput {
  noteId: string;
  title?: string;
  body?: string;
}

const SELECT_FIELDS = [
  'annotationid',
  'subject',
  'notetext',
  'createdon',
  'modifiedon',
  '_objectid_value',
  'objecttypecode',
  '_createdby_value',
  '_modifiedby_value',
] as const;

/**
 * List notes for a single project: only notes whose objectid points at
 * THIS project record (objecttypecode = 'msdyn_project').
 */
export async function listProjectNotes(projectId: string, projectTypeCode: 'msdyn_project' | 'pmo_project' = 'msdyn_project'): Promise<ProjectNote[]> {
  return dv.list<ProjectNote>(SET, {
    $select: [...SELECT_FIELDS],
    $filter: `_objectid_value eq ${projectId} and objecttypecode eq '${projectTypeCode}' and isdocument eq false`,
    $orderby: 'createdon desc',
  });
}

/**
 * List notes attached to a specific task.
 */
export async function listTaskNotes(taskId: string, taskTypeCode: 'msdyn_projecttask' | 'pmo_task' = 'msdyn_projecttask'): Promise<ProjectNote[]> {
  return dv.list<ProjectNote>(SET, {
    $select: [...SELECT_FIELDS],
    $filter: `_objectid_value eq ${taskId} and objecttypecode eq '${taskTypeCode}' and isdocument eq false`,
    $orderby: 'createdon desc',
  });
}

/**
 * List admin-response notes attached to a feedback record. Same annotation
 * backing as project/task notes; objecttypecode = 'pmo_userfeedback'.
 */
export async function listFeedbackNotes(feedbackId: string): Promise<ProjectNote[]> {
  return dv.list<ProjectNote>(SET, {
    $select: [...SELECT_FIELDS],
    $filter: `_objectid_value eq ${feedbackId} and objecttypecode eq 'pmo_userfeedback' and isdocument eq false`,
    $orderby: 'createdon desc',
  });
}

/**
 * Roll-up reader for the project Notes tab. Fetches every note attached to
 * any task in the supplied list. The caller passes the project's task ids
 * (already loaded for the page) so we build a single IN clause and avoid
 * a per-task fan-out.
 *
 * Returns an empty list when there are no tasks — skipping the fetch
 * entirely rather than sending a vacuous filter that would 400.
 */
export async function listNotesForTasks(taskIds: string[], taskTypeCode: 'msdyn_projecttask' | 'pmo_task' = 'msdyn_projecttask'): Promise<ProjectNote[]> {
  if (taskIds.length === 0) return [];
  // OData has no native IN; emit a chained 'or'. Cap at ~50 ids per call to
  // stay well clear of URL-length limits — the typical project has fewer
  // tasks than that, but split defensively for the long tail.
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += CHUNK) chunks.push(taskIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const orClause = chunk.map((id) => `_objectid_value eq ${id}`).join(' or ');
      return dv.list<ProjectNote>(SET, {
        $select: [...SELECT_FIELDS],
        $filter: `(${orClause}) and objecttypecode eq '${taskTypeCode}' and isdocument eq false`,
        $orderby: 'createdon desc',
      });
    }),
  );
  // Flatten and re-sort across chunks so the final feed is globally
  // newest-first.
  return results.flat().sort((a, b) => {
    const at = a.createdon ? new Date(a.createdon).getTime() : 0;
    const bt = b.createdon ? new Date(b.createdon).getTime() : 0;
    return bt - at;
  });
}

/**
 * Latest note per project, across a list of project ids. Powers the Projects
 * grid "Last Note" column. Reuses the chunked OR-clause pattern from
 * listNotesForTasks (OData has no IN; ~50 ids/request to stay under URL limits)
 * and asks Dataverse to pre-sort newest-first so the FIRST row seen per
 * project is its latest note. Returns a Map keyed by the project id
 * (_objectid_value).
 *
 * projectTypeCode selects the polymorphic parent by data source:
 * 'pmo_project' (custom) or 'msdyn_project' (pss).
 */
export async function listLatestNotesForProjects(
  projectIds: string[],
  projectTypeCode: 'msdyn_project' | 'pmo_project' = 'msdyn_project',
): Promise<Map<string, ProjectNote>> {
  const latest = new Map<string, ProjectNote>();
  if (projectIds.length === 0) return latest;
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < projectIds.length; i += CHUNK) chunks.push(projectIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const orClause = chunk.map((id) => `_objectid_value eq ${id}`).join(' or ');
      return dv.list<ProjectNote>(SET, {
        $select: [...SELECT_FIELDS],
        $filter: `(${orClause}) and objecttypecode eq '${projectTypeCode}' and isdocument eq false`,
        $orderby: 'createdon desc',
      });
    }),
  );
  // Rows arrive newest-first within each chunk; keep the newest per project.
  for (const note of results.flat()) {
    const pid = note['_objectid_value'];
    if (!pid) continue;
    const existing = latest.get(pid);
    if (!existing) { latest.set(pid, note); continue; }
    const cur = note.createdon ? new Date(note.createdon).getTime() : 0;
    const prev = existing.createdon ? new Date(existing.createdon).getTime() : 0;
    if (cur > prev) latest.set(pid, note);
  }
  return latest;
}

export async function createNote(input: NoteCreateInput): Promise<ProjectNote> {
  const payload: Record<string, unknown> = {
    subject: input.title.slice(0, 500),       // annotation.subject hard cap is 500
    notetext: input.body,
    // PSS task -> objectid_msdyn_projecttask; custom task (pmo_tasks) ->
    // objectid_pmo_task (the pmo_task_Annotations relationship); project ->
    // objectid_msdyn_project. Exactly one bind is kept.
    'objectid_msdyn_projecttask@odata.bind':
      input.parentEntitySet === 'msdyn_projecttasks'
        ? `/msdyn_projecttasks(${input.parentId})`
        : undefined,
    'objectid_pmo_task@odata.bind':
      input.parentEntitySet === 'pmo_tasks'
        ? `/pmo_tasks(${input.parentId})`
        : undefined,
    'objectid_msdyn_project@odata.bind':
      input.parentEntitySet === 'msdyn_projects'
        ? `/msdyn_projects(${input.parentId})`
        : undefined,
    'objectid_pmo_project@odata.bind':
      input.parentEntitySet === 'pmo_projects'
        ? `/pmo_projects(${input.parentId})`
        : undefined,
    'objectid_pmo_userfeedback@odata.bind':
      input.parentEntitySet === 'pmo_userfeedbacks'
        ? `/pmo_userfeedbacks(${input.parentId})`
        : undefined,
  };
  // Strip the unused @odata.bind so we send exactly one binding.
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }
  return dv.create<ProjectNote>(SET, payload);
}

export async function updateNote(input: NoteUpdateInput): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.subject = input.title.slice(0, 500);
  if (input.body !== undefined) payload.notetext = input.body;
  await dv.update(SET, input.noteId, payload);
}

export async function deleteNote(noteId: string): Promise<void> {
  await dv.remove(SET, noteId);
}
