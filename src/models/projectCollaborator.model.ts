/** pmo_projectcollaborator — per-user access grants on a project.
 *
 * Used by the Individual collaboration mode. One row per granted user.
 * The pmo_projectteam junction table (team-based mode) is completely
 * separate and continues to function independently.
 */
export interface ProjectCollaborator {
  pmo_projectcollaboratorid: string;
  pmo_name?: string;
  statecode?: 0 | 1;
  createdon?: string;

  // Lookup: project (PSS shell — msdyn_project)
  '_pmo_project_value'?: string;
  '_pmo_project_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Parallel lookup: pmo_project (custom tables source)
  '_pmo_projectref_value'?: string;
  '_pmo_projectref_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: systemuser — the granted individual
  '_pmo_user_value'?: string;
  '_pmo_user_value@OData.Community.Display.V1.FormattedValue'?: string;

  // Lookup: team — the team the user was added through, nullable.
  // Set when added by expanding a team's checkbox list; null for a directly
  // searched individual add.
  '_pmo_viateam_value'?: string | null;
  '_pmo_viateam_value@OData.Community.Display.V1.FormattedValue'?: string | null;
}

/** Payload for creating a project-collaborator record */
export type ProjectCollaboratorCreate = {
  /** e.g. /msdyn_projects(guid) or /pmo_projects(guid) depending on data source */
  'pmo_Project@odata.bind'?: string;
  'pmo_ProjectRef@odata.bind'?: string;
  /** e.g. /systemusers(guid) */
  'pmo_User@odata.bind': string;
  /** e.g. /teams(guid) — omit for a directly-added individual */
  'pmo_ViaTeam@odata.bind'?: string;
};
