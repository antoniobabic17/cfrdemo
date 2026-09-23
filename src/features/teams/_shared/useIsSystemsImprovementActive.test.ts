import { describe, expect, it } from 'vitest';
import { resolveSystemsImprovementActive } from './useIsSystemsImprovementActive';
import { SYSTEMS_IMPROVEMENT_TEAM_ID } from '../systems-improvement/constants';

const OTHER = '00000000-0000-0000-0000-000000000000';

describe('resolveSystemsImprovementActive', () => {
  it('acting-as wins even for a non-member admin', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: true, isAdmin: true, myTeamIds: new Set(), myTeamNamesLower: new Set(),
    })).toBe(true);
  });

  it('an admin who is not acting-as sees nothing', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: false, isAdmin: true,
      myTeamIds: new Set([SYSTEMS_IMPROVEMENT_TEAM_ID]), myTeamNamesLower: new Set(),
    })).toBe(false);
  });

  it('a non-admin SI member (by GUID) sees UAT', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: false, isAdmin: false,
      myTeamIds: new Set([SYSTEMS_IMPROVEMENT_TEAM_ID]), myTeamNamesLower: new Set(),
    })).toBe(true);
  });

  it('a non-admin SI member (by name variant) sees UAT', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: false, isAdmin: false,
      myTeamIds: new Set([OTHER]),
      myTeamNamesLower: new Set(['coram finance revcycle - systems improvement']),
    })).toBe(true);
  });

  it('a non-admin non-member sees nothing', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: false, isAdmin: false,
      myTeamIds: new Set([OTHER]), myTeamNamesLower: new Set(['some other team']),
    })).toBe(false);
  });

  it('handles null team sets safely', () => {
    expect(resolveSystemsImprovementActive({
      actingAs: false, isAdmin: false, myTeamIds: null, myTeamNamesLower: null,
    })).toBe(false);
  });
});
