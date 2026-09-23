/**
 * Custom-source (pmo_projectrisk) read/write for the Monitor tab. Sister to
 * customTasks.api.ts. Used only when dataSource === 'custom'; the pss path stays
 * on projectRisks.api.ts (msdyn_projectrisk). Normalizes pmo_* rows back into the
 * existing ProjectRisk model shape so RiskWorkspace needs no changes, synthesizing
 * the picklist FormattedValue annotations from monitorOptionLabels.
 */
import * as dv from '../lib/dataverseClient';
import { touchCustomProject, touchProjectFromChild } from './customProjects.api';
import type { ProjectRisk } from '../models/projectRisk.model';
import type { ProjectRiskCreate, ProjectRiskPayload } from './projectRisks.api';
import { RISK_CATEGORY_LABELS, STATE_LABELS, labelFor } from './monitorOptionLabels';
import { toEdmDate, edmDateToNoonUtc } from '../lib/dateOnly';

const SET = 'pmo_projectrisks';

interface PmoRiskRow {
  pmo_projectriskid: string;
  pmo_subject?: string | null;
  pmo_description?: string | null;
  pmo_contingencyplan?: string | null;
  pmo_mitigationplan?: string | null;
  pmo_impact?: number | null;
  pmo_probability?: number | null;
  pmo_exposure?: number | null;
  pmo_cost?: number | null;
  pmo_costexposure?: number | null;
  pmo_due?: string | null;
  pmo_category?: number | null;
  pmo_state?: number | null;
  statecode?: 0 | 1;
  createdon?: string;
  _pmo_project_value?: string | null;
  _pmo_assignedto_value?: string | null;
  '_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const BASE_SELECT: string[] = [
  'pmo_projectriskid', 'pmo_subject', 'pmo_description', 'pmo_contingencyplan',
  'pmo_mitigationplan', 'pmo_impact', 'pmo_probability', 'pmo_exposure', 'pmo_cost',
  'pmo_costexposure', 'pmo_due', 'pmo_category', 'pmo_state', 'statecode', 'createdon',
  '_pmo_project_value', '_pmo_assignedto_value',
];

export function normalizeCustomRisk(row: PmoRiskRow): ProjectRisk {
  return {
    msdyn_projectriskid: row.pmo_projectriskid,
    msdyn_name: row.pmo_subject ?? '',
    msdyn_subject: row.pmo_subject ?? undefined,
    msdyn_description: row.pmo_description ?? undefined,
    msdyn_contingencyplan: row.pmo_contingencyplan ?? undefined,
    msdyn_mitigationplan: row.pmo_mitigationplan ?? undefined,
    proj_impact: row.pmo_impact ?? undefined,
    proj_probability: row.pmo_probability ?? undefined,
    proj_exposure: row.pmo_exposure ?? undefined,
    proj_cost: row.pmo_cost ?? undefined,
    proj_costexposure: row.pmo_costexposure ?? undefined,
    // pmo_due is an Edm.Date column (bare YYYY-MM-DD). Expand to noon-UTC so
    // the app's date renderers show the picked day, not the day before.
    proj_due: edmDateToNoonUtc(row.pmo_due),
    proj_category: row.pmo_category ?? undefined,
    'proj_category@OData.Community.Display.V1.FormattedValue': labelFor(RISK_CATEGORY_LABELS, row.pmo_category),
    proj_state: row.pmo_state ?? undefined,
    'proj_state@OData.Community.Display.V1.FormattedValue': labelFor(STATE_LABELS, row.pmo_state),
    statecode: row.statecode ?? 0,
    createdon: row.createdon,
    _msdyn_project_value: row._pmo_project_value ?? undefined,
    _proj_assignedto_value: row._pmo_assignedto_value ?? undefined,
    '_proj_assignedto_value@OData.Community.Display.V1.FormattedValue':
      row['_pmo_assignedto_value@OData.Community.Display.V1.FormattedValue'],
  };
}

export async function listCustomRisks(projectId: string): Promise<ProjectRisk[]> {
  const rows = await dv.list<PmoRiskRow>(SET, {
    $select: BASE_SELECT,
    $filter: `_pmo_project_value eq '${projectId}' and statecode eq 0`,
    $orderby: 'createdon desc',
  });
  return rows.map(normalizeCustomRisk);
}

/** Map the msdyn/proj-shaped payload the dialog produces to the pmo_* columns.
 *  Exported for unit tests (Edm.Date conversion regression). */
export function toPmoRiskPayload(p: ProjectRiskPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.msdyn_subject !== undefined) out.pmo_subject = p.msdyn_subject;
  if (p.msdyn_description !== undefined) out.pmo_description = p.msdyn_description;
  if (p.msdyn_contingencyplan !== undefined) out.pmo_contingencyplan = p.msdyn_contingencyplan;
  if (p.msdyn_mitigationplan !== undefined) out.pmo_mitigationplan = p.msdyn_mitigationplan;
  if (p.proj_impact !== undefined) out.pmo_impact = p.proj_impact;
  if (p.proj_probability !== undefined) out.pmo_probability = p.proj_probability;
  if (p.proj_category !== undefined) out.pmo_category = p.proj_category;
  if (p.proj_state !== undefined) out.pmo_state = p.proj_state;
  // pmo_due is Edm.Date — send a bare YYYY-MM-DD. A full ISO ('...T12:00:00Z')
  // is rejected: "Cannot convert the literal to the expected type 'Edm.Date'".
  if (p.proj_due !== undefined) out.pmo_due = p.proj_due === null ? null : toEdmDate(p.proj_due);
  if (p.proj_cost !== undefined) out.pmo_cost = p.proj_cost;
  const owner = p['proj_AssignedTo@odata.bind'];
  if (owner !== undefined) {
    out['pmo_AssignedTo@odata.bind'] = owner; // /systemusers(id) | null — same target
  }
  return out;
}

export async function createCustomRisk(projectId: string, payload: ProjectRiskCreate): Promise<ProjectRisk> {
  const body = toPmoRiskPayload(payload);
  body['pmo_Project@odata.bind'] = `/pmo_projects(${projectId})`;
  const created = await dv.create<PmoRiskRow>(SET, body);
  void touchCustomProject(projectId);
  return normalizeCustomRisk(created);
}

export async function updateCustomRisk(id: string, payload: ProjectRiskPayload): Promise<void> {
  await dv.update(SET, id, toPmoRiskPayload(payload));
  void touchProjectFromChild(SET, id, '_pmo_project_value');
}

/** Soft-delete (statecode=1), matching the msdyn deactivate path. */
export async function deleteCustomRisk(id: string): Promise<void> {
  void touchProjectFromChild(SET, id, '_pmo_project_value');
  await dv.deactivate(SET, id);
}
