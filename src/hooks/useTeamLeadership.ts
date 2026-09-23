/**
 * Team-lead resolution hooks.
 *
 * A team lead is stored as a systemuserid GUID in the appsetting
 * `pmo.team_lead.{teamId}`. Until a lead is designated the value is blank,
 * and `useCanEditTeam` falls back to admin-only.
 *
 * Admins are always above team leads — `useCanEditTeam` short-circuits to
 * true for any non-'none' effective admin role.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppSettings } from './useAppSettings';
import { useCurrentUserId } from './useCurrentUserId';
import { useEffectiveAdminRole } from '../providers/ConfigurationProvider';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import { teamLeadKey, SETTING_TEAM_LEAD_PREFIX } from '../lib/teamSettings';
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS } from '../lib/constants';

interface SystemUserLite {
  systemuserid: string;
  fullname?: string;
  lastname?: string;
  firstname?: string;
}

function fmtName(u: SystemUserLite): string {
  return u.lastname && u.firstname
    ? `${u.lastname}, ${u.firstname}`
    : u.fullname ?? u.systemuserid;
}

/**
 * Returns the lead's systemuserid + resolved display name for a team, or
 * undefined if no lead is set. Resolution name fetch only fires when an
 * id is actually present.
 */
export function useTeamLead(teamId: string | undefined): { leadId: string; leadName: string } | undefined {
  const { data: settings = [] } = useAppSettings();
  const leadId = useMemo(() => {
    if (!teamId) return '';
    const row = settings.find((s) => s.pmo_key === teamLeadKey(teamId));
    return (row?.pmo_value ?? '').trim();
  }, [settings, teamId]);

  const { data: user, isLoading: userLoading, isError: userErr } = useQuery({
    queryKey: ['systemUser', leadId],
    enabled: !!leadId,
    staleTime: 5 * 60 * 1000,
    // A disabled/deleted user surfaces as a 404 — don't keep retrying.
    retry: false,
    queryFn: () =>
      dv.get<SystemUserLite>(ENTITY_SETS.systemUser, leadId, [
        'systemuserid', 'fullname', 'lastname', 'firstname',
      ]),
  });

  if (!leadId) return undefined;
  if (userErr) return { leadId, leadName: 'Unknown user (disabled or deleted)' };
  if (userLoading || !user) return { leadId, leadName: '…' };
  return { leadId, leadName: fmtName(user) };
}

/**
 * Set of teamIds where the current user is the designated lead. Used by
 * components that want to render "you lead this team" affordances without
 * looking up each team individually.
 */
export function useTeamsLedByCurrentUser(): Set<string> {
  const { data: settings = [] } = useAppSettings();
  const userId = useCurrentUserId();
  return useMemo(() => {
    const set = new Set<string>();
    if (!userId) return set;
    const me = userId.replace(/[{}]/g, '').toLowerCase();
    for (const s of settings) {
      if (!s.pmo_key.startsWith(SETTING_TEAM_LEAD_PREFIX)) continue;
      const lead = (s.pmo_value ?? '').replace(/[{}]/g, '').toLowerCase();
      if (lead && lead === me) {
        set.add(s.pmo_key.slice(SETTING_TEAM_LEAD_PREFIX.length));
      }
    }
    return set;
  }, [settings, userId]);
}

/**
 * True when the current user can edit team-scoped settings (announcement,
 * feature toggles, lead designation):
 *   - Admins always (`useEffectiveAdminRole() !== 'none'`).
 *   - Designated lead of this team.
 * Otherwise false (read-only).
 */
export function useCanEditTeam(teamId: string | undefined): boolean {
  const adminRole = useEffectiveAdminRole();
  const leadsByMe = useTeamsLedByCurrentUser();
  if (adminRole !== 'none') return true;
  if (!teamId) return false;
  return leadsByMe.has(teamId);
}

/**
 * Narrower gate: true when the current user can edit the team's
 * announcement popup (title / body / GIF / Enabled toggle).
 *   - Admins always.
 *   - Designated lead of this team (same as useCanEditTeam).
 *   - Any member of the team (2026-07-17: operator opened this up
 *     so members can post announcements without waiting on a lead).
 * Feature toggles + lead designation stay lead/admin-only via
 * useCanEditTeam / useCanEditTeamLead.
 */
export function useCanEditTeamAnnouncement(teamId: string | undefined): boolean {
  const adminRole = useEffectiveAdminRole();
  const leadsByMe = useTeamsLedByCurrentUser();
  const userTeams = useCurrentUserTeams();
  if (adminRole !== 'none') return true;
  if (!teamId) return false;
  if (leadsByMe.has(teamId)) return true;
  return userTeams?.has(teamId) ?? false;
}

/**
 * True when the current user can designate / replace the team lead.
 * Admin-only — a lead cannot reassign their own role.
 */
export function useCanEditTeamLead(): boolean {
  const adminRole = useEffectiveAdminRole();
  return adminRole !== 'none';
}
