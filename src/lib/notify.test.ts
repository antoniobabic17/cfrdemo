import { describe, expect, it, vi, beforeEach } from 'vitest';

const createNotification = vi.fn();
vi.mock('../api/notifications.api', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

// notify.resolveActor falls back to resolveCurrentUserId when no real actor is
// passed. Tests always pass an explicit actor guid, so this returns null and
// the fallback is never used — but mock it so the real Power Apps SDK module
// isn't imported during the unit test.
const dvList = vi.fn();
vi.mock('./dataverseClient', () => ({
  resolveCurrentUserId: () => Promise.resolve(null),
  list: (...args: unknown[]) => dvList(...args),
}));

import { emitTaskAssigned, emitClarificationRequested, emitRequestDecision, emitRoleAssigned, emitMonitorItemAssigned, emitProjectRequestedToTeam } from './notify';
import { NOTIF_CATEGORY } from './constants';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  createNotification.mockReset();
  createNotification.mockResolvedValue({});
  dvList.mockReset();
  dvList.mockResolvedValue([]);
});

describe('emitTaskAssigned', () => {
  it('creates a TaskAssigned notification bound to the assignee', async () => {
    await emitTaskAssigned({ assigneeUserId: OTHER, actorUserId: ME, taskName: 'Do X', projectId: 'proj1', projectName: 'Alpha' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_category).toBe(NOTIF_CATEGORY.TaskAssigned);
    expect(payload['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
    expect(payload['pmo_Project@odata.bind']).toBe('/msdyn_projects(proj1)');
    expect(payload.pmo_isread).toBe(false);
    expect(payload.pmo_actionurl).toBe('/projects/proj1');
    expect(payload.pmo_title).toBe('You were assigned the task “Do X” for Project: Alpha');
  });

  it('deep-links to the board + task when taskId is provided', async () => {
    await emitTaskAssigned({ assigneeUserId: OTHER, actorUserId: ME, taskName: 'Do X', projectId: 'proj1', taskId: 'task9' });
    expect(createNotification.mock.calls[0][0].pmo_actionurl).toBe('/projects/proj1?tab=tasks&view=board&task=task9');
  });

  it('skips self-assignment', async () => {
    await emitTaskAssigned({ assigneeUserId: ME, actorUserId: ME, taskName: 'Do X', projectId: 'p' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('normalizes braced guids', async () => {
    await emitTaskAssigned({ assigneeUserId: `{${OTHER}}`, actorUserId: ME, taskName: 'X', projectId: 'p' });
    expect(createNotification.mock.calls[0][0]['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
  });

  it('never throws when the create fails (best-effort)', async () => {
    createNotification.mockRejectedValueOnce(new Error('boom'));
    await expect(emitTaskAssigned({ assigneeUserId: OTHER, actorUserId: ME, taskName: 'X', projectId: 'p' })).resolves.toBeUndefined();
  });
});

describe('emitClarificationRequested', () => {
  it('creates a ClarificationRequested notification to the submitter', async () => {
    await emitClarificationRequested({ recipientUserId: OTHER, requestId: 'r1', requestName: 'Req', question: 'why?' });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_category).toBe(NOTIF_CATEGORY.ClarificationRequested);
    expect(payload.pmo_actionurl).toBe('/intake/r1');
  });
  it('no-ops without a recipient', async () => {
    await emitClarificationRequested({ recipientUserId: '', requestId: 'r1', requestName: 'Req' });
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('emitRoleAssigned', () => {
  it('notifies a project PM with a project deep-link', async () => {
    await emitRoleAssigned({ assigneeUserId: OTHER, actorUserId: ME, role: 'Project Manager', entityKind: 'project', entityId: 'proj1', entityName: 'Alpha' });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_title).toBe('You were assigned as Project Manager for Project: Alpha');
    expect(payload.pmo_actionurl).toBe('/projects/proj1');
    expect(payload['pmo_Project@odata.bind']).toBe('/msdyn_projects(proj1)');
    expect(payload['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
  });

  it('notifies a program manager with a program deep-link + program bind', async () => {
    await emitRoleAssigned({ assigneeUserId: OTHER, actorUserId: ME, role: 'Program Manager', entityKind: 'program', entityId: 'prog1', entityName: 'Beta' });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_actionurl).toBe('/programs/prog1');
    expect(payload['pmo_Program@odata.bind']).toBe('/msdyn_projectprograms(prog1)');
    expect(payload['pmo_Project@odata.bind']).toBeUndefined();
  });

  it('skips self-assignment', async () => {
    await emitRoleAssigned({ assigneeUserId: ME, actorUserId: ME, role: 'Executive Sponsor', entityKind: 'project', entityId: 'p' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('no-ops without an assignee', async () => {
    await emitRoleAssigned({ assigneeUserId: '', actorUserId: ME, role: 'Project Manager', entityKind: 'project', entityId: 'p' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('never throws when the create fails (best-effort)', async () => {
    createNotification.mockRejectedValueOnce(new Error('boom'));
    await expect(emitRoleAssigned({ assigneeUserId: OTHER, actorUserId: ME, role: 'Project Manager', entityKind: 'project', entityId: 'p' })).resolves.toBeUndefined();
  });
});

describe('emitRequestDecision', () => {
  it.each(['approved', 'rejected', 'converted'] as const)('creates a RequestDecision (%s)', async (decision) => {
    await emitRequestDecision({ recipientUserId: OTHER, requestId: 'r1', requestName: 'Req', decision });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_category).toBe(NOTIF_CATEGORY.RequestDecision);
    expect(payload.pmo_title.toLowerCase()).toContain(decision);
  });

  it('enriches the rejected body with actor, team, and reason', async () => {
    await emitRequestDecision({ recipientUserId: OTHER, requestId: 'r1', requestName: 'Dash', decision: 'rejected', actorName: 'Jane', teamName: 'BI', message: 'out of scope' });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_body).toContain('Jane');
    expect(payload.pmo_body).toContain('Rejected');
    expect(payload.pmo_body).toContain('Dash');
    expect(payload.pmo_body).toContain('out of scope');
  });
});

describe('emitProjectRequestedToTeam', () => {
  it('fans out one notification per active team member, skipping the requester', async () => {
    dvList.mockResolvedValueOnce([{ systemuserid: ME }, { systemuserid: OTHER }]);
    await emitProjectRequestedToTeam({ teamId: 'team1', teamName: 'BI', requestId: 'r1', requestName: 'Dash', actorUserId: ME });
    // ME is the requester → skipped; only OTHER is notified.
    expect(createNotification).toHaveBeenCalledTimes(1);
    const payload = createNotification.mock.calls[0][0];
    expect(payload['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
    expect(payload.pmo_category).toBe(NOTIF_CATEGORY.RequestSubmitted);
    expect(payload.pmo_body).toContain('BI');
    expect(payload.pmo_actionurl).toBe('/intake/r1');
  });

  it('notifies ONLY the specific user when specificUserId is set (no team query)', async () => {
    await emitProjectRequestedToTeam({ teamId: 'team1', requestId: 'r1', requestName: 'Dash', actorUserId: ME, specificUserId: OTHER });
    expect(dvList).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0]['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
  });

  it('does nothing when teamId is empty', async () => {
    await emitProjectRequestedToTeam({ teamId: '', requestId: 'r1', requestName: 'Dash' });
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('emitMonitorItemAssigned', () => {
  it.each([
    ['risk',   'risks',     'You were assigned the risk “R1” for Project: Alpha'],
    ['issue',  'issues',    'You were assigned the issue “R1” for Project: Alpha'],
    ['change', 'changes',   'You were assigned the change request “R1” for Project: Alpha'],
  ] as const)('notifies the assignee for a %s with the right sub-tab + copy', async (kind, subtab, title) => {
    await emitMonitorItemAssigned({ assigneeUserId: OTHER, actorUserId: ME, kind, itemName: 'R1', projectId: 'proj1', projectName: 'Alpha' });
    expect(createNotification).toHaveBeenCalledTimes(1);
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_category).toBe(NOTIF_CATEGORY.TaskAssigned);
    expect(payload['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
    expect(payload['pmo_Project@odata.bind']).toBe('/msdyn_projects(proj1)');
    expect(payload.pmo_actionurl).toBe(`/projects/proj1?tab=monitor&subtab=${subtab}`);
    expect(payload.pmo_title).toBe(title);
  });

  it('uses owner wording + decisions sub-tab for a decision', async () => {
    await emitMonitorItemAssigned({ assigneeUserId: OTHER, actorUserId: ME, kind: 'decision', itemName: 'D1', projectId: 'proj1', projectName: 'Alpha' });
    const payload = createNotification.mock.calls[0][0];
    expect(payload.pmo_actionurl).toBe('/projects/proj1?tab=monitor&subtab=decisions');
    expect(payload.pmo_title).toBe('You were made the owner of the decision “D1” for Project: Alpha');
  });

  it('skips self-assignment', async () => {
    await emitMonitorItemAssigned({ assigneeUserId: ME, actorUserId: ME, kind: 'risk', itemName: 'R1', projectId: 'p' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('no-ops without an assignee', async () => {
    await emitMonitorItemAssigned({ assigneeUserId: '', actorUserId: ME, kind: 'risk', itemName: 'R1', projectId: 'p' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('normalizes braced guids', async () => {
    await emitMonitorItemAssigned({ assigneeUserId: `{${OTHER}}`, actorUserId: ME, kind: 'issue', itemName: 'R1', projectId: 'p' });
    expect(createNotification.mock.calls[0][0]['pmo_TargetUser@odata.bind']).toBe(`/systemusers(${OTHER})`);
  });

  it('never throws when the create fails (best-effort)', async () => {
    createNotification.mockRejectedValueOnce(new Error('boom'));
    await expect(emitMonitorItemAssigned({ assigneeUserId: OTHER, actorUserId: ME, kind: 'change', itemName: 'R1', projectId: 'p' })).resolves.toBeUndefined();
  });
});
