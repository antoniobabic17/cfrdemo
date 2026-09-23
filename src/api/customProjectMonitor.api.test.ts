import { describe, it, expect } from 'vitest';
import { normalizeCustomRisk, toPmoRiskPayload } from './customProjectRisks.api';
import { normalizeCustomIssue, toPmoIssuePayload } from './customProjectIssues.api';
import { normalizeCustomChange, toPmoChangePayload } from './customProjectChanges.api';

describe('normalizeCustomRisk', () => {
  it('maps pmo_* fields to the ProjectRisk shape + synthesizes picklist labels', () => {
    const out = normalizeCustomRisk({
      pmo_projectriskid: 'r1',
      pmo_subject: 'Vendor slip',
      pmo_description: 'desc',
      pmo_impact: 3,
      pmo_probability: 2,
      pmo_cost: 1000.5,
      pmo_category: 189330005,
      pmo_state: 189330001,
      statecode: 0,
      _pmo_project_value: 'proj-1',
    });
    expect(out.msdyn_projectriskid).toBe('r1');
    expect(out.msdyn_name).toBe('Vendor slip');
    expect(out.msdyn_subject).toBe('Vendor slip');
    expect(out.proj_impact).toBe(3);
    expect(out.proj_cost).toBe(1000.5);
    expect(out['proj_category@OData.Community.Display.V1.FormattedValue']).toBe('Technical');
    expect(out['proj_state@OData.Community.Display.V1.FormattedValue']).toBe('(2) Active');
    // normalized project value maps to the msdyn-shaped key the UI reads
    expect(out._msdyn_project_value).toBe('proj-1');
  });

  it('leaves picklist labels undefined when the value is unset', () => {
    const out = normalizeCustomRisk({ pmo_projectriskid: 'r2' });
    expect(out['proj_state@OData.Community.Display.V1.FormattedValue']).toBeUndefined();
    expect(out.proj_state).toBeUndefined();
  });

  it('expands the pmo_due Edm.Date to noon-UTC for display', () => {
    const out = normalizeCustomRisk({ pmo_projectriskid: 'r3', pmo_due: '2026-08-13' });
    expect(out.proj_due).toBe('2026-08-13T12:00:00Z');
  });
});

// Regression: Edm.Date columns REJECT a full ISO ('...T12:00:00Z'). The dialog
// hands us a noon-UTC ISO; the payload builders MUST down-convert to bare
// YYYY-MM-DD or Dataverse throws "Cannot convert the literal ... to Edm.Date".
describe('monitor write payloads — Edm.Date coercion', () => {
  it('risk: proj_due full ISO -> bare YYYY-MM-DD', () => {
    const body = toPmoRiskPayload({ proj_due: '2026-08-13T12:00:00Z' });
    expect(body.pmo_due).toBe('2026-08-13');
  });

  it('risk: null date passes through as null (clear)', () => {
    const body = toPmoRiskPayload({ proj_due: null });
    expect(body.pmo_due).toBeNull();
  });

  it('issue: proj_duedate full ISO -> bare YYYY-MM-DD', () => {
    const body = toPmoIssuePayload({ msdyn_name: 'I', proj_duedate: '2026-08-13T12:00:00Z' });
    expect(body.pmo_duedate).toBe('2026-08-13');
  });

  it('change: all three date columns -> bare YYYY-MM-DD', () => {
    const body = toPmoChangePayload({
      msdyn_name: 'C',
      proj_plannedstartdate: '2026-08-13T12:00:00Z',
      proj_plannedduedate: '2026-08-20T12:00:00Z',
      proj_requesteddate: '2026-08-10T12:00:00Z',
    });
    expect(body.pmo_plannedstartdate).toBe('2026-08-13');
    expect(body.pmo_plannedduedate).toBe('2026-08-20');
    expect(body.pmo_requesteddate).toBe('2026-08-10');
  });
});

describe('normalizeCustomIssue', () => {
  it('maps pmo_* fields + labels', () => {
    const out = normalizeCustomIssue({
      pmo_projectissueid: 'i1',
      pmo_subject: 'Login bug',
      pmo_issuecategory: 189330002,
      pmo_priority: 189330000,
      pmo_state: 189330002,
      statecode: 0,
      _pmo_project_value: 'proj-2',
    });
    expect(out.msdyn_projectissueid).toBe('i1');
    expect(out.msdyn_name).toBe('Login bug');
    expect(out['proj_issuecategory@OData.Community.Display.V1.FormattedValue']).toBe('Bug');
    expect(out['proj_priority@OData.Community.Display.V1.FormattedValue']).toBe('(1) Critical');
    expect(out['proj_state@OData.Community.Display.V1.FormattedValue']).toBe('(3) Closed');
    expect(out._msdyn_project_value).toBe('proj-2');
  });
});

describe('normalizeCustomChange', () => {
  it('maps pmo_* fields + labels incl. requestedby', () => {
    const out = normalizeCustomChange({
      pmo_projectchangeid: 'c1',
      pmo_subject: 'Add scope',
      pmo_changetype: 189330000,
      pmo_changeimpact: 189330001,
      pmo_changerisk: 189330003,
      pmo_priority: 189330001,
      pmo_approval: 189330002,
      pmo_state: 189330001,
      pmo_costimpact: 500,
      statecode: 0,
      _pmo_project_value: 'proj-3',
      _pmo_requestedby_value: 'user-9',
      '_pmo_requestedby_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
    });
    expect(out.msdyn_projectchangeid).toBe('c1');
    expect(out.msdyn_name).toBe('Add scope');
    expect(out['proj_changetype@OData.Community.Display.V1.FormattedValue']).toBe('Scope');
    expect(out['proj_changeimpact@OData.Community.Display.V1.FormattedValue']).toBe('(2) Medium');
    expect(out['proj_changerisk@OData.Community.Display.V1.FormattedValue']).toBe('(4) None');
    expect(out['proj_approval@OData.Community.Display.V1.FormattedValue']).toBe('(3) Approved');
    expect(out.proj_costimpact).toBe(500);
    expect(out._proj_requestedby_value).toBe('user-9');
    expect(out['_proj_requestedby_value@OData.Community.Display.V1.FormattedValue']).toBe('Jane Doe');
  });
});
