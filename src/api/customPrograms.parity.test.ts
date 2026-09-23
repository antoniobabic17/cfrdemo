import { describe, expect, it } from 'vitest';
import { normalizeCustomProgram, computeProgramRollup } from './customPrograms.api';
import { OVERALL_HEALTH } from '../lib/constants';
import type { Project } from '../models/project.model';

const FV = '@OData.Community.Display.V1.FormattedValue';

function fullRow(): Record<string, unknown> {
  return {
    pmo_programid: 'guid-1',
    pmo_programnumber: 'PROG-00007',
    pmo_name: 'Parity Program',
    pmo_description: 'desc', pmo_businesscase: 'bc',
    pmo_benefit: 500000, pmo_budget: 100000, pmo_roi: 3.5,
    pmo_programstart: '2026-08-04', pmo_programdue: '2026-12-01',
    pmo_state: 189330001, [`pmo_state${FV}`]: '(2) Active',
    pmo_priority: 189330001, [`pmo_priority${FV}`]: '(2) High',
    pmo_programtype: 189330000, [`pmo_programtype${FV}`]: 'Strategic',
    pmo_programgoals: 189330000, [`pmo_programgoals${FV}`]: 'Growth',
    pmo_businessunit: 189330001, [`pmo_businessunit${FV}`]: 'Epic',
    pmo_overallhealth: 189330001, [`pmo_overallhealth${FV}`]: '(2) At Risk',
    pmo_efforthealth: 189330000, [`pmo_efforthealth${FV}`]: '(1) On Track',
    pmo_financialhealth: 189330000, [`pmo_financialhealth${FV}`]: '(1) On Track',
    pmo_schedulehealth: 189330001, [`pmo_schedulehealth${FV}`]: '(2) At Risk',
    _pmo_manager_value: 'mgr-1', [`_pmo_manager_value${FV}`]: 'Mgr M',
    statecode: 0, statuscode: 1, createdon: '2026-08-01T00:00:00Z',
  };
}

const REQUIRED_VALUE_FIELDS = [
  'msdyn_projectprogramid', 'pmo_programid', 'msdyn_name', 'statecode',
  'msdyn_description', 'msdyn_businesscase', 'msdyn_benefit', 'msdyn_budget', 'msdyn_roi',
  'proj_programstart', 'proj_programdue',
  'proj_state', 'proj_priority', 'proj_programtype', 'proj_programgoals', 'proj_businessunit',
  'proj_overallhealth', 'proj_efforthealth', 'proj_financialhealth', 'proj_schedulehealth',
  '_proj_manager_value',
];
const REQUIRED_FV_FIELDS = [
  'proj_state', 'proj_priority', 'proj_programtype', 'proj_programgoals', 'proj_businessunit',
  'proj_overallhealth', '_proj_manager_value',
];

describe('normalizeCustomProgram — full parity', () => {
  const out = normalizeCustomProgram(fullRow() as never) as unknown as Record<string, unknown>;

  it('maps friendly PROG-##### to pmo_programid (not the GUID)', () => {
    expect(out.msdyn_projectprogramid).toBe('guid-1');
    expect(out.pmo_programid).toBe('PROG-00007');
  });
  it.each(REQUIRED_VALUE_FIELDS)('populates %s', (f) => expect(out[f]).not.toBeUndefined());
  it.each(REQUIRED_FV_FIELDS)('emits FormattedValue for %s', (f) => expect(out[`${f}${FV}`]).toBeTruthy());
  it('expands Edm.Date to noon-UTC', () => expect(out.proj_programstart).toBe('2026-08-04T12:00:00Z'));
});

describe('computeProgramRollup', () => {
  const proj = (health: number, budget = 0, actual = 0, benefits = 0): Project => ({
    msdyn_projectid: Math.random().toString(36).slice(2),
    msdyn_subject: 'p',
    proj_overallhealth: health,
    proj_budget: budget, proj_actualcost: actual, proj_benefits: benefits,
  } as Project);

  it('counts projects + classifies by health', () => {
    const r = computeProgramRollup([
      proj(OVERALL_HEALTH.OnTrack), proj(OVERALL_HEALTH.OnTrack),
      proj(OVERALL_HEALTH.AtRisk), proj(OVERALL_HEALTH.OffTrack),
    ]);
    expect(r.proj_activeprojects).toBe(4);
    expect(r.proj_projectsontrack).toBe(2);
    expect(r.proj_projectsatrisk).toBe(1);
    expect(r.proj_projectsintrouble).toBe(1);
  });

  it('sums financials + derives remaining budget when absent', () => {
    const r = computeProgramRollup([
      proj(OVERALL_HEALTH.OnTrack, 100, 30, 500),
      proj(OVERALL_HEALTH.OnTrack, 200, 50, 700),
    ]);
    expect(r.proj_projectbudget).toBe(300);
    expect(r.proj_projectactualcost).toBe(80);
    expect(r.proj_projectbenefits).toBe(1200);
    expect(r.proj_remainingbudget).toBe(220); // (100-30)+(200-50)
  });

  it('empty program -> zeroes', () => {
    const r = computeProgramRollup([]);
    expect(r.proj_activeprojects).toBe(0);
    expect(r.proj_projectbudget).toBe(0);
  });
});
