import { describe, expect, it } from 'vitest';
import {
  selectActionItems,
  requestToActionItem,
  notificationToActionItem,
  isInformationalNotification,
  normId,
} from './actionItems';
import { REQUEST_STATUS, FEEDBACK_STATUS, NOTIF_CATEGORY } from './constants';
import type { ProjectRequest } from '../models/projectRequest.model';
import type { UserFeedback } from '../models/userFeedback.model';
import type { Notification } from '../models/notification.model';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const TEAM_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEAM_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function req(over: Partial<ProjectRequest> = {}): ProjectRequest {
  return {
    pmo_projectrequestid: over.pmo_projectrequestid ?? crypto.randomUUID(),
    pmo_name: 'R',
    pmo_status: REQUEST_STATUS.Submitted,
    createdon: '2026-01-01T00:00:00Z',
    ...over,
  } as ProjectRequest;
}

function notif(over: Partial<Notification> = {}): Notification {
  return {
    pmo_notificationid: over.pmo_notificationid ?? crypto.randomUUID(),
    pmo_title: 'N',
    pmo_category: NOTIF_CATEGORY.TaskAssigned,
    pmo_isread: false,
    createdon: '2026-02-01T00:00:00Z',
    '_pmo_targetuser_value': ME,
    ...over,
  } as Notification;
}

function fb(over: Partial<UserFeedback> = {}): UserFeedback {
  return {
    pmo_userfeedbackid: over.pmo_userfeedbackid ?? crypto.randomUUID(),
    pmo_title: 'F',
    createdon: '2026-03-01T00:00:00Z',
    ...over,
  } as UserFeedback;
}

const EMPTY = { requests: [], feedback: [], notifications: [] };

describe('normId', () => {
  it('strips braces and lower-cases', () => {
    expect(normId('{ABCD}')).toBe('abcd');
  });
  it('returns undefined for empty/nullish', () => {
    expect(normId(undefined)).toBeUndefined();
    expect(normId('')).toBeUndefined();
    expect(normId('{}')).toBeUndefined();
  });
});

describe('requestToActionItem', () => {
  it('only a Draft is actionable (owner must finish or delete it)', () => {
    expect(requestToActionItem(req({ pmo_status: REQUEST_STATUS.Draft })).isActionable).toBe(true);
  });
  it('Submitted/InTriage/AwaitingClarification are NOT required action (visible, but not mine to complete)', () => {
    for (const s of [REQUEST_STATUS.Submitted, REQUEST_STATUS.InTriage, REQUEST_STATUS.AwaitingClarification]) {
      expect(requestToActionItem(req({ pmo_status: s })).isActionable).toBe(false);
    }
  });
  it('marks Approved/Converted as not actionable', () => {
    for (const s of [REQUEST_STATUS.Approved, REQUEST_STATUS.Converted]) {
      expect(requestToActionItem(req({ pmo_status: s })).isActionable).toBe(false);
    }
  });
  it('flags converted requests', () => {
    expect(requestToActionItem(req({ pmo_status: REQUEST_STATUS.Converted })).isConverted).toBe(true);
  });
});

describe('notificationToActionItem', () => {
  it('unread notification is actionable', () => {
    expect(notificationToActionItem(notif({ pmo_isread: false })).isActionable).toBe(true);
  });
  it('read notification is not actionable', () => {
    expect(notificationToActionItem(notif({ pmo_isread: true })).isActionable).toBe(false);
  });
  it('falls back to /intake when no action url', () => {
    expect(notificationToActionItem(notif({ pmo_actionurl: undefined })).actionUrl).toBe('/intake');
  });
});

describe('isInformationalNotification', () => {
  it('true for a notification with no action url', () => {
    expect(isInformationalNotification(notificationToActionItem(notif({ pmo_actionurl: undefined })))).toBe(true);
  });
  it('true for the /intake sentinel (feedback resolved / on-hold)', () => {
    expect(isInformationalNotification(notificationToActionItem(notif({ pmo_actionurl: '/intake' })))).toBe(true);
  });
  it('false when the notification has a real deep-link', () => {
    expect(isInformationalNotification(notificationToActionItem(notif({ pmo_actionurl: '/admin/user-feedback/abc' })))).toBe(false);
    expect(isInformationalNotification(notificationToActionItem(notif({ pmo_actionurl: '/projects/p1?tab=tasks' })))).toBe(false);
  });
  it('false for non-notification sources even if url is /intake', () => {
    expect(isInformationalNotification(requestToActionItem(req({ pmo_status: REQUEST_STATUS.Draft })))).toBe(false);
  });
});

describe('selectActionItems — converted bucketing', () => {
  it('separates converted requests from the main list', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [
        req({ pmo_status: REQUEST_STATUS.Submitted, '_pmo_targetteam_value': TEAM_A }),
        req({ pmo_status: REQUEST_STATUS.Converted, '_pmo_targetteam_value': TEAM_A }),
      ],
      isAdmin: true,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.converted).toHaveLength(1);
  });

  it('a feedback DRAFT stays in the main list (owner must finish/delete it)', () => {
    const sel = selectActionItems({
      ...EMPTY,
      feedback: [fb({ pmo_status: FEEDBACK_STATUS.Draft, '_createdby_value': ME })],
      userId: ME, isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.converted).toHaveLength(0);
    expect(sel.items[0].isActionable).toBe(true);
  });

  it('a SUBMITTED (published) feedback is bucketed as converted, out of the default view', () => {
    const sel = selectActionItems({
      ...EMPTY,
      feedback: [fb({ pmo_status: FEEDBACK_STATUS.New, '_createdby_value': ME })],
      userId: ME, isAdmin: false,
    });
    expect(sel.items).toHaveLength(0);
    expect(sel.converted).toHaveLength(1);
    expect(sel.actionableCount).toBe(0);
  });

  it("an admin sees a teammate's feedback draft but it is not their required action", () => {
    const sel = selectActionItems({
      ...EMPTY,
      feedback: [fb({ pmo_status: FEEDBACK_STATUS.Draft, '_createdby_value': OTHER })],
      userId: ME, isAdmin: true,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].isActionable).toBe(false);
    expect(sel.actionableCount).toBe(0);
  });
});

