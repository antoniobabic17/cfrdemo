/**
 * Team-level New Resource Model administration (Admin → Architecture &
 * Templates → Resourcing → Labor Hours).
 *
 * Enabling a team:
 *   1. Snapshot every one of the team's projects' current
 *      pmo_usenewresourcemodel value (so a later disable can restore the exact
 *      prior mix).
 *   2. Flip every LABOR project (metric = Labor or unset) to the New Resource
 *      Model. Financial projects are skipped — NRM is a labor-hours concept.
 *   3. Set the per-team default flag so NEW projects for this team default on.
 *
 * Disabling a team:
 *   - Clears the default flag.
 *   - Either restores the snapshot (each project back to its pre-enable value)
 *     or forces every team project to the old model — the admin chooses.
 *
 * "The team's projects" = projects whose PRIMARY team is this team
 * (_pmo_primaryteam_value). Custom source only (pmo_project); NRM columns don't
 * exist on msdyn_project.
 */
import * as dv from '../lib/dataverseClient';
import { RESOURCE_METRIC_TYPE } from '../lib/constants';

const SET = 'pmo_projects';

interface TeamProjectRow {
  pmo_projectid: string;
  pmo_subject?: string | null;
  pmo_usenewresourcemodel?: boolean | null;
  pmo_resourcemetrictype?: number | null;
}

const bareGuid = (v: string) => v.replace(/[{}]/g, '').trim().toLowerCase();

/** Active projects whose primary team is `teamId`. */
export async function listTeamProjects(teamId: string): Promise<TeamProjectRow[]> {
  const id = bareGuid(teamId);
  return dv.list<TeamProjectRow>(SET, {
    $select: ['pmo_projectid', 'pmo_subject', 'pmo_usenewresourcemodel', 'pmo_resourcemetrictype'],
    $filter: `_pmo_primaryteam_value eq ${id} and statecode eq 0`,
    $top: 1000,
  });
}

/** True when a project is Labor-tracked (metric = Labor or unset). */
function isLaborProject(row: TeamProjectRow): boolean {
  return (row.pmo_resourcemetrictype ?? RESOURCE_METRIC_TYPE.Labor) !== RESOURCE_METRIC_TYPE.Financial;
}

/** JSON snapshot map { projectId: prevUseNewResourceModel } for ALL team projects. */
export function buildNrmSnapshot(rows: TeamProjectRow[]): Record<string, boolean> {
  const snap: Record<string, boolean> = {};
  for (const r of rows) snap[r.pmo_projectid] = r.pmo_usenewresourcemodel === true;
  return snap;
}

export interface BulkNrmResult {
  scanned: number;
  changed: number;
  skippedFinancial: number;
  errors: string[];
}

/**
 * Turn the New Resource Model ON for every LABOR project of the team. Financial
 * projects are left untouched. Returns counts + any per-row errors (best-effort:
 * one failure doesn't abort the rest).
 */
export async function enableNrmForTeamProjects(rows: TeamProjectRow[]): Promise<BulkNrmResult> {
  const res: BulkNrmResult = { scanned: rows.length, changed: 0, skippedFinancial: 0, errors: [] };
  for (const r of rows) {
    if (!isLaborProject(r)) { res.skippedFinancial += 1; continue; }
    if (r.pmo_usenewresourcemodel === true) continue; // already on
    try {
      await dv.update(SET, r.pmo_projectid, { pmo_usenewresourcemodel: true });
      res.changed += 1;
    } catch (err) {
      res.errors.push(`${r.pmo_subject ?? r.pmo_projectid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}

/**
 * Turn the New Resource Model OFF for the team's projects. When `snapshot` is
 * provided, each project is restored to its snapshotted value; otherwise every
 * project is forced to the old model (false).
 */
export async function disableNrmForTeamProjects(
  rows: TeamProjectRow[],
  snapshot: Record<string, boolean> | null,
): Promise<BulkNrmResult> {
  const res: BulkNrmResult = { scanned: rows.length, changed: 0, skippedFinancial: 0, errors: [] };
  for (const r of rows) {
    const target = snapshot ? (snapshot[r.pmo_projectid] === true) : false;
    if ((r.pmo_usenewresourcemodel === true) === target) continue; // already at target
    try {
      await dv.update(SET, r.pmo_projectid, { pmo_usenewresourcemodel: target });
      res.changed += 1;
    } catch (err) {
      res.errors.push(`${r.pmo_subject ?? r.pmo_projectid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}
