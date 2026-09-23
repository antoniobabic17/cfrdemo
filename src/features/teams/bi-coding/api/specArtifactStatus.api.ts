/**
 * Spec Artifact Status API — reads pmo_ProjectArtifactStatus rows for a project
 * where pmo_status = SpecLifecycle (893460124).
 *
 * IC-07: The projection from rcm_aispeclifecycleevent arrives in pmo_specsummaryjson
 * as a compact JSON blob. This API surfaces that blob alongside the datetime
 * and repo URL columns added in T0-02 for the Coding tab to render.
 *
 * Only reads SpecLifecycle-type rows. Other artifact statuses (gates, docs, etc.)
 * are NOT returned — this keeps the fetch narrow and does not affect the standard
 * Govern workspace which reads all artifact statuses.
 */
import * as dv from '../../../../lib/dataverseClient';
import { ENTITY_SETS } from '../../../../lib/constants';

export const PMO_STATUS_SPEC_LIFECYCLE = 893460124;

export interface SpecArtifactStatusRow {
  pmo_projectartifactstatusid: string;
  pmo_name: string | null;
  pmo_specsummaryjson: string | null;
  pmo_speclastupdatedutc: string | null;
  pmo_specrepourl: string | null;
  pmo_status: number;
  createdon: string | null;
  modifiedon: string | null;
}

export async function listSpecArtifactStatuses(projectId: string): Promise<SpecArtifactStatusRow[]> {
  return dv.list<SpecArtifactStatusRow>(ENTITY_SETS.projectArtifactStatus, {
    $select: [
      'pmo_projectartifactstatusid',
      'pmo_name',
      'pmo_specsummaryjson',
      'pmo_speclastupdatedutc',
      'pmo_specrepourl',
      'pmo_status',
      'createdon',
      'modifiedon',
    ],
    $filter: `_pmo_project_value eq '${projectId}' and pmo_status eq ${PMO_STATUS_SPEC_LIFECYCLE}`,
    $orderby: 'pmo_speclastupdatedutc desc',
  });
}