describe('selectActionItems — team+mine scoping (non-admin)', () => {
  it('includes requests on my team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ '_pmo_targetteam_value': TEAM_A, '_pmo_requestedby_value': OTHER })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
  });
  it('excludes requests on a team I am not on and did not create', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ '_pmo_targetteam_value': TEAM_B, '_pmo_requestedby_value': OTHER })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(0);
  });
  it('includes a request I created even if it is another team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ '_pmo_targetteam_value': TEAM_B, '_pmo_requestedby_value': ME })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
  });
  it('includes notifications targeted at me even cross-team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      notifications: [notif({ '_pmo_targetuser_value': ME })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
  });
  it('admin sees everything regardless of team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ '_pmo_targetteam_value': TEAM_B, '_pmo_requestedby_value': OTHER })],
      userId: ME, teamIds: [TEAM_A], isAdmin: true,
    });
    expect(sel.items).toHaveLength(1);
  });
  it('a Submitted request is VISIBLE but never a required action (not mine to complete), even on my team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Submitted, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: true,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].isActionable).toBe(false);
    expect(sel.actionableCount).toBe(0);
  });
});

describe('selectActionItems — draft privacy', () => {
  it('a draft is visible to its creator', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_requestedby_value': ME, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
  });
  it("a teammate SEES someone else's draft on a shared team, but it is not actionable", () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].isActionable).toBe(false);
    expect(sel.actionableCount).toBe(0);
  });
  it("an ADMIN sees someone else's draft, but it is not actionable for them", () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: true,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].isActionable).toBe(false);
    expect(sel.actionableCount).toBe(0);
  });
  it('once submitted, the same request becomes visible to the team', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Submitted, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
  });
  it('drafts never count toward actionableCount for non-owners', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: true,
    });
    expect(sel.actionableCount).toBe(0);
  });
  it("Awaiting Clarification is visible to a teammate but is NOT their required action (it's the submitter's ball)", () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.AwaitingClarification, '_pmo_requestedby_value': OTHER, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.items[0].isActionable).toBe(false);
    expect(sel.actionableCount).toBe(0);
  });
  it('Awaiting Clarification is NOT a required action even for the submitter (only drafts + assignments are)', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.AwaitingClarification, '_pmo_requestedby_value': ME, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.items).toHaveLength(1);
    expect(sel.actionableCount).toBe(0);
  });
});

describe('selectActionItems — unified actionableCount (the mismatch fix)', () => {
  it('counts only actionable, non-converted, in-scope items', () => {
    const sel = selectActionItems({
      requests: [
        req({ pmo_status: REQUEST_STATUS.Submitted, '_pmo_targetteam_value': TEAM_A }),   // visible, NOT my action
        req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_targetteam_value': TEAM_A }),        // not my draft -> not actionable
        req({ pmo_status: REQUEST_STATUS.Converted, '_pmo_targetteam_value': TEAM_A }),    // converted -> excluded
        req({ pmo_status: REQUEST_STATUS.Submitted, '_pmo_targetteam_value': TEAM_B }),    // out of scope
      ],
      feedback: [fb({ '_createdby_value': ME })],                                          // submitted -> converted, not actionable
      notifications: [
        notif({ pmo_isread: false }),                                                     // actionable (assignment)
        notif({ pmo_isread: true }),                                                       // read -> not
      ],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    // Only the 1 unread assignment notification. Submitted/triage requests and
    // others' drafts are visible but never a required action.
    expect(sel.actionableCount).toBe(1);
  });

  it('my OWN draft counts toward actionableCount (must finish or delete)', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.Draft, '_pmo_requestedby_value': ME, '_pmo_targetteam_value': TEAM_A })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.actionableCount).toBe(1);
  });

  it('count equals items.filter(isActionable) — the invariant every consumer relies on', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [req({ pmo_status: REQUEST_STATUS.InTriage, '_pmo_targetteam_value': TEAM_A })],
      notifications: [notif(), notif({ pmo_isread: true })],
      userId: ME, teamIds: [TEAM_A], isAdmin: false,
    });
    expect(sel.actionableCount).toBe(sel.items.filter((i) => i.isActionable).length);
  });
});

describe('selectActionItems — ordering', () => {
  it('returns items newest-first', () => {
    const sel = selectActionItems({
      ...EMPTY,
      requests: [
        req({ pmo_projectrequestid: 'old', createdon: '2026-01-01T00:00:00Z', '_pmo_targetteam_value': TEAM_A }),
        req({ pmo_projectrequestid: 'new', createdon: '2026-05-01T00:00:00Z', '_pmo_targetteam_value': TEAM_A }),
      ],
      isAdmin: true,
    });
    expect(sel.items[0].id).toBe('new');
  });
});
