/** pmo_projectteam — project-team junction table */
export interface ProjectTeam {
  pmo_projectteamid: string;
  pmo_name?: string;                  // Auto: "{Project name} — {Team name}"
  pmo_role?: number;                  // Choice: TEAM_ROLE
  'pmo_role@OData.Community.Display.V1.FormattedValue'?: string;
  pmo_joineddate?: string;
  pmo_notes?: string;
  statecode?: 0 | 1;
  statuscode?: number;
  createdon?: string;

  // Lookup: msdyn_project
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: team (Dataverse system team)
  '_pmo_team_value'?: string;
  '_pmo_team_value@OData.Community.Display.V1.FormattedValue'?: string;
}

/** Payload for creating a project-team junction record */
export type ProjectTeamCreate = {
  'pmo_Project@odata.bind': string;  // e.g. /msdyn_projects(guid)
  'pmo_Team@odata.bind': string;     // e.g. /teams(guid)
  pmo_role: number;                   // TEAM_ROLE.Primary or .Contributing
  pmo_joineddate?: string;
  pmo_notes?: string;
};
