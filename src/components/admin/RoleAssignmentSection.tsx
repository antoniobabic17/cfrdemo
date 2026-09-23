import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, X, Shield } from 'lucide-react';
import { Button } from '../ui/button';
import { SearchableSelect } from '../common/SearchableSelect';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useUserSearch } from '../../hooks/useIntakeLookups';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import { toast } from '../../hooks/useToast';
import { toFriendlyError } from '../../lib/utils';

/** Role names this section manages. These are custom CFR PMO roles whose
 *  privileges go beyond what the team-based grants provide (admin and team-lead
 *  capabilities — managing app settings, deleting any record, etc.). */
const ROLE_OPTIONS = [
  { value: 'CFR PMO Administrator', label: 'CFR PMO Administrator' },
  { value: 'CFR PMO Team Lead', label: 'CFR PMO Team Lead' },
];

interface RoleRow {
  roleid: string;
  name: string;
  _businessunitid_value: string;
}

interface UserRow {
  systemuserid: string;
  fullname: string;
  internalemailaddress?: string;
  _businessunitid_value: string;
}

/** All copies of the named role across business units. Dataverse creates one
 *  per BU; assigning a role to a user requires picking the copy in the user's
 *  own BU. */
function useRoleCopies(roleName: string | undefined) {
  return useQuery<RoleRow[]>({
    queryKey: ['role-copies', roleName],
    enabled: !!roleName,
    queryFn: async () => {
      if (!roleName) return [];
      const safe = roleName.replace(/'/g, "''");
      return dv.list<RoleRow>('roles', {
        $select: ['roleid', 'name', '_businessunitid_value'],
        $filter: `name eq '${safe}'`,
      });
    },
  });
}

/** All users currently assigned any copy of the named role.
 *
 *  Queried via `systemuserroles_association/any(...)` on the systemusers
 *  entity set rather than walking the nav prop path — Dataverse SDK doesn't
 *  accept `roles(<id>)/systemuserroles_association` paths. See
 *  useCurrentUserTeams.ts:44 for the canonical pattern. */
function useUsersInRole(roleName: string | undefined) {
  return useQuery<UserRow[]>({
    queryKey: ['users-in-role', roleName],
    enabled: !!roleName,
    queryFn: async () => {
      if (!roleName) return [];
      const safe = roleName.replace(/'/g, "''");
      // Step 1: get all role copies (one per BU) by name.
      const copies = await dv.list<RoleRow>('roles', {
        $select: ['roleid'],
        $filter: `name eq '${safe}'`,
      });
      if (copies.length === 0) return [];
      // Step 2: union the filter across all role copies — a user is in this
      // role if they're assigned ANY of its BU copies.
      const orClause = copies.map((r) => `r/roleid eq ${r.roleid}`).join(' or ');
      return dv.list<UserRow>(ENTITY_SETS.systemUser, {
        $select: ['systemuserid', 'fullname', 'internalemailaddress', '_businessunitid_value'],
        $filter: `systemuserroles_association/any(r: ${orClause})`,
        $orderby: 'fullname asc',
      });
    },
  });
}

export function RoleAssignmentSection() {
  const [roleName, setRoleName] = useState<string>(ROLE_OPTIONS[0].value);

  const { data: roleCopies = [] } = useRoleCopies(roleName);
  const { data: usersInRole = [], isLoading: usersLoading, refetch: refetchUsers } = useUsersInRole(roleName);
  const qc = useQueryClient();

  const { searchUsers, resolveUserLabel } = useUserSearch();
  const [pendingUserId, setPendingUserId] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [removingUser, setRemovingUser] = useState<UserRow | null>(null);
  const [removing, setRemoving] = useState(false);

  /** Find the role copy that lives in the given user's BU. Without this, the
   *  associate call fails with "role does not exist in the business unit of
   *  the user." */
  async function findRoleForUser(userId: string): Promise<string | null> {
    // Pull the user's BU
    const users = await dv.list<{ systemuserid: string; _businessunitid_value: string }>(
      ENTITY_SETS.systemUser,
      { $select: ['systemuserid', '_businessunitid_value'], $filter: `systemuserid eq ${userId}`, $top: 1 },
    );
    const u = users[0];
    if (!u) return null;
    const match = roleCopies.find((r) => r._businessunitid_value === u._businessunitid_value);
    return match?.roleid ?? null;
  }

  async function handleAdd() {
    if (!pendingUserId || !roleName) return;
    if (usersInRole.find((u) => u.systemuserid === pendingUserId)) {
      toast.error('That user already has this role.');
      return;
    }
    setAdding(true);
    try {
      const roleId = await findRoleForUser(pendingUserId);
      if (!roleId) {
        toast.error(
          `No "${roleName}" role exists in this user's business unit. Ask your tenant admin to create the BU-scoped copy.`,
        );
        return;
      }
      await dv.associate(
        ENTITY_SETS.systemUser,
        pendingUserId,
        'systemuserroles_association',
        'roles',
        roleId,
      );
      toast.success(`Granted "${roleName}" to user.`);
      setPendingUserId('');
      await refetchUsers();
      qc.invalidateQueries({ queryKey: ['users-in-role', roleName] });
    } catch (err) {
      toast.error(toFriendlyError(err, 'Failed to grant role'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove() {
    if (!removingUser || !roleName) return;
    setRemoving(true);
    try {
      const roleId = await findRoleForUser(removingUser.systemuserid);
      if (!roleId) {
        toast.error('Could not locate the role copy for this user. Try refreshing.');
        return;
      }
      await dv.disassociate(
        ENTITY_SETS.systemUser,
        removingUser.systemuserid,
        'systemuserroles_association',
        'roles',
        roleId,
      );
      toast.success(`Removed "${roleName}" from ${removingUser.fullname}.`);
      setRemovingUser(null);
      await refetchUsers();
      qc.invalidateQueries({ queryKey: ['users-in-role', roleName] });
    } catch (err) {
      toast.error(toFriendlyError(err, 'Failed to remove role'));
    } finally {
      setRemoving(false);
    }
  }

  const helpText = useMemo(() => {
    if (roleName === 'CFR PMO Administrator') {
      return 'Grants full admin access to the CFR PMO app: settings, all records, all teams, audit visibility.';
    }
    if (roleName === 'CFR PMO Team Lead') {
      return 'Grants team-lead access: can manage team membership, edit projects on their team, and approve gates.';
    }
    return '';
  }, [roleName]);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground inline-flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Direct Role Assignment
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Grant admin or team-lead roles directly to specific users, without going through
          team membership. Useful for admins who don't sit on any PMO team.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Role
        </label>
        <SearchableSelect
          value={roleName}
          onChange={(v) => setRoleName(v)}
          options={ROLE_OPTIONS}
          placeholder="Select a role"
        />
        {helpText && (
          <p className="text-xs text-muted-foreground italic">{helpText}</p>
        )}
      </div>

      {roleName && (
        <div className="rounded-md border border-border bg-card p-4 space-y-4">
          {/* Users currently in the role */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 mb-2">
              Users with this role ({usersLoading ? '…' : usersInRole.length})
            </div>
            {usersLoading ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                <Loader2 className="inline h-4 w-4 animate-spin mr-1.5" />
                Loading users…
              </div>
            ) : usersInRole.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-2">
                No one currently has this role. Add someone below.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 rounded border border-border/60">
                {usersInRole.map((u) => (
                  <li key={u.systemuserid} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{u.fullname}</p>
                      {u.internalemailaddress && (
                        <p className="text-xs text-muted-foreground truncate">{u.internalemailaddress}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemovingUser(u)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove role from ${u.fullname}`}
                      title="Remove role"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add user */}
          <div className="space-y-2 pt-2 border-t border-border/60">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Grant role to a user
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={pendingUserId}
                  onChange={(v) => setPendingUserId(v)}
                  onSearch={searchUsers}
                  resolveLabel={resolveUserLabel}
                  placeholder="Search for a user by name or email"
                />
              </div>
              <Button
                onClick={handleAdd}
                disabled={!pendingUserId || adding || roleCopies.length === 0}
                size="sm"
              >
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                )}
                Grant
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!removingUser}
        title="Remove role from user?"
        message={
          removingUser
            ? `${removingUser.fullname} will lose the "${roleName}" role and any access it grants.`
            : ''
        }
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        onConfirm={handleRemove}
        onCancel={() => setRemovingUser(null)}
        isLoading={removing}
      />
    </section>
  );
}
