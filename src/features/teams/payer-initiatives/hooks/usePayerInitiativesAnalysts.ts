/**
 * Payer Initiatives -- team-scoped systemuser picker helpers.
 *
 * The Analyst lookup on rcm_payerdeckissue (SchemaName rcm_Analyst,
 * Targets: ['systemuser']) is scoped to members of the Payer Initiatives
 * AAD-synced team. Team name varies per env (DEV: "Payer Initiatives",
 * PROD: "Coram Finance RevCycle - Payer Initiatives") -- resolve by name
 * so the same client code works in both.
 *
 * Reuses the server-side SearchableSelect pattern established in
 * hooks/useIntakeLookups.ts + components/admin/TeamMembershipSection.tsx.
 */
import { useQuery } from '@tanstack/react-query';
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';
import type { SelectOption } from '../../../../components/common/SearchableSelect';
import { PAYER_INITIATIVES_TEAM_NAMES } from '../constants';

interface TeamRow { teamid: string; name: string; }
interface UserRow { systemuserid: string; fullname: string; }

// Module-level cache -- team ids are stable per environment, so one
// resolution per session is enough.
let _teamIdsCache: string[] | null = null;
async function resolvePayerInitiativesTeamIds(): Promise<string[]> {
  if (_teamIdsCache) return _teamIdsCache;
  const nameClauses = PAYER_INITIATIVES_TEAM_NAMES.map(
    (n) => `name eq '${n.replace(/'/g, "''")}'`,
  ).join(' or ');
  const rows = await dv.list<TeamRow>(ENTITY_SETS.team, {
    $select: ['teamid', 'name'],
    $filter: nameClauses,
    $top: 10,
  });
  _teamIdsCache = rows.map((r) => r.teamid);
  return _teamIdsCache;
}

function escapeODataString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Server-side search for the SearchableSelect analyst picker.
 * Filters systemusers whose teammembership_association includes any of
 * the Payer Initiatives team ids resolved by name.
 */
export async function searchPayerInitiativesAnalysts(query: string): Promise<SelectOption[]> {
  const teamIds = await resolvePayerInitiativesTeamIds();
  if (teamIds.length === 0) return [];
  const teamClause = teamIds.map((id) => `t/teamid eq ${id}`).join(' or ');
  const safe = escapeODataString(query.trim());
  const nameClause = safe
    ? `and (contains(fullname,'${safe}') or contains(lastname,'${safe}') or contains(firstname,'${safe}'))`
    : '';
  const users = await dv.list<UserRow>('systemusers', {
    $select: ['systemuserid', 'fullname'],
    $filter: `teammembership_association/any(t: ${teamClause}) ${nameClause}`.trim(),
    $orderby: 'fullname asc',
    $top: 50,
  });
  return users.map((u) => ({ value: u.systemuserid, label: u.fullname }));
}

/**
 * Resolve a single systemuser's display label. Used by SearchableSelect
 * to render the trigger text when only a value id is known (e.g. drawer
 * re-opens on an existing HPI).
 */
export async function resolveAnalystLabel(systemUserId: string): Promise<string> {
  if (!systemUserId) return '';
  try {
    const user = await dv.get<UserRow>('systemusers', systemUserId, ['fullname']);
    return user.fullname ?? '';
  } catch {
    return '';
  }
}

/**
 * Pre-populated Payer Initiatives analyst roster. Every enabled systemuser
 * whose teammembership_association includes a Payer Initiatives team id
 * (resolved by name for env portability). Returned alphabetically for the
 * SearchableSelect static-options path. No query needed at call time --
 * this mirrors listPayerInitiativeProjects()'s preload pattern in
 * api/hpi.api.ts and is cached by useActivePayerInitiativesAnalysts().
 */
export async function listPayerInitiativesAnalysts(): Promise<SelectOption[]> {
  const teamIds = await resolvePayerInitiativesTeamIds();
  if (teamIds.length === 0) return [];
  const teamClause = teamIds.map((id) => `t/teamid eq ${id}`).join(' or ');
  const users = await dv.list<UserRow>('systemusers', {
    $select: ['systemuserid', 'fullname'],
    $filter: `teammembership_association/any(t: ${teamClause}) and isdisabled eq false`,
    $orderby: 'fullname asc',
    $top: 500,
  });
  return users.map((u) => ({ value: u.systemuserid, label: u.fullname }));
}

/**
 * Pre-populated Payer Initiatives analyst roster hook. Mirrors
 * useActivePayerInitiativeProjects() in useHpiIssues.ts -- one fetch per
 * session, cached 5 minutes, so the analyst SearchableSelect on the HPI
 * intake/create/edit forms opens with every team member already listed
 * (no typing required). Team-name resolution inside
 * listPayerInitiativesAnalysts() covers both envs (DEV: "Payer Initiatives",
 * PROD: "Coram Finance RevCycle - Payer Initiatives").
 */
export function useActivePayerInitiativesAnalysts() {
  return useQuery({
    queryKey: ["payer-initiatives", "analysts"] as const,
    queryFn: listPayerInitiativesAnalysts,
    staleTime: 5 * 60 * 1000,
  });
}
