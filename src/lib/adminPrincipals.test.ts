import { describe, it, expect } from 'vitest';
import {
  parseAdminPrincipals,
  serializeAdminPrincipals,
  hasAnyAdminPrincipal,
  matchesAdminPrincipal,
  EMPTY_ADMIN_PRINCIPALS,
} from './adminPrincipals';

describe('adminPrincipals', () => {
  it('parse: unset/blank/malformed => empty (grants nobody)', () => {
    expect(parseAdminPrincipals(undefined)).toEqual(EMPTY_ADMIN_PRINCIPALS);
    expect(parseAdminPrincipals(null)).toEqual(EMPTY_ADMIN_PRINCIPALS);
    expect(parseAdminPrincipals('')).toEqual(EMPTY_ADMIN_PRINCIPALS);
    expect(parseAdminPrincipals('{bad json')).toEqual(EMPTY_ADMIN_PRINCIPALS);
    expect(hasAnyAdminPrincipal(parseAdminPrincipals(undefined))).toBe(false);
  });

  it('parse: lowercases + de-dupes + drops non-strings', () => {
    const p = parseAdminPrincipals(
      JSON.stringify({ teamIds: ['ABC', 'abc', 123], userObjectIds: ['U1'], groupObjectIds: [] }),
    );
    expect(p.teamIds).toEqual(['abc']);
    expect(p.userObjectIds).toEqual(['u1']);
    expect(p.groupObjectIds).toEqual([]);
    expect(hasAnyAdminPrincipal(p)).toBe(true);
  });

  it('serialize round-trips through parse', () => {
    const p = { teamIds: ['T1'], userObjectIds: ['U1', 'U1'], groupObjectIds: ['G1'] };
    expect(parseAdminPrincipals(serializeAdminPrincipals(p))).toEqual({
      teamIds: ['t1'],
      userObjectIds: ['u1'],
      groupObjectIds: ['g1'],
    });
  });

  it('matches by user object id (case-insensitive)', () => {
    const p = parseAdminPrincipals(JSON.stringify({ userObjectIds: ['User-ABC'] }));
    expect(matchesAdminPrincipal(p, 'user-abc', [])).toBe(true);
    expect(matchesAdminPrincipal(p, 'someone-else', [])).toBe(false);
  });

  it('matches by team membership', () => {
    const p = parseAdminPrincipals(JSON.stringify({ teamIds: ['team-1'] }));
    expect(matchesAdminPrincipal(p, null, ['team-1', 'team-2'])).toBe(true);
    expect(matchesAdminPrincipal(p, null, ['team-9'])).toBe(false);
  });

  it('matches by group object id when provided', () => {
    const p = parseAdminPrincipals(JSON.stringify({ groupObjectIds: ['grp-1'] }));
    expect(matchesAdminPrincipal(p, null, [], ['grp-1'])).toBe(true);
    expect(matchesAdminPrincipal(p, null, [], ['grp-x'])).toBe(false);
    // no groups passed => no match on group axis
    expect(matchesAdminPrincipal(p, null, [])).toBe(false);
  });

  it('empty principals never match (cannot remove existing admins)', () => {
    const p = parseAdminPrincipals(undefined);
    expect(matchesAdminPrincipal(p, 'anyone', ['any-team'], ['any-group'])).toBe(false);
  });
});
