/**
 * useWriteGuard — synchronous client-side write authorization.
 *
 * The app already has an `AdminRoute` wrapper (route-level gate) and a
 * sidebar-level gate off `useAdminRole()`. Both are read-only checks --
 * they hide the surface but do NOT prevent programmatic invocation of
 * the underlying mutation. A determined user could grab the React Query
 * client from devtools, invoke `useUpsertSetting` directly, and issue an
 * admin-key write. Dataverse row-level security will reject it (that's
 * the authoritative gate), but the failure surfaces as a raw error,
 * drops noisy telemetry, and undermines the "the app enforces
 * permissions" UX story.
 *
 * useWriteGuard is a synchronous check that every write path calls at
 * the top of its mutation. It reads the caller's effective role (via
 * `useEffectiveAdminRole` so impersonation is honored) and the set of
 * teams they lead (via `useTeamsLedByCurrentUser`) and returns a
 * verdict. Callers `throw new WriteForbiddenError(...)` on a false
 * verdict; React Query surfaces the throw to the toast handler which
 * renders the 403-variant.
 *
 * This is UI-layer defense in depth. Dataverse row-level security
 * remains the authoritative gate.
 */
import { useCallback } from 'react';
import { useEffectiveAdminRole, type AdminRole } from '../providers/ConfigurationProvider';
import { useTeamsLedByCurrentUser } from './useTeamLeadership';
import { useCurrentUserTeams } from './useCurrentUserTeams';

export type RequiredRole =
  | 'pmo_admin'
  | 'system_admin'
  | 'team_lead'
  | 'team_member'
  | 'any_authenticated';

export interface WriteGuardContext {
  /** For team-scoped rules -- team-id the caller must lead. */
  teamId?: string;
}

export interface WriteGuardVerdict {
  allow: boolean;
  reason?: string;
  requiredRole: RequiredRole;
}

/**
 * Thrown by a mutation's `mutationFn` when the caller fails the guard.
 * React Query surfaces this as `mutation.error`. Consumers can
 * `instanceof`-check to switch to the 403-variant toast; the default
 * `err.message` is already the user-friendly formatted string, so
 * existing `toast.error(err.message)` handlers render a clean 403
 * message with zero code change at the callsite.
 */
export class WriteForbiddenError extends Error {
  readonly name = 'WriteForbiddenError';
  readonly requiredRole: RequiredRole;
  readonly settingKey: string | undefined;
  readonly teamId: string | undefined;
  readonly rawReason: string;

  constructor(
    rawReason: string,
    requiredRole: RequiredRole,
    opts: { settingKey?: string; teamId?: string } = {},
  ) {
    super(formatMessage(requiredRole));
    this.rawReason = rawReason;
    this.requiredRole = requiredRole;
    this.settingKey = opts.settingKey;
    this.teamId = opts.teamId;
  }
}

function formatMessage(role: RequiredRole): string {
  const label = requiredRoleLabelInternal(role);
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  return `Not allowed. This action requires ${article} ${label} role. Contact your PMO admin to make this change.`;
}

function requiredRoleLabelInternal(role: RequiredRole): string {
  switch (role) {
    case 'pmo_admin':          return 'PMO Administrator';
    case 'system_admin':       return 'System Administrator';
    case 'team_lead':          return 'Team Lead';
    case 'team_member':        return 'Team Member';
    case 'any_authenticated':  return 'any signed-in user';
  }
}

export function isWriteForbiddenError(err: unknown): err is WriteForbiddenError {
  return err instanceof WriteForbiddenError;
}

/** Human label for a role -- exported for tests and any surface that
 *  wants to phrase the role differently than the default message does. */
export function requiredRoleLabel(role: RequiredRole): string {
  return requiredRoleLabelInternal(role);
}

function roleAllows(effective: AdminRole, required: RequiredRole): boolean {
  if (required === 'any_authenticated') return true;
  if (required === 'system_admin')      return effective === 'system_admin';
  if (required === 'pmo_admin')         return effective === 'pmo_admin' || effective === 'system_admin';
  // 'team_lead' → any admin also passes; the per-team check runs on top.
  return effective !== 'none';
}

/**
 * React hook returning a synchronous guard function.
 *
 * Usage:
 *   const guard = useWriteGuard();
 *   const mutation = useMutation({
 *     mutationFn: async (payload) => {
 *       const v = guard('pmo_admin');
 *       if (!v.allow) throw new WriteForbiddenError(v.reason!, v.requiredRole);
 *       // ... Dataverse call
 *     }
 *   });
 */
export function useWriteGuard() {
  const effective = useEffectiveAdminRole();
  const leadTeams = useTeamsLedByCurrentUser();
  const memberTeams = useCurrentUserTeams();

  return useCallback(
    (required: RequiredRole, ctx: WriteGuardContext = {}): WriteGuardVerdict => {
      // Fast path: role-only gates (not the team-scoped ones).
      if (required !== 'team_lead' && required !== 'team_member') {
        const allow = roleAllows(effective, required);
        return {
          allow,
          requiredRole: required,
          reason: allow
            ? undefined
            : `Requires ${requiredRoleLabel(required)} role.`,
        };
      }
      // Admins always pass any team-scoped gate.
      if (roleAllows(effective, 'pmo_admin')) {
        return { allow: true, requiredRole: required };
      }
      if (!ctx.teamId) {
        return {
          allow: false,
          requiredRole: required,
          reason: `Requires ${requiredRoleLabel(required)} but no team id was provided.`,
        };
      }
      const key = ctx.teamId.toLowerCase();
      if (required === 'team_lead') {
        const leads = leadTeams.has(key);
        return {
          allow: leads,
          requiredRole: 'team_lead',
          reason: leads ? undefined : `Requires Team Lead role on team ${ctx.teamId}.`,
        };
      }
      // team_member: caller must be a member (leads are members implicitly
      // but the leadTeams check is fast and cheap so use it as fallback in
      // case membership hasn't loaded yet).
      const isMember = memberTeams?.has(key) === true || leadTeams.has(key);
      return {
        allow: isMember,
        requiredRole: 'team_member',
        reason: isMember ? undefined : `Requires Team Member status on team ${ctx.teamId}.`,
      };
    },
    [effective, leadTeams, memberTeams],
  );
}
