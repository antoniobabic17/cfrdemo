/**
 * notesNotify — best-effort in-app notification when a user is @mentioned in a
 * note. Mirrors lib/notify.ts: failures NEVER surface or roll back the note
 * write, so callers can `void emitNoteMention(...)` freely.
 *
 * Reuses the existing NOTIF_CATEGORY.Info category (present in DEV + PROD) so no
 * optionset schema migration is required.
 */
import { createNotification } from '../api/notifications.api';
import { projectBindLoose } from './projectLookupRef';
import * as dv from './dataverseClient';
import { resolveCurrentUserId } from './dataverseClient';
import { ENTITY_SETS, NOTIF_CATEGORY } from './constants';
import type { NotificationCreate } from '../models/notification.model';

function bareGuid(v: string): string {
  return v.replace(/[{}]/g, '').trim();
}

export interface NoteMentionArgs {
  /** systemuserid of the mentioned (recipient) user. */
  mentionedUserId: string;
  /** systemuserid of the note author (to skip self-mentions). */
  actorUserId?: string | null;
  /** Display name of the note author, for the notification copy. */
  actorName?: string;
  /** Which record the note is attached to. */
  scope: 'project' | 'task';
  /** The project GUID (always known — task notes carry their parent project). */
  projectId: string;
  /** For task scope: the task GUID (drives the board deep-link). */
  taskId?: string;
  /** Name of the project or task the note is on, for the copy. */
  entityName?: string;
}

/**
 * "{author} mentioned you in a note on {Project|Task} “{name}”." → recipient.
 * Deep-links to the project Notes tab (project scope) or the task on the board
 * (task scope), matching notify.emitTaskAssigned's URL convention.
 */
export async function emitNoteMention(args: NoteMentionArgs): Promise<void> {
  const recipient = bareGuid(args.mentionedUserId);
  if (!recipient) return;

  // Skip self-mentions. Resolve the actor async when not reliably passed.
  let actor = args.actorUserId ? bareGuid(args.actorUserId).toLowerCase() : '';
  if (!actor || actor === 'anonymous') {
    try { actor = (await resolveCurrentUserId())?.toLowerCase() ?? ''; } catch { actor = ''; }
  }
  if (actor && actor === recipient.toLowerCase()) return;

  const projectId = bareGuid(args.projectId);
  const taskId = args.taskId ? bareGuid(args.taskId) : '';
  // Author display name for the copy. Prefer the passed name; else look it up
  // from the resolved actor id (best-effort — falls back to "Someone").
  let who = args.actorName?.trim() ?? '';
  if (!who && actor) {
    try {
      const u = await dv.get<{ fullname?: string }>(ENTITY_SETS.systemUser, actor, ['fullname']);
      who = u?.fullname?.trim() ?? '';
    } catch { /* ignore — fall back below */ }
  }
  if (!who) who = 'Someone';
  // Match the "for <Entity>: <Name>" format used by the assignment notifications.
  const entityLabel = args.scope === 'task' ? 'Task' : 'Project';
  const suffix = args.entityName ? ` for ${entityLabel}: ${args.entityName}` : '';

  const actionUrl =
    args.scope === 'task' && taskId
      ? `/projects/${projectId}?tab=tasks&view=board&task=${taskId}`
      : `/projects/${projectId}?tab=notes`;

  const payload: NotificationCreate = {
    pmo_title: `${who} mentioned you in a note${suffix}`,
    pmo_body: `${who} mentioned you in a note${suffix}.`,
    pmo_category: NOTIF_CATEGORY.Info,
    pmo_isread: false,
    pmo_actionurl: actionUrl,
    'pmo_TargetUser@odata.bind': `/systemusers(${recipient})`,
    ...(projectId ? projectBindLoose(projectId) : {}),
  };

  try {
    await createNotification(payload);
  } catch (err) {
    console.warn('[notesNotify] note-mention notification failed (non-fatal):', err);
  }
}

export interface FeedbackMentionArgs {
  mentionedUserId: string;
  actorUserId?: string | null;
  actorName?: string;
  feedbackId: string;
  feedbackTitle?: string;
}

/**
 * "{author} mentioned you in a response on {feedback}." → recipient.
 * Fired when an admin @mentions a user in the feedback admin-response field.
 * Deep-links to the admin feedback detail page. Best-effort like the others.
 */
export async function emitFeedbackMention(args: FeedbackMentionArgs): Promise<void> {
  const recipient = bareGuid(args.mentionedUserId);
  if (!recipient) return;

  let actor = args.actorUserId ? bareGuid(args.actorUserId).toLowerCase() : '';
  if (!actor || actor === 'anonymous') {
    try { actor = (await resolveCurrentUserId())?.toLowerCase() ?? ''; } catch { actor = ''; }
  }
  if (actor && actor === recipient.toLowerCase()) return;

  let who = args.actorName?.trim() ?? '';
  if (!who && actor) {
    try {
      const u = await dv.get<{ fullname?: string }>(ENTITY_SETS.systemUser, actor, ['fullname']);
      who = u?.fullname?.trim() ?? '';
    } catch { /* ignore */ }
  }
  if (!who) who = 'Someone';

  const suffix = args.feedbackTitle ? ` for User Feedback: ${args.feedbackTitle}` : '';
  try {
    await createNotification({
      pmo_title: `${who} mentioned you in a response${suffix}`,
      pmo_body: `${who} mentioned you in a response${suffix}.`,
      pmo_category: NOTIF_CATEGORY.Info,
      pmo_isread: false,
      pmo_actionurl: `/admin/user-feedback/${bareGuid(args.feedbackId)}`,
      'pmo_TargetUser@odata.bind': `/systemusers(${recipient})`,
    });
  } catch (err) {
    console.warn('[notesNotify] feedback-mention notification failed (non-fatal):', err);
  }
}
