/**
 * notify — fire-and-forget helpers for creating per-user pmo_notification
 * records as a side-effect of app actions (task assigned, clarification
 * requested, request decided).
 *
 * These are intentionally best-effort: a failure to write a notification must
 * NEVER fail or roll back the primary action (assigning a task, deciding a
 * request). Every helper swallows its own errors and logs them, so callers can
 * `void emitTaskAssigned(...)` without try/catch.
 *
 * Client-side emission has a known gap — assignments made outside the app
 * (model-driven app, Power Automate) won't fire these. A Dataverse plugin is
 * the deferred follow-up for full coverage; see the intake-notifications plan.
 */
import { createNotification } from '../api/notifications.api';
import { projectBindLoose } from './projectLookupRef';
import { resolveCurrentUserId } from './dataverseClient';
import { NOTIF_CATEGORY, ENTITY_SETS } from './constants';
import * as dv from './dataverseClient';
import type { NotificationCreate } from '../models/notification.model';

/** Strip braces / normalize a guid to the bare form OData binds expect. */
function bareGuid(v: string): string {
  return v.replace(/[{}]/g, '').trim();
}

/**
 * Resolve the ACTING user's systemuserid for self-assignment detection.
 *
 * Callers historically pass `dv.getCurrentUserId()`, which returns the literal
 * 'anonymous' in Power Apps Code Apps (no window.Xrm) — so a caller-supplied
 * actor is unreliable and the self-assign skip silently never fired (you got a
 * notification for assigning yourself). We treat a missing/'anonymous' actor as
 * "unknown" and fall back to the async resolver, which reads the real id from
 * the Power Apps SDK context. Never throws — returns '' if it can't resolve.
 */
async function resolveActor(passed?: string | null): Promise<string> {
  const a = passed ? bareGuid(passed) : '';
  if (a && a.toLowerCase() !== 'anonymous') return a.toLowerCase();
  try {
    return (await resolveCurrentUserId())?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}

async function safeCreate(payload: NotificationCreate, context: string): Promise<void> {
  try {
    await createNotification(payload);
  } catch (err) {
    // Best-effort: never surface to the user or fail the primary action.
    console.warn(`[notify] ${context} notification failed (non-fatal):`, err);
  }
}

export interface TaskAssignedArgs {
  /** systemuserid of the person being assigned. */
  assigneeUserId: string;
  /** systemuserid of the person doing the assigning (to skip self-assign). */
  actorUserId?: string | null;
  taskName: string;
  projectId: string;
  projectName?: string;
  /** msdyn_projecttaskid of the assigned task (same GUID as the pmo_task
   *  mirror). Used to deep-link straight to the task on the board. */
  taskId?: string;
}

/**
 * "You were assigned to {task}". Skipped when a user assigns a task to
 * themselves — self-assignment isn't a notification-worthy event.
 *
 * Deep-links to the task ON the board: the project detail page reads `tab`,
 * `view`, and `task` from the URL (ProjectDetailPage useUrlState), so
 * `/projects/{id}?tab=tasks&view=board&task={taskId}` opens the board and
 * selects the task. Falls back to the plain project page when taskId is absent.
 */
export async function emitTaskAssigned(args: TaskAssignedArgs): Promise<void> {
  const assignee = bareGuid(args.assigneeUserId);
  if (!assignee) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === assignee.toLowerCase()) return; // self-assign → no notification

  const projectId = bareGuid(args.projectId);
  const taskId = args.taskId ? bareGuid(args.taskId) : '';
  const actionUrl = taskId
    ? `/projects/${projectId}?tab=tasks&view=board&task=${taskId}`
    : `/projects/${projectId}`;

  return safeCreate({
    pmo_title: `You were assigned the task “${args.taskName}”${args.projectName ? ` for Project: ${args.projectName}` : ''}`,
    pmo_body: `You were assigned to “${args.taskName}”${args.projectName ? ` on ${args.projectName}` : ''}.`,
    pmo_category: NOTIF_CATEGORY.TaskAssigned,
    pmo_isread: false,
    pmo_actionurl: actionUrl,
    'pmo_TargetUser@odata.bind': `/systemusers(${assignee})`,
    ...(projectId ? projectBindLoose(projectId) : {}),
  }, 'task-assigned');
}

