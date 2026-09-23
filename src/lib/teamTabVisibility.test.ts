import { describe, it, expect } from 'vitest';
import {
  teamTabsKey,
  extractTeamIdFromTabsKey,
  parseTeamTabs,
  serializeTeamTabs,
  resolveAllowedNavKeys,
  isNavItemAllowed,
} from './teamTabVisibility';
import { SETTING_TEAM_TABS_PREFIX } from './constants';

const row = (k: string, v: string | null) => ({ pmo_key: k, pmo_value: v });

describe('teamTabVisibility', () => {
  it('key builder + extractor round-trip', () => {
    const k = teamTabsKey('TEAM-1');
    expect(k).toBe(`${SETTING_TEAM_TABS_PREFIX}TEAM-1`);
    expect(extractTeamIdFromTabsKey(k)).toBe('TEAM-1');
    expect(extractTeamIdFromTabsKey('pmo.other.x')).toBeNull();
  });

  it('parseTeamTabs: unset/blank/malformed => null (no restriction)', () => {
    expect(parseTeamTabs(undefined)).toBeNull();
    expect(parseTeamTabs(null)).toBeNull();
    expect(parseTeamTabs('')).toBeNull();
    expect(parseTeamTabs('   ')).toBeNull();
    expect(parseTeamTabs('{not json')).toBeNull();
    expect(parseTeamTabs('{"a":1}')).toBeNull(); // not an array
  });

  it('parseTeamTabs: valid array de-dupes + drops non-strings', () => {
    expect(parseTeamTabs('["nav.projects","nav.projects","nav.intakeQueue"]')).toEqual([
      'nav.projects',
      'nav.intakeQueue',
    ]);
    expect(parseTeamTabs('["nav.projects", 5, null]')).toEqual(['nav.projects']);
    expect(parseTeamTabs('[]')).toEqual([]); // explicit empty allowlist
  });

  it('serializeTeamTabs de-dupes', () => {
    expect(serializeTeamTabs(['nav.a', 'nav.a', 'nav.b'])).toBe('["nav.a","nav.b"]');
  });

  it('resolveAllowedNavKeys: no teams / no settings => null', () => {
    expect(resolveAllowedNavKeys(undefined, new Set(['t1']))).toBeNull();
    expect(resolveAllowedNavKeys([], new Set(['t1']))).toBeNull();
    expect(resolveAllowedNavKeys([row(teamTabsKey('t1'), '["nav.projects"]')], new Set())).toBeNull();
    expect(resolveAllowedNavKeys([row(teamTabsKey('t1'), '["nav.projects"]')], null)).toBeNull();
  });

  it('resolveAllowedNavKeys: only teams WITH an allowlist constrain', () => {
    const settings = [
      row(teamTabsKey('t1'), '["nav.projects"]'),
      row(teamTabsKey('t2'), null), // t2 has no restriction
    ];
    // viewer on t2 only -> t2 has no allowlist -> null (unrestricted)
    expect(resolveAllowedNavKeys(settings, new Set(['t2']))).toBeNull();
    // viewer on t1 -> restricted to its allowlist
    expect(resolveAllowedNavKeys(settings, new Set(['t1']))).toEqual(new Set(['nav.projects']));
  });

  it('resolveAllowedNavKeys: multi-team viewer sees the UNION', () => {
    const settings = [
      row(teamTabsKey('t1'), '["nav.projects"]'),
      row(teamTabsKey('t2'), '["nav.intakeQueue","nav.programs"]'),
    ];
    expect(resolveAllowedNavKeys(settings, new Set(['t1', 't2']))).toEqual(
      new Set(['nav.projects', 'nav.intakeQueue', 'nav.programs']),
    );
  });

  it('isNavItemAllowed: null allowed => everything visible', () => {
    expect(isNavItemAllowed(null, 'nav.projects')).toBe(true);
    expect(isNavItemAllowed(null, undefined)).toBe(true);
  });

  it('isNavItemAllowed: structural items (no toggleKey) always visible', () => {
    expect(isNavItemAllowed(new Set(['nav.projects']), undefined)).toBe(true);
  });

  it('isNavItemAllowed: gated by membership in the allowed set', () => {
    const allowed = new Set(['nav.projects']);
    expect(isNavItemAllowed(allowed, 'nav.projects')).toBe(true);
    expect(isNavItemAllowed(allowed, 'nav.programs')).toBe(false);
  });
});
