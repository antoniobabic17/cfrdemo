import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, TEAM_ROLE } from '../lib/constants';
import type { ProjectTeam, ProjectTeamCreate } from '../models/projectTeam.model';
import type { DataSource } from '../lib/taskSource';
import { projectBind, projectMatch, PSS_PROJECT_BIND, CUSTOM_PROJECT_BIND } from '../lib/projectLookupRef';
import { usesCustomTables } from '../lib/taskSource';

const SET = ENTITY_SETS.projectTeam;

const BASE_SELECT: string[] = [
  'pmo_projectteamid',
  'pmo_name',
  'pmo_role',
  'pmo_joineddate',
  'pmo_notes',
  'statecode',
  'createdon',
  '_pmo_project_value',
  '_pmo_team_value',
];

// Phase 1 hybrid security: privileges granted to a Contributing team on
// the parent msdyn_project record. The owning (Primary) team gets edit
// access through ownership, not sharing — only Contributing rows trigger
// these calls. See docs/security-model.md.
const CONTRIBUTING_PROJECT_ACCESS_MASK =
  'ReadAccess, WriteAccess, AppendAccess, AppendToAccess';

export async function listProjectTeams(projectId: string): Promise<ProjectTeam[]> {
  return dv.list<ProjectTeam>(SET, {
    $select: BASE_SELECT,
    $filter: `${projectMatch(projectId)} and statecode eq 0`,
    $orderby: 'pmo_role asc, createdon asc',
  });
}

/** Parse a Dataverse @odata.bind value like "/msdyn_projects(<guid>)" into the
 *  bare GUID. Returns undefined if the input doesn't match the expected shape. */
function extractIdFromBind(bind: string | undefined): string | undefined {
  if (!bind) return undefined;
  const m = bind.match(/\(([0-9a-f-]{36})\)/i);
  return m?.[1];
}

export async function createProjectTeam(payload: ProjectTeamCreate, dataSource: DataSource): Promise<ProjectTeam> {
  // Rewrite the project bind for the active source (custom -> pmo_project,
  // pss -> msdyn shell). Caller may pass the project id via either bind key.
  const callerProjectId = extractIdFromBind(
    (payload as unknown as Record<string, string | undefined>)[PSS_PROJECT_BIND]
    ?? (payload as unknown as Record<string, string | undefined>)[CUSTOM_PROJECT_BIND]);
  const { [PSS_PROJECT_BIND]: _pa, [CUSTOM_PROJECT_BIND]: _pb, ...restTeam } = payload as Record<string, unknown>;
  const boundPayload = { ...(restTeam as ProjectTeamCreate),
    ...(callerProjectId ? projectBind(callerProjectId, dataSource) : {}) };
  const created = await dv.create<ProjectTeam>(SET, boundPayload);
  // For Contributing rows, grant the team edit access on the parent project
  // record. Primary team uses ownership (set elsewhere) so no share is needed.
  if (payload.pmo_role === TEAM_ROLE.Contributing) {
    const projectId = callerProjectId;
    const teamId = extractIdFromBind((payload as unknown as Record<string, string | undefined>)['pmo_Team@odata.bind']);
    const projSet = usesCustomTables(dataSource) ? 'pmo_projects' : 'msdyn_projects';
    const projType = usesCustomTables(dataSource) ? 'Microsoft.Dynamics.CRM.pmo_project' : 'Microsoft.Dynamics.CRM.msdyn_project';
    const projIdField = usesCustomTables(dataSource) ? 'pmo_projectid' : 'msdyn_projectid';
    if (projectId && teamId) {
      try {
        await dv.executeAction(projSet, 'GrantAccess', {
          Target: {
            '@odata.type': projType,
            [projIdField]: projectId,
          },
          PrincipalAccess: {
            Principal: {
              '@odata.type': 'Microsoft.Dynamics.CRM.team',
              teamid: teamId,
            },
            AccessMask: CONTRIBUTING_PROJECT_ACCESS_MASK,
          },
        });
      } catch (err) {
        // Sharing failed — leave the projectteam row in place. The team
        // appears in the Collaborate tab but won't have edit access until
        // an admin re-shares (or this row is removed and re-added).
        console.error('GrantAccess on parent project failed:', err);
      }
    }
  }
  return created;
}

export async function removeProjectTeam(id: string): Promise<void> {
  // Capture project + team + role BEFORE deactivation so we can revoke the
  // sharing immediately afterward. If the read fails, fall through and skip
  // the revoke — better to leave the row deactivated than block the removal.
  let projectId: string | undefined;
  let teamId: string | undefined;
  let role: number | undefined;
  try {
    const row = await dv.get<ProjectTeam>(SET, id, [
      '_pmo_project_value',
      '_pmo_team_value',
      'pmo_role',
    ]);
    projectId = row._pmo_project_value;
    teamId = row._pmo_team_value;
    role = row.pmo_role;
  } catch {
    // Read failure → revoke is skipped below.
  }

  await dv.deactivate(SET, id);

  if (role === TEAM_ROLE.Contributing && projectId && teamId) {
    try {
      await dv.executeAction('msdyn_projects', 'RevokeAccess', {
        Target: {
          '@odata.type': 'Microsoft.Dynamics.CRM.msdyn_project',
          msdyn_projectid: projectId,
        },
        Revokee: {
          '@odata.type': 'Microsoft.Dynamics.CRM.team',
          teamid: teamId,
        },
      });
    } catch (err) {
      // Revoke failed — the team still has shared access on the project
      // until an admin manually unshares. Logged for triage.
      console.error('RevokeAccess on parent project failed:', err);
    }
  }
}
