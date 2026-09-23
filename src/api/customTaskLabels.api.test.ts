import { describe, expect, it } from 'vitest';
import { normalizeCustomTaskLabel, buildCustomTaskLabelCreatePayload } from './customTaskLabels.api';

describe('normalizeCustomTaskLabel', () => {
  it('maps pmo_ association fields to the ProjectTaskToLabel shape', () => {
    const out = normalizeCustomTaskLabel({
      pmo_tasktolabelid: 'ttl-1',
      _pmo_task_value: 'task-g',
      _pmo_projectlabel_value: 'label-g',
      statecode: 0,
    });
    expect(out.msdyn_projecttasktolabelid).toBe('ttl-1');
    expect(out['_msdyn_projecttaskid_value']).toBe('task-g');
    expect(out['_msdyn_projectlabelid_value']).toBe('label-g');
    expect(out.statecode).toBe(0);
  });

  it('coerces missing lookups to empty string (model requires non-null)', () => {
    const out = normalizeCustomTaskLabel({ pmo_tasktolabelid: 'x' });
    expect(out['_msdyn_projecttaskid_value']).toBe('');
    expect(out['_msdyn_projectlabelid_value']).toBe('');
  });
});

describe('buildCustomTaskLabelCreatePayload', () => {
  it('binds task->pmo_task and label->msdyn_projectlabel via PascalCase nav props', () => {
    const p = buildCustomTaskLabelCreatePayload('task-2', 'label-3');
    expect(p['pmo_Task@odata.bind']).toBe('/pmo_tasks(task-2)');
    expect(p['pmo_ProjectLabel@odata.bind']).toBe('/msdyn_projectlabels(label-3)');
  });
});
