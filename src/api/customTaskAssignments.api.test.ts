import { describe, expect, it } from 'vitest';
import { normalizeCustomAssignment, buildCustomAssignmentCreatePayload } from './customTaskAssignments.api';

describe('normalizeCustomAssignment', () => {
  it('re-labels pmo_* lookups to the msdyn_* ResourceAssignment shape', () => {
    const out = normalizeCustomAssignment({
      pmo_taskassignmentid: 'asg-1',
      pmo_name: 'Amy : Design',
      _pmo_task_value: 'task-g',
      _pmo_projectteam_value: 'ptm-g',
      _pmo_projectref_value: 'proj-g',
      '_pmo_projectteam_value@OData.Community.Display.V1.FormattedValue': 'Amy',
    });
    expect(out.msdyn_resourceassignmentid).toBe('asg-1');
    expect(out['_msdyn_taskid_value']).toBe('task-g');
    expect(out['_msdyn_projectteamid_value']).toBe('ptm-g');
    expect(out['_msdyn_projectid_value']).toBe('proj-g');
    expect(out['_msdyn_projectteamid_value@OData.Community.Display.V1.FormattedValue']).toBe('Amy');
    expect(out.msdyn_name).toBe('Amy : Design');
  });

  it('surfaces the pmo_user systemuser identity as assigneeUserId/Name', () => {
    const out = normalizeCustomAssignment({
      pmo_taskassignmentid: 'asg-2',
      pmo_name: 'Mark : Build',
      _pmo_task_value: 'task-h',
      _pmo_user_value: 'user-mark',
      '_pmo_user_value@OData.Community.Display.V1.FormattedValue': 'Zipadelli, Mark',
    });
    expect(out.assigneeUserId).toBe('user-mark');
    expect(out.assigneeUserName).toBe('Zipadelli, Mark');
    // BR-less assignee: no projectteam lookup, still valid
    expect(out['_msdyn_projectteamid_value']).toBeNull();
  });

  it('surfaces pmo_contributedhours as contributedHours (New Resource Model)', () => {
    const out = normalizeCustomAssignment({
      pmo_taskassignmentid: 'asg-3',
      pmo_contributedhours: 6,
    });
    expect(out.contributedHours).toBe(6);
  });

  it('preserves an explicit zero rather than coercing it to undefined', () => {
    const out = normalizeCustomAssignment({
      pmo_taskassignmentid: 'asg-3b',
      pmo_contributedhours: 0,
    });
    expect(out.contributedHours).toBe(0);
  });

  it('leaves contributedHours undefined when the column is unset or null', () => {
    expect(normalizeCustomAssignment({ pmo_taskassignmentid: 'asg-4' }).contributedHours)
      .toBeUndefined();
    expect(normalizeCustomAssignment({ pmo_taskassignmentid: 'asg-5', pmo_contributedhours: null }).contributedHours)
      .toBeUndefined();
  });

  it('defaults statecode to 0 and nulls missing lookups', () => {
    const out = normalizeCustomAssignment({ pmo_taskassignmentid: 'x' });
    expect(out.statecode).toBe(0);
    expect(out['_msdyn_taskid_value']).toBeNull();
    expect(out['_msdyn_projectteamid_value']).toBeNull();
    expect(out['_msdyn_projectid_value']).toBeNull();
    expect(out.assigneeUserId).toBeNull();
  });
});

describe('buildCustomAssignmentCreatePayload', () => {
  it('binds task/user/project via PascalCase @odata.bind nav props', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Amy : Design');
    expect(p['pmo_Task@odata.bind']).toBe('/pmo_tasks(task-2)');
    expect(p['pmo_User@odata.bind']).toBe('/systemusers(user-3)');
    expect(p['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(proj-1)');
    expect(p.pmo_name).toBe('Amy : Design');
  });

  it('omits pmo_ProjectTeam when no team-member row exists (BR-less assignee)', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Mark : Build');
    expect(p['pmo_ProjectTeam@odata.bind']).toBeUndefined();
  });

  it('binds pmo_ProjectTeam when a team-member row is provided (P4W ETL path)', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Amy : Design', 'ptm-9');
    expect(p['pmo_ProjectTeam@odata.bind']).toBe('/msdyn_projectteams(ptm-9)');
  });

  it('omits pmo_contributedhours when no initial hours are supplied', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Amy : Design');
    expect('pmo_contributedhours' in p).toBe(false);
  });

  it('sets pmo_contributedhours when initial hours are supplied', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Amy : Design', null, 8);
    expect(p.pmo_contributedhours).toBe(8);
  });

  it('sets an explicit zero when initial hours are 0', () => {
    const p = buildCustomAssignmentCreatePayload('proj-1', 'task-2', 'user-3', 'Amy : Design', null, 0);
    expect(p.pmo_contributedhours).toBe(0);
  });
});
