import { describe, expect, it, vi, beforeEach } from 'vitest';

const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const deactivate = vi.fn();
const get = vi.fn();
const list = vi.fn();
vi.mock('../lib/dataverseClient', () => ({
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
  deactivate: (...a: unknown[]) => deactivate(...a),
  get: (...a: unknown[]) => get(...a),
  list: (...a: unknown[]) => list(...a),
}));

import {
  normalizeCustomProgram,
  buildCustomProgramPayload,
  createCustomProgram,
} from './customPrograms.api';

beforeEach(() => {
  create.mockReset(); update.mockReset(); remove.mockReset();
  deactivate.mockReset(); get.mockReset(); list.mockReset();
});

describe('normalizeCustomProgram', () => {
  it('maps the shared GUID and fields into the Program shape', () => {
    const out = normalizeCustomProgram({
      pmo_programid: 'g1',
      pmo_name: 'Prog A',
      pmo_budget: 1000,
      pmo_state: 189330000,
      _pmo_manager_value: 'user-7',
    });
    expect(out.msdyn_projectprogramid).toBe('g1');
    expect(out.msdyn_name).toBe('Prog A');
    expect(out.msdyn_budget).toBe(1000);
    expect(out.proj_state).toBe(189330000);
    expect(out['_proj_manager_value']).toBe('user-7');
  });

  it('expands bare Edm.Date to noon-UTC', () => {
    const out = normalizeCustomProgram({ pmo_programid: 'x', pmo_programstart: '2026-08-04' });
    expect(out.proj_programstart).toBe('2026-08-04T12:00:00Z');
  });
});

describe('buildCustomProgramPayload', () => {
  it('maps scalar fields to pmo_ equivalents', () => {
    const p = buildCustomProgramPayload({ msdyn_name: 'N', msdyn_budget: 50, proj_priority: 2 });
    expect(p.pmo_name).toBe('N');
    expect(p.pmo_budget).toBe(50);
    expect(p.pmo_priority).toBe(2);
  });

  it('writes date fields as bare YYYY-MM-DD', () => {
    const p = buildCustomProgramPayload({ proj_programstart: '2026-08-04T12:00:00Z' });
    expect(p.pmo_programstart).toBe('2026-08-04');
  });

  it('retargets the manager lookup bind to the pmo_ nav prop', () => {
    const p = buildCustomProgramPayload({ 'proj_Manager@odata.bind': '/systemusers(u1)' });
    expect(p['pmo_Manager@odata.bind']).toBe('/systemusers(u1)');
  });
});

describe('createCustomProgram — same-GUID shell', () => {
  it('writes the msdyn_projectprogram shell FIRST, then pmo_program with the SAME GUID', async () => {
    const order: string[] = [];
    let shellGuid: string | undefined;
    create.mockImplementation((set: string, body: Record<string, unknown>) => {
      order.push(set);
      if (set === 'msdyn_projectprograms') shellGuid = body.msdyn_projectprogramid as string;
      if (set === 'pmo_programs') expect(body.pmo_programid).toBe(shellGuid);
      return Promise.resolve({});
    });
    get.mockResolvedValue({ pmo_programid: 'g', pmo_name: 'N' });
    await createCustomProgram({ msdyn_name: 'N' });
    expect(order).toEqual(['msdyn_projectprograms', 'pmo_programs']);
  });

  it('rolls back the shell if the pmo_program write fails', async () => {
    create.mockImplementation((set: string) =>
      set === 'pmo_programs' ? Promise.reject(new Error('boom')) : Promise.resolve({}));
    await expect(createCustomProgram({ msdyn_name: 'N' })).rejects.toThrow('boom');
    expect(remove).toHaveBeenCalledWith('msdyn_projectprograms', expect.any(String));
  });
});
