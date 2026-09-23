import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the dataverse client so we can assert the shell-then-row create order
// and the rollback-on-failure behavior without touching a real environment.
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
  normalizeCustomProject,
  buildCustomProjectPayload,
  createCustomProject,
} from './customProjects.api';

beforeEach(() => {
  create.mockReset();
  update.mockReset();
  remove.mockReset();
  deactivate.mockReset();
  get.mockReset();
  list.mockReset();
});

describe('normalizeCustomProject', () => {
  it('maps the shared GUID and core fields into the Project shape', () => {
    const out = normalizeCustomProject({
      pmo_projectid: 'guid-1',
      pmo_subject: 'My Project',
      pmo_description: 'desc',
      pmo_budget: 5000,
      pmo_overallhealth: 189330001,
      _pmo_program_value: 'prog-9',
      _pmo_primaryteam_value: 'team-3',
    });
    expect(out.msdyn_projectid).toBe('guid-1');
    expect(out.msdyn_subject).toBe('My Project');
    expect(out.msdyn_description).toBe('desc');
    expect(out.proj_budget).toBe(5000);
    expect(out.proj_overallhealth).toBe(189330001);
    expect(out['_msdyn_program_value']).toBe('prog-9');
    expect(out['_pmo_primaryteam_value']).toBe('team-3');
  });

  it('expands bare Edm.Date to noon-UTC so renderers show the picked day', () => {
    const out = normalizeCustomProject({ pmo_projectid: 'x', pmo_scheduledstart: '2026-08-04' });
    expect(out.msdyn_scheduledstart).toBe('2026-08-04T12:00:00Z');
  });
});

describe('buildCustomProjectPayload', () => {
  it('maps scalar msdyn_/proj_ fields to their pmo_ equivalents', () => {
    const p = buildCustomProjectPayload({ msdyn_subject: 'S', proj_budget: 10, proj_priority: 2 });
    expect(p.pmo_subject).toBe('S');
    expect(p.pmo_budget).toBe(10);
    expect(p.pmo_priority).toBe(2);
  });

  it('writes date fields as bare YYYY-MM-DD (Edm.Date)', () => {
    const p = buildCustomProjectPayload({ msdyn_scheduledstart: '2026-08-04T12:00:00Z' });
    expect(p.pmo_scheduledstart).toBe('2026-08-04');
  });

  it('retargets lookup binds to pmo_ nav props (program keeps msdyn_projectprograms target)', () => {
    const p = buildCustomProjectPayload({
      'pmo_PrimaryTeam@odata.bind': '/teams(t1)',
      'msdyn_Program@odata.bind': '/msdyn_projectprograms(p1)',
    });
    expect(p['pmo_PrimaryTeam@odata.bind']).toBe('/teams(t1)');
    expect(p['pmo_Program@odata.bind']).toBe('/msdyn_projectprograms(p1)');
  });

  it('drops unknown keys and undefined values', () => {
    const p = buildCustomProjectPayload({ msdyn_subject: 'S', proj_activerisks: 3 } as never);
    expect(p.pmo_subject).toBe('S');
    expect(Object.keys(p)).toEqual(['pmo_subject']);
  });
});

describe('createCustomProject — same-GUID shell', () => {
  it('writes the msdyn_project shell FIRST, then pmo_project with the SAME GUID', async () => {
    const order: string[] = [];
    create.mockImplementation((set: string, body: Record<string, unknown>) => {
      order.push(set);
      if (set === 'msdyn_projects') {
        // shell must carry the chosen GUID
        expect(body.msdyn_projectid).toBeTruthy();
        (createCustomProjectTest as { shellGuid?: string }).shellGuid = body.msdyn_projectid as string;
      }
      if (set === 'pmo_projects') {
        // pmo row must reuse the SAME GUID
        expect(body.pmo_projectid).toBe((createCustomProjectTest as { shellGuid?: string }).shellGuid);
      }
      return Promise.resolve({});
    });
    get.mockResolvedValue({ pmo_projectid: 'g', pmo_subject: 'S' });

    await createCustomProject({ msdyn_subject: 'S' });
    expect(order).toEqual(['msdyn_projects', 'pmo_projects']);
  });

  it('rolls back the shell if the pmo_project write fails', async () => {
    create.mockImplementation((set: string) => {
      if (set === 'pmo_projects') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });
    await expect(createCustomProject({ msdyn_subject: 'S' })).rejects.toThrow('boom');
    // shell removed on rollback
    expect(remove).toHaveBeenCalledWith('msdyn_projects', expect.any(String));
  });
});

// tiny mutable holder so the mock can correlate the shell GUID across calls
const createCustomProjectTest: { shellGuid?: string } = {};