export interface ClarificationRequestedArgs {
  /** systemuserid of the request's creator/requester (the recipient). */
  recipientUserId: string;
  requestId: string;
  requestName: string;
  question?: string;
}

/** "Clarification requested on {request}" → the submitter. */
export function emitClarificationRequested(args: ClarificationRequestedArgs): Promise<void> {
  const recipient = args.recipientUserId ? bareGuid(args.recipientUserId) : '';
  if (!recipient) return Promise.resolve();
  return safeCreate({
    pmo_title: 'Clarification requested',
    pmo_body: `A reviewer needs more detail on “${args.requestName}”.${args.question ? ` ${args.question}` : ''}`,
    pmo_category: NOTIF_CATEGORY.ClarificationRequested,
    pmo_isread: false,
    pmo_actionurl: `/intake/${bareGuid(args.requestId)}`,
    'pmo_TargetUser@odata.bind': `/systemusers(${recipient})`,
  }, 'clarification-requested');
}

export type AssignableRole = 'Project Manager' | 'Executive Sponsor' | 'Program Manager';

export interface RoleAssignedArgs {
  /** systemuserid of the person being assigned to the role. */
  assigneeUserId: string;
  /** systemuserid of the person doing the assigning (to skip self-assign). */
  actorUserId?: string | null;
  role: AssignableRole;
  /** 'project' | 'program' — drives the deep-link target. */
  entityKind: 'project' | 'program';
  entityId: string;
  entityName?: string;
}

/**
 * "You were assigned as {role} on {entity}". Fired whenever someone else sets
 * a person as PM / Executive Sponsor (project) or Program Manager (program).
 * Skipped on self-assignment. Best-effort, like the other emitters.
 */
export async function emitRoleAssigned(args: RoleAssignedArgs): Promise<void> {
  const assignee = bareGuid(args.assigneeUserId);
  if (!assignee) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === assignee.toLowerCase()) return; // self-assign → no notification

  const bareEntity = bareGuid(args.entityId);
  const entityLabel = args.entityKind === 'program' ? 'Program' : 'Project';
  const payload: NotificationCreate = {
    pmo_title: `You were assigned as ${args.role}${args.entityName ? ` for ${entityLabel}: ${args.entityName}` : ''}`,
    pmo_body: `You were assigned as ${args.role}${args.entityName ? ` on ${args.entityName}` : ''}.`,
    pmo_category: NOTIF_CATEGORY.TaskAssigned,
    pmo_isread: false,
    pmo_actionurl: args.entityKind === 'program'
      ? `/programs/${bareEntity}`
      : `/projects/${bareEntity}`,
    'pmo_TargetUser@odata.bind': `/systemusers(${assignee})`,
  };
  if (bareEntity) {
    if (args.entityKind === 'program') {
      payload['pmo_Program@odata.bind'] = `/msdyn_projectprograms(${bareEntity})`;
    } else {
      Object.assign(payload, projectBindLoose(bareEntity));
    }
  }
  return safeCreate(payload, `role-assigned:${args.role}`);
}

export type MonitorItemKind = 'risk' | 'issue' | 'change' | 'decision';

export interface MonitorItemAssignedArgs {
  /** systemuserid of the person being assigned (Assigned To, or Decision
   *  Owner for decisions). */
  assigneeUserId: string;
  /** systemuserid of the person doing the assigning (to skip self-assign). */
  actorUserId?: string | null;
  kind: MonitorItemKind;
  /** Display name of the risk/issue/change/decision. */
  itemName: string;
  projectId: string;
  projectName?: string;
}

