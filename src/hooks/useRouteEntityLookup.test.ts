import { describe, it, expect } from 'vitest';
import { friendlyRouteLabel, type RouteEntityLabel } from './useRouteEntityLookup';

function makeLabels(entries: Record<string, { name: string; entity: string }>): Map<string, RouteEntityLabel> {
  const m = new Map<string, RouteEntityLabel>();
  for (const [guid, meta] of Object.entries(entries)) {
    m.set(guid.toLowerCase(), { guid, name: meta.name, entity: meta.entity });
  }
  return m;
}

describe('friendlyRouteLabel', () => {
  it('formats a resolved project route as "Projects/<Name>"', () => {
    const labels = makeLabels({
      '7c90f984-6c75-f111-ab0f-7ced8dde8301': { name: 'Aetna Reserves', entity: 'project' },
    });
    expect(friendlyRouteLabel('#/projects/7c90f984-6c75-f111-ab0f-7ced8dde8301', labels))
      .toBe('Projects/Aetna Reserves');
  });

  it('formats a resolved HPI route as "HPI/<IssueNumber>"', () => {
    const labels = makeLabels({
      'a2ac83ec-cd7b-f111-ab0f-7c1e5200cd54': { name: 'M-506', entity: 'HPI' },
    });
    expect(friendlyRouteLabel('#/hpi/a2ac83ec-cd7b-f111-ab0f-7c1e5200cd54', labels))
      .toBe('HPI/M-506');
  });

  it('formats a resolved payer-issues route as "Payer Inquiry/<Name>"', () => {
    const labels = makeLabels({
      'b1000000-0000-0000-0000-000000000001': { name: 'BCBS prior auth drift', entity: 'Payer Inquiry' },
    });
    expect(friendlyRouteLabel('#/payer-issues/b1000000-0000-0000-0000-000000000001', labels))
      .toBe('Payer Inquiry/BCBS prior auth drift');
  });

  it('falls back to short GUID prefix when the label is not yet resolved', () => {
    const labels = new Map<string, RouteEntityLabel>();
    expect(friendlyRouteLabel('#/projects/7c90f984-6c75-f111-ab0f-7ced8dde8301', labels))
      .toBe('Projects/7c90f984');
  });

  it('formats a bare list route without an id', () => {
    expect(friendlyRouteLabel('#/hpi', new Map())).toBe('HPI');
    expect(friendlyRouteLabel('#/projects', new Map())).toBe('Projects');
  });

  it('formats deep admin routes with > separators', () => {
    expect(friendlyRouteLabel('#/admin/error-log', new Map())).toBe('Admin > Error Log');
    expect(friendlyRouteLabel('#/admin/permissions', new Map())).toBe('Admin > Permissions');
  });

  it('title-cases unknown segments', () => {
    expect(friendlyRouteLabel('#/my-cool-page', new Map())).toBe('My Cool Page');
  });

  it('returns Home for an empty hash route', () => {
    expect(friendlyRouteLabel('#/', new Map())).toBe('Home');
    expect(friendlyRouteLabel('#', new Map())).toBe('Home');
  });

  it('preserves the value when route is empty / falsy', () => {
    expect(friendlyRouteLabel('', new Map())).toBe('');
  });

  it('strips query and secondary hash suffixes', () => {
    const labels = makeLabels({
      '7c90f984-6c75-f111-ab0f-7ced8dde8301': { name: 'Aetna Reserves', entity: 'project' },
    });
    expect(friendlyRouteLabel('#/projects/7c90f984-6c75-f111-ab0f-7ced8dde8301?tab=plan', labels))
      .toBe('Projects/Aetna Reserves');
  });

  it('supports multiple entity segments in one route', () => {
    const labels = makeLabels({
      '7c90f984-6c75-f111-ab0f-7ced8dde8301': { name: 'Aetna Reserves', entity: 'project' },
      'a2ac83ec-cd7b-f111-ab0f-7c1e5200cd54': { name: 'M-506', entity: 'HPI' },
    });
    // Contrived multi-segment path exercising the walk.
    expect(friendlyRouteLabel('#/projects/7c90f984-6c75-f111-ab0f-7ced8dde8301/hpi/a2ac83ec-cd7b-f111-ab0f-7c1e5200cd54', labels))
      .toBe('Projects/Aetna Reserves > HPI/M-506');
  });
});
