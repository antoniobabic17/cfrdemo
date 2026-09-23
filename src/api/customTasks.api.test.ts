import { describe, expect, it } from 'vitest';
import { normalizeCustomTask, annotateSummaryFlags, buildCustomTaskCreatePayload, buildCustomTaskUpdatePayload, buildSprintUpdatePayload } from './customTasks.api';
import type { ProjectTask } from '../models/projectTask.model';

describe('normalizeCustomTask', () => {
  it('maps pmo_taskid (GUID) to msdyn_projecttaskid and pmo_tasknumber to the friendly display id', () => {
    const out = normalizeCustomTask({
      pmo_taskid: 'abc-123',
      pmo_tasknumber: 'TASK-10140',
      pmo_subject: 'Test Task',
    });
    expect(out.msdyn_projecttaskid).toBe('abc-123');       // GUID stays the PK
    expect(out.pmo_taskid).toBe('TASK-10140');             // friendly id the tile renders
    expect(out.msdyn_subject).toBe('Test Task');
  });

  it('leaves pmo_taskid (display) undefined when the autonumber has not populated', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'guid-only' });
    expect(out.msdyn_projecttaskid).toBe('guid-only');
    expect(out.pmo_taskid).toBeUndefined();
  });

  it('maps pmo_duration to msdyn_duration', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x', pmo_duration: 40 });
    expect(out.msdyn_duration).toBe(40);
  });

  it('expands bare Edm.Date start/due to noon-UTC so renderers show the picked day (8/4->8/3 guard)', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x', pmo_startdate: '2026-08-04', pmo_duedate: '2026-08-11' });
    // Bare "2026-08-04" would render as 8/3 west of UTC; noon-UTC renders 8/4.
    expect(out.msdyn_scheduledstart).toBe('2026-08-04T12:00:00Z');
    expect(out.msdyn_scheduledend).toBe('2026-08-11T12:00:00Z');
    expect(out.msdyn_finish).toBe('2026-08-11T12:00:00Z');
  });

  it('maps pmo_priorityvalue (raw Planner int) to msdyn_priority, ignoring the legacy picklist', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x', pmo_priorityvalue: 9, pmo_priority: 0 });
    expect(out.msdyn_priority).toBe(9); // Low on the Planner scale, 1:1 with PROD
  });

  it('bridges pmo_effort into BOTH msdyn_effort and pmo_taskeffort', () => {
    const out = normalizeCustomTask({
      pmo_taskid: 'x',
      pmo_effort: 8,
      pmo_effortcompleted: 3,
    });
    expect(out.msdyn_effort).toBe(8);
    expect(out.pmo_taskeffort).toBe(8);
    expect(out.msdyn_effortcompleted).toBe(3);
    expect(out.pmo_taskhoursdone).toBe(3);
    expect(out.msdyn_effortremaining).toBe(5);
  });

  it('maps pmo_startdate/pmo_duedate to msdyn_scheduledstart/end + msdyn_finish', () => {
    const out = normalizeCustomTask({
      pmo_taskid: 'x',
      pmo_startdate: '2026-08-01',
      pmo_duedate:   '2026-08-15',
    });
    // Bare Edm.Date is expanded to noon-UTC on read so renderers show the
    // correct local day (see the 8/4->8/3 guard test above).
    expect(out.msdyn_scheduledstart).toBe('2026-08-01T12:00:00Z');
    expect(out.msdyn_scheduledend).toBe('2026-08-15T12:00:00Z');
    expect(out.msdyn_finish).toBe('2026-08-15T12:00:00Z');
  });

  it('re-labels _pmo_projectref_value/_pmo_bucket_value to msdyn_* nav shapes', () => {
    const out = normalizeCustomTask({
      pmo_taskid: 'x',
      _pmo_projectref_value: 'proj-guid',
      _pmo_bucket_value:  'buck-guid',
    });
    expect(out._msdyn_project_value).toBe('proj-guid');
    expect(out._msdyn_projectbucket_value).toBe('buck-guid');
  });

  it('defaults statecode to 0 when missing', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x' });
    expect(out.statecode).toBe(0);
  });

  it('falls back msdyn_subject to empty string when pmo_subject null', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x', pmo_subject: null });
    expect(out.msdyn_subject).toBe('');
  });

  it('leaves msdyn_effortremaining undefined when either effort field is missing', () => {
    const out = normalizeCustomTask({ pmo_taskid: 'x', pmo_effort: 8 });
    expect(out.msdyn_effortremaining).toBeUndefined();
  });
});

describe('annotateSummaryFlags', () => {
  const mkTask = (id: string, parent?: string): ProjectTask => ({
    msdyn_projecttaskid: id,
    msdyn_subject: id,
    _msdyn_parenttask_value: parent,
  });

  it('marks a task as summary iff another task points at it as parent', () => {
    const rows = [
      mkTask('root'),
      mkTask('child-a', 'root'),
      mkTask('child-b', 'root'),
      mkTask('grand', 'child-a'),
      mkTask('leaf'),
    ];
    const out = annotateSummaryFlags(rows);
    const summaryMap = Object.fromEntries(out.map((r) => [r.msdyn_projecttaskid, r.msdyn_summary]));
    expect(summaryMap.root).toBe(true);       // has child-a + child-b
    expect(summaryMap['child-a']).toBe(true); // has grand
    expect(summaryMap['child-b']).toBe(false);
    expect(summaryMap.grand).toBe(false);
    expect(summaryMap.leaf).toBe(false);
  });

  it('does NOT overwrite an already-set msdyn_summary', () => {
    const rows: ProjectTask[] = [
      { msdyn_projecttaskid: 'x', msdyn_subject: 'x', msdyn_summary: true },
    ];
    const out = annotateSummaryFlags(rows);
    expect(out[0].msdyn_summary).toBe(true); // preserved
  });

  it('returns empty array when input is empty', () => {
    expect(annotateSummaryFlags([])).toEqual([]);
  });
});

