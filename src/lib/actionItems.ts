/**
 * actionItems — the single normalization layer behind the Intake Queue and
 * every "requires action" count in the app.
 *
 * The queue merges THREE Dataverse tables onto one shape:
 *   - pmo_projectrequest  (project/program intake requests, the triage workflow)
 *   - pmo_userfeedback    (app bug reports / enhancement suggestions)
 *   - pmo_notification     (per-user events: task assigned, clarification asked,
 *                          request decided) — the red-bubble drivers
 *
 * Why this file is pure (no React): the sidebar badge, the "Requires action"
 * pill on the list, and the NotificationCenter bell were computing DIFFERENT
 * sets, so their numbers drifted (the recurring mismatch bug). Everything now
 * derives from `selectActionItems`, so the counts are identical by construction
 * and the logic is unit-testable without mounting components.
 */
import type { ProjectRequest } from '../models/projectRequest.model';
import type { UserFeedback } from '../models/userFeedback.model';
import type { Notification } from '../models/notification.model';
import { REQUEST_STATUS, FEEDBACK_STATUS, FEEDBACK_TYPE } from './constants';

export type ActionItemSource = 'request' | 'feedback' | 'notification';

export interface ActionItem {
  /** Stable key: the underlying record id. */
  id: string;
  source: ActionItemSource;
  title: string;
  /** Where a click on this item should navigate. */
  actionUrl: string;
  createdon: string;
  /** Drives the rose highlight + the red-bubble count. */
  isActionable: boolean;
  /** Notifications only — unread ones are actionable; requests ignore this. */
  isRead: boolean;
  /** true when this request has been converted to a project/program. */
  isConverted: boolean;
  /** true when this is a not-yet-submitted draft request. */
  isDraft: boolean;
  /** true when the item is only ACTIONABLE for its owner, even though teammates
   *  /admins can SEE it. Covers drafts (owner must finish/delete) and requests
   *  Awaiting Clarification (the ball is back in the submitter's court). For
   *  everyone else these are visible in the queue but never a required action. */
  isOwnerActionOnly: boolean;
  /** Target team GUID (requests only), lower-cased, braces stripped. */
  teamId?: string;
  /** User this item belongs to (creator/requestedby for requests, targetuser
   *  for notifications), lower-cased, braces stripped. */
  ownerUserId?: string;
  /** Notifications only — pmo_category value (NOTIF_CATEGORY). Lets the queue
   *  color decision notifications (Cancelled / Rejected) red instead of amber. */
  notifCategory?: number;
  /** Original record, for row rendering / delete / audit. */
  raw: ProjectRequest | UserFeedback | Notification;
}

/** Normalize a Dataverse guid (may arrive as `{GUID}` or with mixed case). */
export function normId(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.replace(/[{}]/g, '').trim().toLowerCase();
  return s.length ? s : undefined;
}

export function requestToActionItem(r: ProjectRequest): ActionItem {
  const status = r.pmo_status ?? null;
  const isConverted = status === REQUEST_STATUS.Converted;
  const isDraft = status === REQUEST_STATUS.Draft;
  // "Requires action" is ONLY: my own outstanding draft (I must finish or
  // delete it) or an assignment notification (handled separately). A submitted /
  // in-triage / awaiting-clarification request is visible in the queue but is
  // NOT anyone's required action here — not teammates', not admins'. So only a
  // draft is actionable, and only for its owner (enforced in selectActionItems).
  return {
    id: r.pmo_projectrequestid,
    source: 'request',
    title: r.pmo_name ?? 'Untitled Request',
    actionUrl: `/intake/${r.pmo_projectrequestid}`,
    createdon: r.createdon ?? '',
    isActionable: isDraft,
    isRead: true, // requests are not a read/unread concept
    isConverted,
    isDraft,
    // A draft is the owner's ball; nobody else is required to act on it.
    isOwnerActionOnly: isDraft,
    teamId: normId(r['_pmo_targetteam_value']),
    ownerUserId: normId(r['_pmo_requestedby_value'] ?? r['_createdby_value']),
    raw: r,
  };
}

export function feedbackToActionItem(f: UserFeedback): ActionItem {
  const isDraft = (f.pmo_status ?? null) === FEEDBACK_STATUS.Draft;
  // A draft opens back in the feedback FORM (prefilled) so the author can
  // finish or delete it — exactly like a project/program request draft.
  // Submitted feedback opens the admin triage detail page.
  const kind = f.pmo_feedbacktype === FEEDBACK_TYPE.Enhancement ? 'enhancement' : 'bug';
  return {
    id: f.pmo_userfeedbackid,
    source: 'feedback',
    title: f.pmo_title ?? 'Untitled',
    actionUrl: isDraft
      ? `/intake/feedback/${kind}/${f.pmo_userfeedbackid}`
      : `/admin/user-feedback/${f.pmo_userfeedbackid}`,
    createdon: f.createdon ?? '',
    // A draft is actionable for its creator (finish or delete). Submitted
    // feedback has its own admin triage workflow and never drives the red
    // bubble. The draft-actionability gate in selectActionItems restricts a
    // draft's actionability to its owner.
    isActionable: isDraft,
    isRead: true,
    // A SUBMITTED (published) feedback/bug is treated like a converted request:
    // it drops out of the default queue into the "Show converted" bucket, so the
    // default view only shows drafts still needing to be finished.
    isConverted: !isDraft,
    isDraft,
    // A feedback draft is the author's ball, same as a request draft.
    isOwnerActionOnly: isDraft,
    teamId: undefined,
    ownerUserId: normId((f as { '_createdby_value'?: string })['_createdby_value']),
    raw: f,
  };
}

