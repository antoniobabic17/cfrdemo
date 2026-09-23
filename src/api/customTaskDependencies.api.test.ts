import { describe, expect, it } from 'vitest';
import {
  normalizeCustomTaskDependency,
  buildCustomDependencyCreatePayload,
} from './customTaskDependencies.api';

describe('normalizeCustomTaskDependency', () => {
  it('re-labels pmo_* fields to the msdyn_* shape and injects the project id', () => {
    const out = normalizeCustomTaskDependency(
      {
        pmo_taskdependencyid: 'dep-1',
        pmo_linktype: 0,
        _pmo_predecessortask_value: 'task-A',
        _pmo_successortask_value: 'task-B',
      },
      'proj-9',
    );
    expect(out).toEqual({
      msdyn_projecttaskdependencyid: 'dep-1',
      msdyn_linktype: 0,
      _msdyn_predecessortask_value: 'task-A',
      _msdyn_successortask_value: 'task-B',
      _msdyn_project_value: 'proj-9',
    });
  });

  it('coerces null lookups/linktype to undefined', () => {
    const out = normalizeCustomTaskDependency(
      { pmo_taskdependencyid: 'dep-2', pmo_linktype: null, _pmo_predecessortask_value: null, _pmo_successortask_value: null },
      'proj-1',
    );
    expect(out.msdyn_linktype).toBeUndefined();
    expect(out._msdyn_predecessortask_value).toBeUndefined();
    expect(out._msdyn_successortask_value).toBeUndefined();
  });
});

describe('buildCustomDependencyCreatePayload', () => {
  it('binds predecessor + successor via PascalCase nav props and defaults to FS', () => {
    const p = buildCustomDependencyCreatePayload({ predecessorTaskId: 'A', successorTaskId: 'B' });
    expect(p['pmo_PredecessorTask@odata.bind']).toBe('/pmo_tasks(A)');
    expect(p['pmo_SuccessorTask@odata.bind']).toBe('/pmo_tasks(B)');
    expect(p.pmo_linktype).toBe(0); // FS default
    expect(p.pmo_name).toBe('A -> B'); // primary name is ApplicationRequired
  });

  it('passes an explicit link type through', () => {
    const p = buildCustomDependencyCreatePayload({ predecessorTaskId: 'A', successorTaskId: 'B', linkType: 2 });
    expect(p.pmo_linktype).toBe(2);
  });
});
