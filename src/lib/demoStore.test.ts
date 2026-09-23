import { describe, it, expect, beforeEach } from 'vitest';
import {
  queryRecords, getRecord, addRecord, updateRecord, removeRecord,
  generateId, getPrimaryKey, resetDemoStore,
  handlePssCreate, handlePssDelete, maybeCreateDemoProject,
} from './demoStore';

type Rec = Record<string, unknown>;

beforeEach(() => resetDemoStore());

describe('getPrimaryKey', () => {
  it('known sets', () => {
    expect(getPrimaryKey('msdyn_projects')).toBe('msdyn_projectid');
    expect(getPrimaryKey('pmo_projectcollaborators')).toBe('pmo_projectcollaboratorid');
    expect(getPrimaryKey('pmo_projects')).toBe('pmo_projectid');
  });
  it('fallback strips trailing s + id', () => {
    expect(getPrimaryKey('widgets')).toBe('widgetid');
  });
});

describe('generateId', () => {
  it('produces a v4-shaped GUID', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('is unique across calls', () => {
    const a = generateId(); const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe('queryRecords — reads honor OData params', () => {
  it('seeds from fixtures', () => {
    const reqs = queryRecords('pmo_projectrequests');
    expect(reqs.length).toBeGreaterThan(0);
  });
  it('$filter scopes rows', () => {
    const all = queryRecords<Rec>('msdyn_projects');
    expect(all.length).toBeGreaterThan(0);
    const active = queryRecords<Rec>('msdyn_projects', { $filter: 'statecode eq 0' });
    expect(active.every((r) => r.statecode === 0)).toBe(true);
  });
  it('$top caps results', () => {
    const two = queryRecords('pmo_projectrequests', { $top: 2 });
    expect(two.length).toBeLessThanOrEqual(2);
  });
  it('$orderby sorts', () => {
    const asc = queryRecords<Rec>('msdyn_projects', { $orderby: 'createdon asc' });
    const desc = queryRecords<Rec>('msdyn_projects', { $orderby: 'createdon desc' });
    if (asc.length > 1) {
      expect(asc[0]).not.toEqual(desc[0]);
    }
  });
  it('unknown set returns empty (no throw)', () => {
    expect(queryRecords('does_not_exist')).toEqual([]);
  });
});

describe('lookup FormattedValue synthesis', () => {
  it('adds a FormattedValue for a _x_value pointing at a record', () => {
    // Use an isolated project so seeded tasks don't interfere with the count.
    const projId = generateId();
    addRecord('msdyn_projects', { msdyn_projectid: projId, msdyn_subject: 'Isolated Project', statecode: 0 });

    const taskId = generateId();
    addRecord('msdyn_projecttasks', {
      msdyn_projecttaskid: taskId,
      msdyn_subject: 'Demo task',
      _msdyn_project_value: projId,
      statecode: 0,
    });
    const tasks = queryRecords<Rec>('msdyn_projecttasks', { $filter: `_msdyn_project_value eq '${projId}'` });
    expect(tasks).toHaveLength(1);
    const fv = tasks[0]['_msdyn_project_value@OData.Community.Display.V1.FormattedValue'];
    expect(fv).toBe('Isolated Project');
  });
});

describe('writes — add / update / remove', () => {
  it('addRecord then getRecord round-trips', () => {
    const id = generateId();
    addRecord('pmo_projectcollaborators', { pmo_projectcollaboratorid: id, pmo_name: 'X', statecode: 0 });
    expect(getRecord('pmo_projectcollaborators', id)).toBeTruthy();
  });
  it('updateRecord resolves @odata.bind into _value', () => {
    const id = generateId();
    addRecord('pmo_projectteams', { pmo_projectteamid: id, statecode: 0 });
    updateRecord('pmo_projectteams', id, { 'pmo_Team@odata.bind': '/teams(team-123)' });
    const rec = getRecord<Rec>('pmo_projectteams', id)!;
    expect(rec._pmo_team_value).toBe('team-123');
  });
  it('removeRecord deletes', () => {
    const id = generateId();
    addRecord('pmo_projectteams', { pmo_projectteamid: id, statecode: 0 });
    removeRecord('pmo_projectteams', id);
    expect(getRecord('pmo_projectteams', id)).toBeUndefined();
  });
  it('id match is case-insensitive', () => {
    const id = generateId().toUpperCase();
    addRecord('pmo_projectteams', { pmo_projectteamid: id, statecode: 0 });
    expect(getRecord('pmo_projectteams', id.toLowerCase())).toBeTruthy();
  });
});

describe('PSS interceptors', () => {
  it('handlePssCreate adds a task and resolves binds', () => {
    const before = queryRecords('msdyn_projecttasks').length;
    const res = handlePssCreate({
      OperationSetId: 'op1',
      Entity: {
        '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_projecttask',
        msdyn_subject: 'PSS task',
        'msdyn_project@odata.bind': '/msdyn_projects(proj-1)',
      },
    });
    expect(res.Result).toBe('Success');
    const after = queryRecords<Rec>('msdyn_projecttasks');
    expect(after.length).toBe(before + 1);
    const created = after.find((r) => r.msdyn_subject === 'PSS task')!;
    expect(created._msdyn_project_value).toBe('proj-1');
  });
  it('handlePssDelete removes by logical name', () => {
    const id = generateId();
    addRecord('msdyn_projecttasks', { msdyn_projecttaskid: id, msdyn_subject: 'to delete', statecode: 0 });
    handlePssDelete({ OperationSetId: 'op2', EntityLogicalName: 'msdyn_projecttask', RecordId: id });
    expect(getRecord('msdyn_projecttasks', id)).toBeUndefined();
  });
});

describe('maybeCreateDemoProject — approval flow', () => {
  it('creates PSS + custom project when a request is approved', () => {
    const reqId = generateId();
    addRecord('pmo_projectrequests', {
      pmo_projectrequestid: reqId,
      pmo_name: 'Approve Me',
      pmo_description: 'desc',
      statecode: 0,
    });
    const projBefore = queryRecords('msdyn_projects').length;
    const customBefore = queryRecords('pmo_projects').length;

    maybeCreateDemoProject('pmo_projectrequests', reqId, { pmo_status: 893460023 });

    expect(queryRecords('msdyn_projects').length).toBe(projBefore + 1);
    expect(queryRecords('pmo_projects').length).toBe(customBefore + 1);
    const req = getRecord<Rec>('pmo_projectrequests', reqId)!;
    expect(req._pmo_convertedproject_value).toBeTruthy();
    expect(req.pmo_status).toBe(893460023);
  });
  it('no-op when status is not approved', () => {
    const reqId = generateId();
    addRecord('pmo_projectrequests', { pmo_projectrequestid: reqId, pmo_name: 'Nope', statecode: 0 });
    const before = queryRecords('msdyn_projects').length;
    maybeCreateDemoProject('pmo_projectrequests', reqId, { pmo_status: 1 });
    expect(queryRecords('msdyn_projects').length).toBe(before);
  });
});

describe('fixture coverage', () => {
  it('seeds systemusers, buckets, tasks, collaborators, custom projects', () => {
    expect(queryRecords('systemusers').length).toBeGreaterThan(0);
    expect(queryRecords('msdyn_projectbuckets').length).toBeGreaterThan(0);
    expect(queryRecords('msdyn_projecttasks').length).toBeGreaterThan(0);
    expect(queryRecords('pmo_projectcollaborators').length).toBeGreaterThan(0);
    expect(queryRecords('pmo_projects').length).toBeGreaterThan(0);
  });
  it('resolves team membership via any() against seeded relation', () => {
    // Team A has 2 members in the fixture; a membership-scoped user query should
    // return exactly those users.
    const teamA = queryRecords<Rec>('teams')[0];
    expect(teamA).toBeTruthy();
    const members = queryRecords<Rec>('systemusers', {
      $filter: `teammembership_association/any(t: t/teamid eq '${teamA.teamid}')`,
    });
    expect(members.length).toBeGreaterThan(0);
  });
  it('scopes tasks to a project via $filter', () => {
    const proj = queryRecords<Rec>('msdyn_projects')[0];
    const tasks = queryRecords<Rec>('msdyn_projecttasks', {
      $filter: `_msdyn_project_value eq '${proj.msdyn_projectid}'`,
    });
    expect(tasks.every((t) => (t._msdyn_project_value as string) === proj.msdyn_projectid)).toBe(true);
  });
});

describe('resetDemoStore', () => {
  it('discards mutations', () => {
    const id = generateId();
    addRecord('pmo_projectteams', { pmo_projectteamid: id, statecode: 0 });
    expect(getRecord('pmo_projectteams', id)).toBeTruthy();
    resetDemoStore();
    expect(getRecord('pmo_projectteams', id)).toBeUndefined();
  });
});