describe('buildCustomTaskCreatePayload', () => {
  it('maps subject + binds project lookup, defaults outline level 1', () => {
    const p = buildCustomTaskCreatePayload({ projectId: 'proj-1', subject: 'Design' });
    expect(p.pmo_subject).toBe('Design');
    expect(p['pmo_ProjectRef@odata.bind']).toBe('/pmo_projects(proj-1)');
    expect(p.pmo_outlinelevel).toBe(1);
  });

  it('binds bucket + parent lookups when provided', () => {
    const p = buildCustomTaskCreatePayload({ projectId: 'p', subject: 's', bucketId: 'bkt-9', parentTaskId: 'tsk-2' });
    expect(p['pmo_Bucket@odata.bind']).toBe('/pmo_buckets(bkt-9)');
    expect(p['pmo_SummaryTask@odata.bind']).toBe('/pmo_tasks(tsk-2)');
  });

  it('maps dates/milestone/priority/description and omits absent fields', () => {
    const p = buildCustomTaskCreatePayload({ projectId: 'p', subject: 's', scheduledStart: '2026-07-01', scheduledEnd: '2026-07-05', isMilestone: true, priority: 3, description: 'notes' });
    // pmo_startdate/pmo_duedate are Edm.Date — must be a BARE YYYY-MM-DD
    // (a T..Z suffix throws "Cannot convert ... to Edm.Date"). The display
    // shift is handled on the read side (see normalizeCustomTask test).
    expect(p.pmo_startdate).toBe('2026-07-01');
    expect(p.pmo_duedate).toBe('2026-07-05');
    expect(p.pmo_ismilestone).toBe(true);
    expect(p.pmo_priorityvalue).toBe(3); // raw Planner int (Important), 1:1 with msdyn_priority
    expect(p.pmo_description).toBe('notes');
    expect('pmo_Bucket@odata.bind' in p).toBe(false);
    // 2026-07-01 (Wed) .. 2026-07-05 (Sun): Wed/Thu/Fri = 3 weekdays = 3 days (PSS unit)
    expect(p.pmo_duration).toBe(3);
    // Effort seeded like PSS: duration(days) x 8h = 24h
    expect(p.pmo_effort).toBe(24);
  });

  it('omits duration when only one endpoint is provided', () => {
    const p = buildCustomTaskCreatePayload({ projectId: 'p', subject: 's', scheduledStart: '2026-07-01' });
    expect('pmo_duration' in p).toBe(false);
  });
});

describe('buildCustomTaskUpdatePayload', () => {
  it('writes only defined fields (partial PATCH)', () => {
    const p = buildCustomTaskUpdatePayload({ subject: 'New' });
    expect(p).toEqual({ pmo_subject: 'New' });
  });

  it('maps effort/effortCompleted/progress and dates', () => {
    const p = buildCustomTaskUpdatePayload({ effort: 20, effortCompleted: 10, progress: 0.5, scheduledEnd: '2026-07-09' });
    expect(p).toEqual({ pmo_effort: 20, pmo_effortcompleted: 10, pmo_progress: 0.5, pmo_duedate: '2026-07-09' });
  });

  it('converts a percent progress (completion path sends 100) to the 0-1 fraction, NOT 0.005 (regression)', () => {
    // The completion checkbox sends progress:100 (percent). pmo_progress is a
    // 0..1 Decimal, so this must land as 1 — never 100 (400 from Dataverse) and
    // never 0.005 (the old raw>1 ? /100 : raw bug applied to an already-fraction).
    const p = buildCustomTaskUpdatePayload({ progress: 100 });
    expect(p).toEqual({ pmo_progress: 1 });
  });

  it('clamps an out-of-range percent (>100) to 1', () => {
    const p = buildCustomTaskUpdatePayload({ progress: 150 });
    expect(p).toEqual({ pmo_progress: 1 });
  });

  it('passes a mid-range percent (reopen path sends e.g. 60) through as 0.6', () => {
    const p = buildCustomTaskUpdatePayload({ progress: 60 });
    expect(p).toEqual({ pmo_progress: 0.6 });
  });

  it('keeps progress:0 as 0 (not treated as a percent)', () => {
    const p = buildCustomTaskUpdatePayload({ progress: 0 });
    expect(p).toEqual({ pmo_progress: 0 });
  });

  it('binds bucket lookup on move', () => {
    const p = buildCustomTaskUpdatePayload({ bucketId: 'bkt-3' });
    expect(p!['pmo_Bucket@odata.bind']).toBe('/pmo_buckets(bkt-3)');
  });

  it('recomputes duration when both endpoints move (PSS-identical)', () => {
    const p = buildCustomTaskUpdatePayload({ scheduledStart: '2026-07-06', scheduledEnd: '2026-07-10' });
    expect(p!.pmo_duration).toBe(5); // Mon..Fri = 5 weekdays = 5 days
  });

  it('returns undefined for an empty update so callers can skip the PATCH', () => {
    expect(buildCustomTaskUpdatePayload({})).toBeUndefined();
  });
});

describe('buildSprintUpdatePayload', () => {
  it('binds the sprint lookup via the PascalCase nav prop when a sprint is chosen', () => {
    expect(buildSprintUpdatePayload('spr-1')).toEqual({
      'pmo_Sprint@odata.bind': '/msdyn_projectsprints(spr-1)',
    });
  });

  it('sends a null bind to disassociate the sprint', () => {
    expect(buildSprintUpdatePayload(null)).toEqual({ 'pmo_Sprint@odata.bind': null });
  });
});