/** Monitor sub-tab + human label per item kind. Decisions live under the same
 *  Monitor tab (subtab=decisions) as risks/issues/changes. */
const MONITOR_ITEM_META: Record<MonitorItemKind, { subtab: string; noun: string; verb: string }> = {
  risk:     { subtab: 'risks',     noun: 'risk',            verb: 'assigned' },
  issue:    { subtab: 'issues',    noun: 'issue',           verb: 'assigned' },
  change:   { subtab: 'changes',   noun: 'change request',  verb: 'assigned' },
  decision: { subtab: 'decisions', noun: 'decision',        verb: 'made owner of' },
};

/**
 * "You were assigned the {risk|issue|change request} '{name}'" (or "made the
 * owner of the decision '{name}'"). Fired whenever someone sets the Assigned To
 * (risk/issue/change) or Decision Owner (decision) to ANOTHER person. Skipped on
 * self-assignment, matching emitTaskAssigned. Deep-links to the Monitor tab's
 * matching sub-tab. Best-effort, like the other emitters.
 */
export async function emitMonitorItemAssigned(args: MonitorItemAssignedArgs): Promise<void> {
  const assignee = bareGuid(args.assigneeUserId);
  if (!assignee) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === assignee.toLowerCase()) return; // self-assign → no notification

  const projectId = bareGuid(args.projectId);
  const meta = MONITOR_ITEM_META[args.kind];
  const actionUrl = projectId
    ? `/projects/${projectId}?tab=monitor&subtab=${meta.subtab}`
    : `/projects/${projectId}`;
  const forProject = args.projectName ? ` for Project: ${args.projectName}` : '';
  const onProject = args.projectName ? ` on ${args.projectName}` : '';

  const title = args.kind === 'decision'
    ? `You were made the owner of the decision “${args.itemName}”${forProject}`
    : `You were assigned the ${meta.noun} “${args.itemName}”${forProject}`;
  const body = args.kind === 'decision'
    ? `You were made the owner of the decision “${args.itemName}”${onProject}.`
    : `You were assigned to the ${meta.noun} “${args.itemName}”${onProject}.`;

  return safeCreate({
    pmo_title: title,
    pmo_body: body,
    pmo_category: NOTIF_CATEGORY.TaskAssigned,
    pmo_isread: false,
    pmo_actionurl: actionUrl,
    'pmo_TargetUser@odata.bind': `/systemusers(${assignee})`,
    ...(projectId ? projectBindLoose(projectId) : {}),
  }, `monitor-item-assigned:${args.kind}`);
}

export type RequestDecisionKind = 'approved' | 'rejected' | 'converted';

export interface RequestDecisionArgs {
  /** systemuserid of the request's creator/requester (the recipient). */
  recipientUserId: string;
  requestId: string;
  requestName: string;
  decision: RequestDecisionKind;
  /** Optional responder display name (the team member who decided). */
  actorName?: string | null;
  /** Optional target-team display name, for cross-team request wording. */
  teamName?: string | null;
  /** Optional free-text response (rejection reason / acceptance note). Appended
   *  to the notification body so the requester sees WHY. */
  message?: string | null;
}

const DECISION_COPY: Record<RequestDecisionKind, string> = {
  approved: 'was approved',
  rejected: 'was rejected',
  converted: 'was converted to a project',
};

/** "Your request {name} was approved/rejected/converted" → the submitter.
 *  When actorName/teamName/message are supplied (cross-team requests) the body
 *  reads e.g. "Jane from Business Intelligence rejected your project “X” because:
 *  <message>" or "… accepted your project “X”. <message>". */