export function notificationToActionItem(n: Notification): ActionItem {
  const isRead = n.pmo_isread === true;
  return {
    id: n.pmo_notificationid,
    source: 'notification',
    title: n.pmo_title ?? 'Notification',
    actionUrl: n.pmo_actionurl || '/intake',
    createdon: n.createdon ?? '',
    // An unread notification is an item that requires the user's attention.
    isActionable: !isRead,
    isRead,
    isConverted: false,
    isDraft: false,
    isOwnerActionOnly: false,
    teamId: undefined,
    ownerUserId: normId(n['_pmo_targetuser_value']),
    notifCategory: n.pmo_category,
    raw: n,
  };
}

export interface SelectArgs {
  requests: ProjectRequest[];
  feedback: UserFeedback[];
  notifications: Notification[];
  /** Current user guid (any casing / brace style). */
  userId?: string | null;
  /** Team guids the user belongs to (any casing / brace style). */
  teamIds?: Iterable<string>;
  isAdmin: boolean;
}

export interface ActionItemSelection {
  /** Non-converted, in-scope items, newest first. */
  items: ActionItem[];
  /** Converted requests, kept separate so the gallery can collapse them. */
  converted: ActionItem[];
  /** The one true count: actionable, still-unread, in-scope, non-converted. */
  actionableCount: number;
}

/**
 * The single source of truth. Applies "team + mine" scoping for non-admins,
 * splits converted requests into their own bucket, and returns the unified
 * actionable count that every consumer reads.
 *
 * Scoping (non-admin): a request is in scope if its target team is one of mine
 * OR I created/requested it. Notifications are inherently mine (the query only
 * ever fetches targetuser == me). Feedback is scoped to items I authored.
 * Admins see everything.
 *
 * Draft actionability: a not-yet-submitted draft is VISIBLE under normal
 * team+mine scoping (teammates on the target team, and admins, can see it), but
 * it is only ACTIONABLE for its creator — the owner must finish or delete it.
 * A colleague's draft never counts toward anyone else's "requires action" set,
 * and remains non-editable / non-deletable by non-owners (delete is owner-only
 * at the page level). Once submitted it becomes a normal team/triage item.
 */
export function selectActionItems(args: SelectArgs): ActionItemSelection {
  const me = normId(args.userId);
  const myTeams = new Set<string>();
  for (const t of args.teamIds ?? []) {
    const n = normId(t);
    if (n) myTeams.add(n);
  }

  const inScope = (it: ActionItem): boolean => {
    if (args.isAdmin) return true;
    switch (it.source) {
      case 'request':
        // Drafts follow the same team+mine visibility as any other request —
        // teammates and admins CAN see a colleague's draft. They just can't act
        // on it (see actionability below) and can't edit/delete it (owner-only).
        return (!!it.teamId && myTeams.has(it.teamId)) || (!!me && it.ownerUserId === me);
      case 'notification':
        // Notifications are fetched per-user; still guard defensively.
        return !me || it.ownerUserId === me;
      case 'feedback':
        return !!me && it.ownerUserId === me;
    }
  };

  // "Requires action" is strictly personal: my own outstanding drafts (I must
  // finish or delete) and unread assignment notifications (I must acknowledge).
  // Everything a draft is owned by someone else — even for teammates/admins who
  // can SEE it — is not their action. Since only drafts + unread notifications
  // are ever isActionable, we just clear a draft's actionability when it isn't
  // mine.
  const finalizeActionability = (it: ActionItem): ActionItem =>
    it.isOwnerActionOnly && it.ownerUserId !== me ? { ...it, isActionable: false } : it;

  const mapped: ActionItem[] = [
    ...args.requests.map(requestToActionItem),
    ...args.feedback.map(feedbackToActionItem),
    ...args.notifications.map(notificationToActionItem),
  ].filter(inScope).map(finalizeActionability);

  const items: ActionItem[] = [];
  const converted: ActionItem[] = [];
  for (const it of mapped) {
    (it.isConverted ? converted : items).push(it);
  }

  const byNewest = (a: ActionItem, b: ActionItem) => b.createdon.localeCompare(a.createdon);
  items.sort(byNewest);
  converted.sort(byNewest);

  const actionableCount = items.filter((it) => it.isActionable).length;
  return { items, converted, actionableCount };
}

/**
 * True when a notification has nowhere useful to navigate on click — an
 * informational message whose content lives entirely in pmo_body (feedback
 * resolved / on-hold decisions to the submitter). These carry an empty or
 * sentinel /intake actionUrl because their real detail page is admin-gated and
 * the submitter cannot reach it. Callers open a read-only detail dialog for
 * these instead of navigating.
 */
export function isInformationalNotification(item: ActionItem): boolean {
  if (item.source !== 'notification') return false;
  const url = (item.actionUrl || '').trim();
  return url === '' || url === '/intake';
}

/** Exposed for the delete guard on the list. */
export const REQUEST_DELETABLE_STATUSES: ReadonlySet<number> = new Set([
  REQUEST_STATUS.Draft,
  REQUEST_STATUS.Submitted,
]);

export const FEEDBACK_DELETABLE_STATUSES: ReadonlySet<number> = new Set([
  FEEDBACK_STATUS.Draft,
]);
