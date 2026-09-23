import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the dataverse client. dv.list drives listIdsByFk/countByFk; we return
// canned rows per (entitySet, filter) so we can assert the cascade queries the
// right custom pmo_ sets by the right FKs and deletes what it finds.
const listMock = vi.fn();
const removeMock = vi.fn();
const deactivateMock = vi.fn();
vi.mock('./dataverseClient', () => ({
  list: (...a: unknown[]) => listMock(...a),
  remove: (...a: unknown[]) => removeMock(...a),
  deactivate: (...a: unknown[]) => deactivateMock(...a),
}));

import { cascadeDeleteProject } from './cascadeDelete';

const PROJECT = 'proj-guid-1';
const TASK_A = 'ptask-a';

beforeEach(() => {
  listMock.mockReset();
  removeMock.mockReset().mockResolvedValue(undefined);
  deactivateMock.mockReset().mockResolvedValue(undefined);

  // Return rows only for the custom-source queries we care about; everything
  // else (msdyn_* children) resolves empty. `filter` tells us the FK+parent.
  listMock.mockImplementation((set: string, opts: { $select?: string[]; $filter?: string }) => {
    const sel = opts.$select?.[0];
    const filter = opts.$filter ?? '';
    // project's custom tasks
    if (set === 'pmo_tasks' && filter.includes('_pmo_project_value')) {
      return Promise.resolve([{ [sel!]: TASK_A }]);
    }
    // project's custom buckets
    if (set === 'pmo_buckets' && filter.includes('_pmo_project_value')) {
      return Promise.resolve([{ [sel!]: 'pbucket-1' }]);
    }
    // task-scoped children, keyed off TASK_A
    if (set === 'pmo_taskdependencies' && filter.includes(`_pmo_predecessortask_value eq ${TASK_A}`)) {
      return Promise.resolve([{ [sel!]: 'pdep-1' }]);
    }
    if (set === 'pmo_taskassignments' && filter.includes(`_pmo_task_value eq ${TASK_A}`)) {
      return Promise.resolve([{ [sel!]: 'passign-1' }]);
    }
    if (set === 'pmo_checklists' && filter.includes(`_pmo_task_value eq ${TASK_A}`)) {
      return Promise.resolve([{ [sel!]: 'pchk-1' }]);
    }
    if (set === 'pmo_tasktolabels' && filter.includes(`_pmo_task_value eq ${TASK_A}`)) {
      return Promise.resolve([{ [sel!]: 'plabel-1' }]);
    }
    return Promise.resolve([]); // all msdyn_* children empty
  });
});

describe('cascadeDeleteProject — custom-source children', () => {
  it('deletes every custom pmo_ child (deps/assignments/checklists/labels/tasks/buckets)', async () => {
    await cascadeDeleteProject(PROJECT);
    const removed = removeMock.mock.calls.map(([set, id]) => `${set}:${id}`);
    expect(removed).toContain('pmo_taskdependencies:pdep-1');
    expect(removed).toContain('pmo_taskassignments:passign-1');
    expect(removed).toContain('pmo_checklists:pchk-1');
    expect(removed).toContain('pmo_tasktolabels:plabel-1');
    expect(removed).toContain('pmo_tasks:ptask-a');
    expect(removed).toContain('pmo_buckets:pbucket-1');
  });

  it('deletes task-scoped children BEFORE the tasks themselves', async () => {
    await cascadeDeleteProject(PROJECT);
    const order = removeMock.mock.calls.map(([set]) => set as string);
    const depIdx = order.indexOf('pmo_taskdependencies');
    const taskIdx = order.indexOf('pmo_tasks');
    expect(depIdx).toBeGreaterThanOrEqual(0);
    expect(taskIdx).toBeGreaterThan(depIdx);
  });

  it('soft-deletes pmo_project then hard-deletes the msdyn_project shell last', async () => {
    await cascadeDeleteProject(PROJECT);
    expect(deactivateMock).toHaveBeenCalledWith('pmo_projects', PROJECT);
    // shell removal is the final remove call
    const lastRemove = removeMock.mock.calls.at(-1);
    expect(lastRemove?.[0]).toBe('msdyn_projects');
    expect(lastRemove?.[1]).toBe(PROJECT);
  });

  it('resolves task-scoped children via the project\'s task ids (not the project id)', async () => {
    await cascadeDeleteProject(PROJECT);
    // a dependency query must filter by the predecessor TASK, not the project
    const depQuery = listMock.mock.calls.find(
      ([set]) => set === 'pmo_taskdependencies',
    );
    expect(depQuery?.[1]?.$filter).toContain(`_pmo_predecessortask_value eq ${TASK_A}`);
  });

  it('does NOT throw when the msdyn_project shell is absent (custom-mode 0x80040217)', async () => {
    // Custom-mode projects have no msdyn_project shell, so the final shell
    // remove 404s. The cascade must swallow it (pmo_projects deactivate is the
    // authoritative delete) -- a throw here is what surfaced Tina Hoag's
    // "Save failed ... Entity 'msdyn_project' ... Does Not Exist" toast.
    removeMock.mockImplementation((set: string) =>
      set === 'msdyn_projects'
        ? Promise.reject(new Error("Entity 'msdyn_project' ... Does Not Exist"))
        : Promise.resolve(undefined),
    );
    await expect(cascadeDeleteProject(PROJECT)).resolves.toBeUndefined();
    expect(deactivateMock).toHaveBeenCalledWith('pmo_projects', PROJECT);
  });
});