export function emitRequestDecision(args: RequestDecisionArgs): Promise<void> {
  const recipient = args.recipientUserId ? bareGuid(args.recipientUserId) : '';
  if (!recipient) return Promise.resolve();
  const who = args.actorName?.trim();
  const team = args.teamName?.trim();
  const msg = args.message?.trim();
  const actorClause = who ? `${who}${team ? ` from the ${team} team` : ''} ` : '';
  const verb = args.decision === 'rejected' ? 'rejected' : args.decision === 'converted' ? 'accepted and converted' : 'accepted';
  let body: string;
  if (args.decision === 'rejected') {
    // Operator-specified copy: 'Request for "X" Rejected by <rejecter> for <reason>'.
    const byClause = who ? ` by ${who}` : '';
    body = `Request for “${args.requestName}” Rejected${byClause}`;
    body += msg ? ` for: ${msg}` : `.`;
  } else {
    body = actorClause
      ? `${actorClause}${verb} your project “${args.requestName}”.`
      : `Your request “${args.requestName}” ${DECISION_COPY[args.decision]}.`;
    if (msg) body += `

${msg}`;
  }
  return safeCreate({
    pmo_title: args.decision === 'rejected' ? 'Request Rejected'
      : args.decision === 'converted' ? 'Request Converted' : 'Request Approved',
    pmo_body: body,
    pmo_category: NOTIF_CATEGORY.RequestDecision,
    pmo_isread: false,
    pmo_actionurl: `/intake/${bareGuid(args.requestId)}`,
    'pmo_TargetUser@odata.bind': `/systemusers(${recipient})`,
  }, 'request-decision');
}

export interface ProjectRequestedToTeamArgs {
  /** Target team GUID — every ACTIVE member is notified. */
  teamId: string;
  /** Target team display name, for the notification wording. */
  teamName?: string | null;
  requestId: string;
  requestName: string;
  /** Acting requester's systemuserid — skipped from the fan-out (don't notify
   *  yourself when you belong to the target team). */
  actorUserId?: string | null;
  /** Acting requester's display name, for the wording. */
  actorName?: string | null;
  /** Optional: when set, notify ONLY this team member (the requester picked a
   *  specific person) instead of fanning out to the whole team. */
  specificUserId?: string | null;
}

/**
 * Cross-team request fan-out: notify EVERY active member of the target team that
 * someone requested a project for their team. One pmo_notification per member
 * (notifications are per-user). Best-effort — a failure to notify one member
 * never blocks the others or the request creation. The requester is skipped.
 */
export async function emitProjectRequestedToTeam(args: ProjectRequestedToTeamArgs): Promise<void> {
  const teamId = args.teamId ? bareGuid(args.teamId) : '';
  if (!teamId) return;
  const actor = await resolveActor(args.actorUserId);
  let members: { systemuserid: string }[] = [];
  const specific = args.specificUserId ? bareGuid(args.specificUserId) : '';
  if (specific) {
    // Requester chose a specific person — notify only them.
    members = [{ systemuserid: specific }];
  } else {
    try {
      members = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid'],
        $filter: `teammembership_association/any(t: t/teamid eq ${teamId}) and isdisabled eq false`,
      });
    } catch (err) {
      console.warn('[notify] project-requested-to-team member lookup failed (non-fatal):', err);
      return;
    }
  }
  const teamClause = args.teamName?.trim() ? ` ${args.teamName.trim()}` : '';
  const whoClause = args.actorName?.trim() ? `${args.actorName.trim()} ` : 'Someone ';
  const title = `New project request for your${teamClause} team`;
  const body = `${whoClause}requested a project for your${teamClause} team: “${args.requestName}”.`;
  const actionUrl = `/intake/${bareGuid(args.requestId)}`;
  await Promise.all(members.map((m) => {
    const uid = bareGuid(m.systemuserid).toLowerCase();
    if (!uid || (actor && uid === actor)) return Promise.resolve();
    return safeCreate({
      pmo_title: title,
      pmo_body: body,
      pmo_category: NOTIF_CATEGORY.RequestSubmitted,
      pmo_isread: false,
      pmo_actionurl: actionUrl,
      'pmo_TargetUser@odata.bind': `/systemusers(${uid})`,
    }, 'project-requested-to-team');
  }));
}

