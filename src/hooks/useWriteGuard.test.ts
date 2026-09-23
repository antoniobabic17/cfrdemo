/**
 * Tests for useWriteGuard.
 *
 * Mocks the two upstream hooks it depends on so we can drive every
 * (effectiveRole, requiredRole, teamId) combination without wiring
 * ConfigurationProvider or Dataverse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AdminRole } from '../providers/ConfigurationProvider';

// ── Mocks (hoisted by vitest) ─────────────────────────────────────────────

let mockEffectiveRole: AdminRole = 'none';
let mockLeadTeams = new Set<string>();
let mockMemberTeams: Set<string> | undefined = new Set<string>();

vi.mock('../providers/ConfigurationProvider', async () => {
  const actual = await vi.importActual<typeof import('../providers/ConfigurationProvider')>('../providers/ConfigurationProvider');
  return {
    ...actual,
    useEffectiveAdminRole: () => mockEffectiveRole,
  };
});
vi.mock('./useTeamLeadership', () => ({
  useTeamsLedByCurrentUser: () => mockLeadTeams,
}));
vi.mock('./useCurrentUserTeams', () => ({
  useCurrentUserTeams: () => mockMemberTeams,
}));

// Import AFTER vi.mock (hoisted).
import { useWriteGuard, WriteForbiddenError, isWriteForbiddenError, requiredRoleLabel } from './useWriteGuard';

beforeEach(() => {
  mockEffectiveRole = 'none';
  mockLeadTeams = new Set<string>();
  mockMemberTeams = new Set<string>();
});

describe('useWriteGuard', () => {
  it('allows any_authenticated for every role including none', () => {
    for (const role of ['none', 'pmo_admin', 'system_admin'] as AdminRole[]) {
      mockEffectiveRole = role;
      const { result } = renderHook(() => useWriteGuard());
      expect(result.current('any_authenticated').allow).toBe(true);
    }
  });

  it('blocks pmo_admin requirement for none role', () => {
    mockEffectiveRole = 'none';
    const { result } = renderHook(() => useWriteGuard());
    const v = result.current('pmo_admin');
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/PMO Administrator/);
  });

  it('allows pmo_admin requirement for pmo_admin', () => {
    mockEffectiveRole = 'pmo_admin';
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('pmo_admin').allow).toBe(true);
  });

  it('allows pmo_admin requirement for system_admin (super-role)', () => {
    mockEffectiveRole = 'system_admin';
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('pmo_admin').allow).toBe(true);
  });

  it('blocks system_admin requirement for pmo_admin (not enough)', () => {
    mockEffectiveRole = 'pmo_admin';
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('system_admin').allow).toBe(false);
  });

  it('allows system_admin requirement for system_admin', () => {
    mockEffectiveRole = 'system_admin';
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('system_admin').allow).toBe(true);
  });

  it('team_lead: admins always pass', () => {
    mockEffectiveRole = 'pmo_admin';
    mockLeadTeams = new Set();
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('team_lead', { teamId: 'anything' }).allow).toBe(true);
  });

  it('team_lead: non-admin who leads the specified team passes', () => {
    mockEffectiveRole = 'none';
    mockLeadTeams = new Set(['team-a', 'team-b']);
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('team_lead', { teamId: 'team-a' }).allow).toBe(true);
  });

  it('team_lead: non-admin who leads a DIFFERENT team fails', () => {
    mockEffectiveRole = 'none';
    mockLeadTeams = new Set(['team-b']);
    const { result } = renderHook(() => useWriteGuard());
    const v = result.current('team_lead', { teamId: 'team-a' });
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/Team Lead role on team team-a/);
  });

  it('team_lead: non-admin with no lead-teams-of-mine fails', () => {
    mockEffectiveRole = 'none';
    mockLeadTeams = new Set();
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('team_lead', { teamId: 'team-a' }).allow).toBe(false);
  });

  it('team_lead: non-admin passing without teamId ctx fails', () => {
    mockEffectiveRole = 'none';
    mockLeadTeams = new Set(['team-a']);
    const { result } = renderHook(() => useWriteGuard());
    const v = result.current('team_lead');
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/no team id/);
  });

  it('team_lead: lowercase-matches teamId against the lead set', () => {
    mockEffectiveRole = 'none';
    mockLeadTeams = new Set(['abc-123']);
    const { result } = renderHook(() => useWriteGuard());
    expect(result.current('team_lead', { teamId: 'ABC-123' }).allow).toBe(true);
  });
});

describe('WriteForbiddenError', () => {
  it('is instanceof-checkable via isWriteForbiddenError', () => {
    const err = new WriteForbiddenError('raw reason', 'pmo_admin', { settingKey: 'pmo.foo' });
    expect(isWriteForbiddenError(err)).toBe(true);
    expect(isWriteForbiddenError(new Error('other'))).toBe(false);
  });

  it('formats err.message as a user-friendly 403 string; keeps raw reason on rawReason', () => {
    const err = new WriteForbiddenError('requires pmo_admin (internal)', 'pmo_admin');
    expect(err.message).toMatch(/Not allowed\..*PMO Administrator/);
    expect(err.rawReason).toBe('requires pmo_admin (internal)');
  });

  it('uses "an" article before vowel-starting role labels', () => {
    const err = new WriteForbiddenError('r', 'any_authenticated');
    expect(err.message).toMatch(/requires an any signed-in user/);
  });

  it('carries requiredRole + settingKey + teamId', () => {
    const err = new WriteForbiddenError('raw', 'team_lead', { settingKey: 'pmo.team_announcement.abc', teamId: 'abc' });
    expect(err.requiredRole).toBe('team_lead');
    expect(err.settingKey).toBe('pmo.team_announcement.abc');
    expect(err.teamId).toBe('abc');
    expect(err.name).toBe('WriteForbiddenError');
  });
});

describe('requiredRoleLabel', () => {
  it('returns human-readable labels', () => {
    expect(requiredRoleLabel('pmo_admin')).toBe('PMO Administrator');
    expect(requiredRoleLabel('system_admin')).toBe('System Administrator');
    expect(requiredRoleLabel('team_lead')).toBe('Team Lead');
    expect(requiredRoleLabel('any_authenticated')).toBe('any signed-in user');
  });
});
