/**
 * UAT requirement / traceability layer.
 *
 * ONE table covers epics, stories, requirements, tasks and spikes, Jira-aligned,
 * with a self-referential parent chain. pmo_parent is RemoveLink: deleting an epic
 * promotes its stories to top-level rather than deleting a backlog branch.
 *
 * THE DUAL PROJECT REFERENCE. Every project-scoped UAT table carries both
 * _pmo_project_value (the msdyn_project shell) and _pmo_projectref_value (the custom
 * pmo_project row). Read either via lib/projectLookupRef.ts's readProjectValue, and
 * bind with projectBind — never assume one is populated. Custom-source projects have
 * NO msdyn_project row at all, which is why a single lookup could not work. See
 * progress.md finding 15.
 */
import type { ActiveState } from './common.model';

/** The six-column external-tracker block, identical on requirement, test case and defect. */
export interface UatExternalTrackerFields {
  /** Bound to the global pmo_uatexternalsystem set. NOT the ITPR — see G-ITPR. */
  pmo_externalsystem: number | null;
  pmo_externalkey: string | null;
  pmo_externalid: string | null;
  pmo_externalurl: string | null;
  pmo_externalstatus: string | null;
  pmo_externalsyncedon: string | null;
}

/** The dual project reference, read side. */
export interface UatProjectReferenceFields {
  /** msdyn_project shell. Populated on the pss data source. */
  _pmo_project_value: string | null;
  /** pmo_project row. Populated on the custom data source, where no shell exists. */
  _pmo_projectref_value: string | null;
}

export interface UatRequirement extends ActiveState, UatExternalTrackerFields, UatProjectReferenceFields {
  pmo_uatrequirementid: string;
  /** Autonumber, REQ-00000. Never set on create or update. */
  pmo_name: string;
  pmo_title: string;
  pmo_description: string | null;
  pmo_acceptancecriteria: string | null;
  /** Global pmo_uatrequirementtype set. */
  pmo_type: number | null;
  /** Global pmo_uatrequirementstatus set. */
  pmo_status: number | null;
  /** Global pmo_uatpriority set, shared with test case and defect. */
  pmo_priority: number | null;
  /** Self-referential. Null for a top-level item. */
  _pmo_parent_value: string | null;
  /** Decimal so an item can always be dropped between two neighbours. */
  pmo_rank: number | null;
  pmo_storypoints: number | null;
  createdon: string;
  modifiedon: string;
}

export interface UatRequirementUpdate {
  pmo_title?: string;
  pmo_description?: string | null;
  pmo_acceptancecriteria?: string | null;
  pmo_type?: number | null;
  pmo_status?: number | null;
  pmo_priority?: number | null;
  pmo_rank?: number | null;
  pmo_storypoints?: number | null;
  pmo_externalsystem?: number | null;
  pmo_externalkey?: string | null;
  pmo_externalid?: string | null;
  pmo_externalurl?: string | null;
  pmo_externalstatus?: string | null;
  pmo_externalsyncedon?: string | null;
  /** '/pmo_uatrequirements(<guid>)' or null to promote to top level. */
  'pmo_Parent@odata.bind'?: string | null;
  /** Spread the result of projectBind() rather than setting either by hand. */
  'pmo_Project@odata.bind'?: string | null;
  'pmo_ProjectRef@odata.bind'?: string | null;
}

export interface UatRequirementCreate extends UatRequirementUpdate {
  pmo_title: string;
}