export interface RequestCancelledToTeamArgs {
  /** Target team GUID — every ACTIVE member is notified the ask was withdrawn. */
  teamId: string;
  teamName?: string | null;
  requestId: string;
  requestName: string;
  /** Acting requester's systemuserid — skipped from the fan-out. */
  actorUserId?: string | null;
  /** Acting requester's display name, for the wording. */
  actorName?: string | null;
  /** Optional cancellation reason, appended to the notification body. */
  reason?: string | null;
}

/**
 * Requester withdrew a cross-team request → tell the target team it's off their
 * plate. Mirror of emitProjectRequestedToTeam (one pmo_notification per active
 * member, requester skipped, best-effort). This is the team-facing counterpart
 * to the requester's own Cancel action; emitRequestDecision handles the
 * requester-facing side of team decisions.
 */
export async function emitRequestCancelledToTeam(args: RequestCancelledToTeamArgs): Promise<void> {
  const teamId = args.teamId ? bareGuid(args.teamId) : '';
  if (!teamId) return;
  const actor = await resolveActor(args.actorUserId);
  let members: { systemuserid: string }[] = [];
  try {
    members = await dv.list<{ systemuserid: string }>(ENTITY_SETS.systemUser, {
      $select: ['systemuserid'],
      $filter: `teammembership_association/any(t: t/teamid eq ${teamId}) and isdisabled eq false`,
    });
  } catch (err) {
    console.warn('[notify] request-cancelled-to-team member lookup failed (non-fatal):', err);
    return;
  }
  const who = args.actorName?.trim() || 'the requester';
  const reason = args.reason?.trim();
  const title = `Request Cancelled`;
  let body = `Request for “${args.requestName}” Cancelled by ${who}.`;
  if (reason) body += `

Reason: ${reason}`;
  const actionUrl = `/intake/${bareGuid(args.requestId)}`;
  await Promise.all(members.map((m) => {
    const uid = bareGuid(m.systemuserid).toLowerCase();
    if (!uid || (actor && uid === actor)) return Promise.resolve();
    return safeCreate({
      pmo_title: title,
      pmo_body: body,
      pmo_category: NOTIF_CATEGORY.RequestDecision,
      pmo_isread: false,
      pmo_actionurl: actionUrl,
      'pmo_TargetUser@odata.bind': `/systemusers(${uid})`,
    }, 'request-cancelled-to-team');
  }));
}

export interface FeedbackAssignedArgs {
  /** systemuserid of the person the feedback is assigned to. */
  assigneeUserId: string;
  /** systemuserid of the person doing the assigning (to skip self-assign). */
  actorUserId?: string | null;
  feedbackId: string;
  feedbackTitle: string;
  /** 'bug' | 'enhancement' — drives the wording only. */
  kind: 'bug' | 'enhancement';
}

/**
 * "You were assigned a bug report / enhancement: {title}" → the assignee.
 * Fired when someone sets the Assigned To (ownerid) on a feedback row to another
 * person. Skipped on self-assignment. Deep-links to the admin triage detail
 * page (assignees are admins/triagers). Best-effort like the other emitters.
 */
export async function emitFeedbackAssigned(args: FeedbackAssignedArgs): Promise<void> {
  const assignee = bareGuid(args.assigneeUserId);
  if (!assignee) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === assignee.toLowerCase()) return; // self-assign → no notification

  const label = args.kind === 'enhancement' ? 'enhancement request' : 'bug report';
  return safeCreate({
    pmo_title: `You were assigned a ${label}: ${args.feedbackTitle}`,
    pmo_body: `A ${label} “${args.feedbackTitle}” was assigned to you.`,
    pmo_category: NOTIF_CATEGORY.TaskAssigned,
    pmo_isread: false,
    pmo_actionurl: `/admin/user-feedback/${bareGuid(args.feedbackId)}`,
    'pmo_TargetUser@odata.bind': `/systemusers(${assignee})`,
  }, 'feedback-assigned');
}

