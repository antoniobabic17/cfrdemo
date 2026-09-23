import { describe, it, expect } from 'vitest';
import { resolveRequiredRole } from './settingKeyRoles';

describe('resolveRequiredRole', () => {
  it('resolves team-scoped announcement to team_member + teamId', () => {
    // Loosened 2026-07-17: any team member can post the team announcement.
    const r = resolveRequiredRole('pmo.team_announcement.abc-team-guid');
    expect(r.role).toBe('team_member');
    expect(r.teamId).toBe('abc-team-guid');
    expect(r.matchedPrefix).toBe('pmo.team_announcement.');
  });

  it('resolves team-scoped toggles to team_lead + teamId', () => {
    const r = resolveRequiredRole('pmo.team_toggles.deadbeef-1234');
    expect(r.role).toBe('team_lead');
    expect(r.teamId).toBe('deadbeef-1234');
  });

  it('resolves sidebar team-name override to pmo_admin (global config)', () => {
    const r = resolveRequiredRole('sidebar.teamName.abc');
    expect(r.role).toBe('pmo_admin');
    expect(r.teamId).toBeUndefined();
  });

  it('resolves team-lead designation to pmo_admin', () => {
    const r = resolveRequiredRole('pmo.team_lead.some-team');
    expect(r.role).toBe('pmo_admin');
  });

  it('resolves environment constants to system_admin', () => {
    expect(resolveRequiredRole('pmo.tenant_id').role).toBe('system_admin');
    expect(resolveRequiredRole('pmo.pmo_team_field').role).toBe('system_admin');
    expect(resolveRequiredRole('pmo.mira_agent_url').role).toBe('system_admin');
    expect(resolveRequiredRole('pmo.mira_config_json').role).toBe('system_admin');
    // Initiative #2 environment identity overrides -- same tier as tenant_id.
    expect(resolveRequiredRole('pmo.environment_label').role).toBe('system_admin');
    expect(resolveRequiredRole('pmo.p4w_env_guids_json').role).toBe('system_admin');
    expect(resolveRequiredRole('pmo.admin_principals_json').role).toBe('system_admin');
  });

  it('resolves file/document storage keys to pmo_admin (explicit rules)', () => {
    expect(resolveRequiredRole('pmo.file_source').role).toBe('pmo_admin');
    const sp = resolveRequiredRole('pmo.sp_library_base_url');
    expect(sp.role).toBe('pmo_admin');
    expect(sp.matchedPrefix).toBe('pmo.sp_library_base_url');
  });

  it('resolves per-team tab allowlist to pmo_admin', () => {
    expect(resolveRequiredRole('pmo.team_tabs.some-team').role).toBe('pmo_admin');
  });

  it('falls through to pmo_admin for unknown keys (safe default)', () => {
    const r = resolveRequiredRole('pmo.brand_new_thing');
    expect(r.role).toBe('pmo_admin');
    expect(r.matchedPrefix).toBe('default');
  });

  it('longest-prefix wins when a key matches multiple rules', () => {
    // Contrived: if a future rule 'pmo.team_' were less specific than
    // 'pmo.team_announcement.', the announcement rule should win.
    const r = resolveRequiredRole('pmo.team_announcement.abc');
    expect(r.matchedPrefix).toBe('pmo.team_announcement.');
  });

  it('lowercases team-id from the suffix', () => {
    const r = resolveRequiredRole('pmo.team_announcement.ABC-DEF');
    expect(r.teamId).toBe('abc-def');
  });

  it('returns undefined teamId when the suffix is empty', () => {
    // Not a valid key in practice, but the resolver should not blow up.
    const r = resolveRequiredRole('pmo.team_announcement.');
    expect(r.role).toBe('team_member');
    expect(r.teamId).toBeUndefined();
  });
});
