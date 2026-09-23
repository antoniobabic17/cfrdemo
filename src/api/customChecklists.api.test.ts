import { describe, expect, it } from 'vitest';
import { normalizeCustomChecklist, buildCustomChecklistCreatePayload } from './customChecklists.api';

describe('normalizeCustomChecklist', () => {
  it('maps pmo_ fields to the ProjectChecklist shape', () => {
    const out = normalizeCustomChecklist({
      pmo_checklistid: 'ck-1',
      pmo_name: 'Do the thing',
      pmo_completed: true,
      pmo_order: 3,
      _pmo_task_value: 'task-g',
      statecode: 0,
    });
    expect(out.msdyn_projectchecklistid).toBe('ck-1');
    expect(out.msdyn_name).toBe('Do the thing');
    expect(out.msdyn_projectchecklistcompleted).toBe(true);
    expect(out.msdyn_projectchecklistorder).toBe(3);
    expect(out['_msdyn_projecttaskid_value']).toBe('task-g');
  });

  it('defaults completed=false, order=0, statecode=0 when missing', () => {
    const out = normalizeCustomChecklist({ pmo_checklistid: 'x' });
    expect(out.msdyn_projectchecklistcompleted).toBe(false);
    expect(out.msdyn_projectchecklistorder).toBe(0);
    expect(out.statecode).toBe(0);
    expect(out['_msdyn_projecttaskid_value']).toBeNull();
  });

  it('maps pmo_duedate to dueDate (null when absent)', () => {
    expect(normalizeCustomChecklist({ pmo_checklistid: 'x', pmo_duedate: '2026-09-30' }).dueDate).toBe('2026-09-30');
    expect(normalizeCustomChecklist({ pmo_checklistid: 'y' }).dueDate).toBeNull();
  });
});

describe('buildCustomChecklistCreatePayload', () => {
  it('binds task via PascalCase nav prop + sets name/completed/order', () => {
    const p = buildCustomChecklistCreatePayload('task-2', 'Item A', 5, true);
    expect(p['pmo_Task@odata.bind']).toBe('/pmo_tasks(task-2)');
    expect(p.pmo_name).toBe('Item A');
    expect(p.pmo_completed).toBe(true);
    expect(p.pmo_order).toBe(5);
  });

  it('defaults completed=false and omits order when not provided', () => {
    const p = buildCustomChecklistCreatePayload('t', 'Item B');
    expect(p.pmo_completed).toBe(false);
    expect('pmo_order' in p).toBe(false);
    expect('pmo_duedate' in p).toBe(false);
  });

  it('writes pmo_duedate when provided (and null clears it)', () => {
    expect(buildCustomChecklistCreatePayload('t', 'A', 1, false, '2026-10-01').pmo_duedate).toBe('2026-10-01');
    expect(buildCustomChecklistCreatePayload('t', 'A', 1, false, null).pmo_duedate).toBeNull();
  });
});
