import { describe, expect, it } from 'vitest';
import { normalizeCustomProject, computeProjectEffortRollup } from './customProjects.api';
import type { ProjectTask } from '../models/projectTask.model';

const FV = '@OData.Community.Display.V1.FormattedValue';

/**
 * A fully-populated raw pmo_project row, including the FormattedValue annotations
 * Dataverse returns for choices + lookups. The parity test asserts the normalizer
 * bridges EVERY field the ProjectListPage + detail page read.
 */
function fullRow(): Record<string, unknown> {
  return {
    pmo_projectid: 'guid-1',
    pmo_projectnumber: 'PROJ-00042',
    pmo_subject: 'Parity Project',
    pmo_description: 'desc', pmo_businesscase: 'bc', pmo_valuestatement: 'vs', pmo_comments: 'c',
    pmo_scheduledstart: '2026-08-04', pmo_finish: '2026-09-01', pmo_scheduledcompletion: '2026-08-15', pmo_actualfinishdate: '2026-09-05',
    // choices (value + FormattedValue)
    pmo_stage: 189330002, [`pmo_stage${FV}`]: '(3) Plan',
    pmo_state: 189330001, [`pmo_state${FV}`]: '(2) Active',
    pmo_priority: 189330001, [`pmo_priority${FV}`]: '(2) High',
    pmo_projecttype: 189330002, [`pmo_projecttype${FV}`]: 'Application Development',
    pmo_businessunit: 189330001, [`pmo_businessunit${FV}`]: 'Epic',
    pmo_fundingsource: 189330000, [`pmo_fundingsource${FV}`]: 'Internal',
    pmo_overallhealth: 189330001, [`pmo_overallhealth${FV}`]: '(2) At Risk',
    pmo_efforthealth: 189330000, [`pmo_efforthealth${FV}`]: '(1) On Track',
    pmo_financialhealth: 189330000, [`pmo_financialhealth${FV}`]: '(1) On Track',
    pmo_schedulehealth: 189330001, [`pmo_schedulehealth${FV}`]: '(2) At Risk',
    pmo_issuehealth: 189330000, [`pmo_issuehealth${FV}`]: '(1) On Track',
    pmo_strategicalignment: 189330001, [`pmo_strategicalignment${FV}`]: 'Strong',
    pmo_improveemployeeretention: 189330002, [`pmo_improveemployeeretention${FV}`]: 'Moderate',
    pmo_lowercost: 189330000, [`pmo_lowercost${FV}`]: 'Extreme',
    pmo_risk: 189330003, [`pmo_risk${FV}`]: 'Low',
    pmo_cfrcategory: 893460050, [`pmo_cfrcategory${FV}`]: 'IT Infrastructure',
    pmo_complexity: 893460062, [`pmo_complexity${FV}`]: 'High',
    pmo_strategicpriority: 893460070, [`pmo_strategicpriority${FV}`]: 'Must Have',
    // numerics
    pmo_budget: 100000, pmo_actualcost: 25000, pmo_forecast: 90000, pmo_benefits: 500000,
    pmo_remainingbudget: 75000, pmo_budgetvariance: 10000, pmo_roi: 4.2,
    pmo_prioritizationscore: 88, pmo_strategicalignmentscore: 9, pmo_improveemployeeretentionscore: 7,
    pmo_lowercostscore: 8, pmo_riskscore: 3,
    pmo_hoursperday: 8, pmo_hoursperweek: 40, pmo_dayspermonth: 20,
    pmo_fundingavailable: true, pmo_needsstaffing: false,
    pmo_legacyprojectid: 'PROJ-OLD-1',
    // lookups (value + FormattedValue display name)
    _pmo_projectmanager_value: 'pm-1', [`_pmo_projectmanager_value${FV}`]: 'Jane PM',
    _pmo_program_value: 'prog-1', [`_pmo_program_value${FV}`]: 'Prog X',
    _pmo_executivesponsor_value: 'es-1', [`_pmo_executivesponsor_value${FV}`]: 'Exec S',
    _pmo_manager_value: 'mgr-1', [`_pmo_manager_value${FV}`]: 'Mgr M',
    _pmo_primaryteam_value: 'team-1', [`_pmo_primaryteam_value${FV}`]: 'CFR Team',
    _pmo_requestsource_value: 'req-1', [`_pmo_requestsource_value${FV}`]: 'REQ-9',
    _pmo_payerinitiatives_hpiissue_value: 'hpi-1', [`_pmo_payerinitiatives_hpiissue_value${FV}`]: 'HPI-5',
    _pmo_payerinitiatives_strategicaccountexecutive_value: 'sae-1', [`_pmo_payerinitiatives_strategicaccountexecutive_value${FV}`]: 'SAE Sam',
    // SAE direct-AAD snapshot columns (plain text; same names on pmo_project).
    pmo_payerinitiatives_saeaadobjectid: 'aad-1',
    pmo_payerinitiatives_saedisplayname: 'Erenberg, Eileen',
    pmo_payerinitiatives_saeemail: 'Eileen.Erenberg@coramhc.com',
    statecode: 0, statuscode: 1, createdon: '2026-08-01T00:00:00Z',
  };
}