export interface FeedbackResolvedArgs {
  /** systemuserid of the ORIGINAL submitter (annotation _createdby_value). */
  submitterUserId: string | undefined | null;
  feedbackId: string;
  feedbackTitle: string;
  /** 'bug' | 'enhancement' — drives wording only. */
  kind: 'bug' | 'enhancement';
  /** Display name of the assigned user who resolved it ("Completed by …"). */
  resolvedByName?: string | null;
  /** Admin response text (mention chips already flattened by the caller). */
  responseText?: string | null;
  /** Acting user; skip notifying a submitter who resolved their own item. */
  actorUserId?: string | null;
}

/**
 * "Your bug report / enhancement was resolved: {title}" → the ORIGINAL
 * submitter. Fired from the admin triage save when Status transitions INTO
 * Resolved. Body includes who completed it and the admin response, when present.
 * Deep-links to /intake (the submitter's reachable queue — the admin detail
 * page is behind AdminRoute). Skipped when the submitter resolved their own
 * item. Best-effort like the other emitters; never blocks the save.
 */
export async function emitFeedbackResolved(args: FeedbackResolvedArgs): Promise<void> {
  const submitter = args.submitterUserId ? bareGuid(args.submitterUserId) : '';
  if (!submitter) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === submitter.toLowerCase()) return; // resolved own item → no notification

  const label = args.kind === 'enhancement' ? 'enhancement request' : 'bug report';
  const completedBy = args.resolvedByName?.trim();
  const response = args.responseText?.trim();
  let body = `Your ${label} “${args.feedbackTitle}” was marked Resolved.`;
  if (completedBy) body += ` Completed by ${completedBy}.`;
  if (response) body += `

Admin response: ${response}`;
  return safeCreate({
    pmo_title: `Your ${label} was resolved: ${args.feedbackTitle}`,
    pmo_body: body,
    pmo_category: NOTIF_CATEGORY.RequestDecision,
    pmo_isread: false,
    pmo_actionurl: '/intake',
    'pmo_TargetUser@odata.bind': `/systemusers(${submitter})`,
  }, 'feedback-resolved');
}

export interface FeedbackOnHoldArgs {
  /** systemuserid of the ORIGINAL submitter. */
  submitterUserId: string | undefined | null;
  feedbackId: string;
  feedbackTitle: string;
  kind: 'bug' | 'enhancement';
  /** Admin message to the creator (required — only sent when the admin chose Send). */
  responseText?: string | null;
  actorUserId?: string | null;
}

/**
 * "Your bug report / enhancement was placed On Hold: {title}" → the ORIGINAL
 * submitter. Fired ONLY when the admin chooses "On Hold & Send" (never on
 * "On Hold without Response"). Skipped when the submitter put their own item on
 * hold. Best-effort like the other emitters.
 */
export async function emitFeedbackOnHold(args: FeedbackOnHoldArgs): Promise<void> {
  const submitter = args.submitterUserId ? bareGuid(args.submitterUserId) : '';
  if (!submitter) return;
  const actor = await resolveActor(args.actorUserId);
  if (actor && actor === submitter.toLowerCase()) return;

  const label = args.kind === 'enhancement' ? 'enhancement request' : 'bug report';
  const response = args.responseText?.trim();
  let body = `Your ${label} “${args.feedbackTitle}” was placed On Hold.`;
  if (response) body += `

Admin response: ${response}`;
  return safeCreate({
    pmo_title: `Your ${label} was placed on hold: ${args.feedbackTitle}`,
    pmo_body: body,
    pmo_category: NOTIF_CATEGORY.RequestDecision,
    pmo_isread: false,
    pmo_actionurl: '/intake',
    'pmo_TargetUser@odata.bind': `/systemusers(${submitter})`,
  }, 'feedback-onhold');
}
