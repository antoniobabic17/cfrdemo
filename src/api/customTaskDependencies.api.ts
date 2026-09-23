/**
 * Option-C custom-source read + write helpers for pmo_taskdependency.
 *
 * See docs/pss-decoupling-c-design.md. pmo_taskdependency's project
 * scope is derived from the predecessor task (not a direct lookup on
 * the dependency row itself), so we filter by the predecessor's
 * pmo_project.
 *
 * The PSS path is blocked on DEV + PROD by the Microsoft Project
 * Operations licensing gate (E_OPERATION_BLOCKED_BY_LICENSE on
 * msdyn_projecttaskdependencylinktype). But pmo_taskdependency is OUR
 * OWN custom table, so that gate does NOT apply — a direct OData create
 * returns HTTP 204 (PROVEN on DEV 2026-07-31, see
 * scripts/probe-custom-dependency-write.py + the runbook). So on the
 * custom source we CRUD pmo_taskdependency directly, no PSS.
 *
 * linktype: the app-wide LINK_TYPE convention (schedulingClient) and the
 * pmo_linktype picklist agree that FS = 0, which is the only link type
 * our FS cascade supports. The reader passes pmo_linktype straight
 * through as msdyn_linktype; the writer stores the value as-is to keep
 * that round-trip consistent.
 */

import * as dv from '../lib/dataverseClient';
import { touchProjectFromTask } from './customProjects.api';
import type { ProjectTaskDependency } from '../models/projectTaskDependency.model';

interface PmoTaskDependencyRow {
  pmo_taskdependencyid: string;
  pmo_linktype?: number | null;
  _pmo_predecessortask_value?: string | null;
  _pmo_successortask_value?: string | null;
}

const SET = 'pmo_taskdependencies';

export function normalizeCustomTaskDependency(
  row: PmoTaskDependencyRow,
  projectId: string,
): ProjectTaskDependency {
  return {
    msdyn_projecttaskdependencyid: row.pmo_taskdependencyid,
    msdyn_linktype:                row.pmo_linktype ?? undefined,
    _msdyn_predecessortask_value:  row._pmo_predecessortask_value ?? undefined,
    _msdyn_successortask_value:    row._pmo_successortask_value ?? undefined,
    _msdyn_project_value:          projectId,
  };
}

/**
 * List dependencies whose predecessor pmo_task lives in this project.
 * We can't $filter by project directly (no lookup on the dep row) so
 * we join through the predecessor's _pmo_projectref_value.
 */
export async function listCustomTaskDependencies(projectId: string): Promise<ProjectTaskDependency[]> {
  // Filter deps whose predecessor task is in this project by expanding
  // the predecessor lookup. Fall back to fetching all deps + filtering
  // in JS if the $expand syntax bounces (rare).
  try {
    const rows = await dv.list<PmoTaskDependencyRow & {
      pmo_predecessortask?: { _pmo_projectref_value?: string };
    }>(SET, {
      $select: ['pmo_taskdependencyid', 'pmo_linktype',
                '_pmo_predecessortask_value', '_pmo_successortask_value'],
      $expand: 'pmo_predecessortask($select=_pmo_projectref_value)' as unknown as string[],
      $filter: `pmo_predecessortask/_pmo_projectref_value eq '${projectId}' and statecode eq 0`,
    });
    return rows.map((r) => normalizeCustomTaskDependency(r, projectId));
  } catch {
    // If the OData $expand filter isn't supported, return empty (no
    // rows exist in DEV/PROD today anyway).
    return [];
  }
}

// ── Option-C write path (direct OData on pmo_taskdependency, no PSS) ─────────
//
// Lookups bind via the PascalCase ReferencingEntityNavigationPropertyName from
// scripts/create-pmo-task-tables.py: pmo_PredecessorTask / pmo_SuccessorTask ->
// /pmo_tasks(<id>). pmo_name is ApplicationRequired (primary name), so we
// synthesise a label from the two task ids. Proven on DEV (HTTP 204).

export interface CustomDependencyCreateInput {
  predecessorTaskId: string;
  successorTaskId: string;
  /** Link type; FS=0 is the only value the cascade supports. Defaults to FS. */
  linkType?: number;
}

/** Shape the pmo_taskdependency create payload. Pure — unit tested. */
export function buildCustomDependencyCreatePayload(
  input: CustomDependencyCreateInput,
): Record<string, unknown> {
  return {
    pmo_name: `${input.predecessorTaskId} -> ${input.successorTaskId}`,
    pmo_linktype: input.linkType ?? 0,
    'pmo_PredecessorTask@odata.bind': `/pmo_tasks(${input.predecessorTaskId})`,
    'pmo_SuccessorTask@odata.bind': `/pmo_tasks(${input.successorTaskId})`,
  };
}

/** Create a dependency on the custom source. Returns the new GUID. */
export async function createCustomTaskDependency(
  input: CustomDependencyCreateInput,
): Promise<{ dependencyId: string }> {
  const created = await dv.create<PmoTaskDependencyRow>(SET, buildCustomDependencyCreatePayload(input));
  void touchProjectFromTask(input.predecessorTaskId);
  return { dependencyId: created.pmo_taskdependencyid };
}

/** Hard-delete a dependency (no soft-delete needed — deps carry no history). */
export async function deleteCustomTaskDependency(dependencyId: string): Promise<void> {
  try {
    const row = await dv.get<Record<string, unknown>>(SET, dependencyId, ['_pmo_predecessortask_value']);
    const t = row['_pmo_predecessortask_value'];
    if (typeof t === 'string' && t) void touchProjectFromTask(t);
  } catch { /* best-effort */ }
  await dv.remove(SET, dependencyId);
}