// The exact fields the ProjectListPage columns + detail page read. If a column is
// added there, add it here — the test then guards the normalizer covers it.
const REQUIRED_VALUE_FIELDS = [
  'msdyn_projectid', 'pmo_projectid', 'msdyn_subject', 'statecode',
  'proj_stage', 'proj_state', 'proj_priority', 'proj_projecttype', 'proj_businessunit',
  'proj_fundingsource', 'proj_overallhealth', 'proj_efforthealth', 'proj_financialhealth',
  'proj_schedulehealth', 'proj_issuehealth', 'proj_strategicalignment',
  'proj_improveemployeeretention', 'proj_lowercost', 'proj_risk',
  'pmo_cfrcategory', 'pmo_complexity', 'pmo_strategicpriority',
  'proj_budget', 'proj_actualcost', 'proj_forecast', 'proj_benefits',
  'proj_remainingbudget', 'proj_budgetvariance', 'proj_roi', 'proj_prioritizationscore',
  'proj_strategicalignmentscore', 'proj_improveemployeeretentionscore',
  'proj_lowercostscore', 'proj_riskscore',
  'msdyn_hoursperday', 'msdyn_hoursperweek', 'msdyn_dayspermonth',
  'msdyn_scheduledstart', 'msdyn_finish', 'proj_scheduledcompletion', 'proj_actualfinishdate', 'pmo_legacyprojectid',
  '_msdyn_projectmanager_value', '_msdyn_program_value', '_proj_executivesponsor_value',
  '_proj_manager_value', '_pmo_primaryteam_value', '_pmo_requestsource_value',
  '_pmo_payerinitiatives_hpiissue_value', '_pmo_payerinitiatives_strategicaccountexecutive_value',
  'pmo_payerinitiatives_saeaadobjectid', 'pmo_payerinitiatives_saedisplayname',
  'pmo_payerinitiatives_saeemail',
];

// Fields that MUST carry a FormattedValue annotation (choices + lookups the UI
// renders by label / display name).
const REQUIRED_FV_FIELDS = [
  'proj_stage', 'proj_state', 'proj_priority', 'pmo_cfrcategory', 'pmo_complexity',
  'pmo_strategicpriority', 'proj_strategicalignment', 'proj_risk',
  '_msdyn_projectmanager_value', '_msdyn_program_value', '_pmo_primaryteam_value',
  '_pmo_payerinitiatives_hpiissue_value',
];

describe('normalizeCustomProject — full parity', () => {
  const out = normalizeCustomProject(fullRow() as never) as unknown as Record<string, unknown>;

  it('maps the friendly PROJ-##### id to pmo_projectid (not the GUID)', () => {
    expect(out.msdyn_projectid).toBe('guid-1');
    expect(out.pmo_projectid).toBe('PROJ-00042');
  });

  it.each(REQUIRED_VALUE_FIELDS)('populates %s', (field) => {
    expect(out[field]).not.toBeUndefined();
  });

  it.each(REQUIRED_FV_FIELDS)('emits FormattedValue for %s', (field) => {
    expect(out[`${field}${FV}`]).toBeTruthy();
  });

  it('expands Edm.Date to noon-UTC (8/4 guard)', () => {
    expect(out.msdyn_scheduledstart).toBe('2026-08-04T12:00:00Z');
  });
});

describe('computeProjectEffortRollup', () => {
  const task = (effort?: number, done?: number): ProjectTask => ({
    msdyn_projecttaskid: Math.random().toString(36).slice(2),
    msdyn_subject: 't',
    pmo_taskeffort: effort,
    pmo_taskhoursdone: done,
  } as ProjectTask);

  it('sums effort + hours-done and derives progress (0-1)', () => {
    const r = computeProjectEffortRollup([task(10, 5), task(30, 15)]);
    expect(r.effort).toBe(40);
    expect(r.effortCompleted).toBe(20);
    expect(r.effortRemaining).toBe(20);
    expect(r.progress).toBeCloseTo(0.5, 5);
  });

  it('zero effort -> zero progress (no divide-by-zero)', () => {
    const r = computeProjectEffortRollup([task(0, 0), task(undefined, undefined)]);
    expect(r.effort).toBe(0);
    expect(r.progress).toBe(0);
  });

  it('caps progress at 1 when over-logged', () => {
    const r = computeProjectEffortRollup([task(10, 25)]);
    expect(r.progress).toBe(1);
    expect(r.effortRemaining).toBe(0);
  });

  const dated = (end?: string, finish?: string): ProjectTask => ({
    msdyn_projecttaskid: Math.random().toString(36).slice(2),
    msdyn_subject: 't',
    msdyn_scheduledend: end,
    msdyn_finish: finish,
  } as ProjectTask);

  it('finish = latest task due (scheduledend preferred, msdyn_finish fallback)', () => {
    const r = computeProjectEffortRollup([
      dated('2026-08-04T12:00:00Z'),
      dated('2026-09-01T12:00:00Z'),
      dated(undefined, '2026-08-15T12:00:00Z'),
    ]);
    expect(r.finish).toBe('2026-09-01T12:00:00Z');
  });

  it('finish is undefined when no task has a due date', () => {
    const r = computeProjectEffortRollup([task(10, 5)]);
    expect(r.finish).toBeUndefined();
  });
});
