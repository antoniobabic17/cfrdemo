/**
 * Helpers for the msdyn_project → pmo_project decoupling (Tier 1).
 *
 * Governance / monitoring sidecar tables (decisions, gates, baselines,
 * meeting links, project teams, closeouts, artifact statuses, notifications,
 * telemetry) historically bound their project lookup `pmo_Project` to the
 * msdyn_project SHELL. Tier 1 added a parallel `pmo_ProjectRef` lookup that
 * targets `pmo_project` directly. These sidecar tables are written in BOTH
 * data-source modes, so the bind + read filter must branch:
 *
 *   - custom → bind pmo_ProjectRef → /pmo_projects(id), read _pmo_projectref_value
 *   - pss    → bind pmo_Project    → /msdyn_projects(id), read _pmo_project_value
 *
 * Reads match EITHER value (OR filter) so rows written under either mode — or
 * before the backfill — are never missed during the transition window.
 *
 * Same-GUID contract: the project id is identical across pmo_project and the
 * msdyn_project shell, so the same `projectId` is a valid bind target for both.
 */
import type { DataSource } from './taskSource';
import { getCachedDataSource, usesCustomTables } from './taskSource';

/** The old shell-targeted lookup (still used by the pss path). */
export const PSS_PROJECT_BIND = 'pmo_Project@odata.bind' as const;
export const PSS_PROJECT_VALUE = '_pmo_project_value' as const;
/** The new pmo_project-targeted lookup (custom path). */
export const CUSTOM_PROJECT_BIND = 'pmo_ProjectRef@odata.bind' as const;
export const CUSTOM_PROJECT_VALUE = '_pmo_projectref_value' as const;

/**
 * The create-payload @odata.bind entry for a project-scoped sidecar row.
 * Returns a single-key object so callers can spread it into their payload.
 */
export function projectBind(
  projectId: string,
  dataSource: DataSource,
): Record<string, string> {
  return usesCustomTables(dataSource)
    ? { [CUSTOM_PROJECT_BIND]: `/pmo_projects(${projectId})` }
    : { [PSS_PROJECT_BIND]: `/msdyn_projects(${projectId})` };
}

/**
 * OData `$filter` fragment matching a sidecar row to a project via EITHER
 * lookup value. Use inside a larger filter, e.g.
 *   `${projectMatch(id)} and statecode eq 0`
 */
export function projectMatch(projectId: string): string {
  return `(${CUSTOM_PROJECT_VALUE} eq '${projectId}' or ${PSS_PROJECT_VALUE} eq '${projectId}')`;
}

/** The `$select` fields needed to read a sidecar row's project id in either mode. */
export const PROJECT_VALUE_SELECT: readonly string[] = [CUSTOM_PROJECT_VALUE, PSS_PROJECT_VALUE];

/**
 * Any row read from a project-scoped sidecar table.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: a typed model interface
 * such as `UatTestCase` has no index signature, so the stricter type would force every
 * call site to cast — and a cast at the call site is where the wrong row type gets
 * silently accepted. The cast happens once, inside these two readers.
 */
type ProjectBearingRow = object;

/** Resolve whichever project value is populated on a read row (custom first). */
export function readProjectValue(row: ProjectBearingRow): string | undefined {
  const bag = row as Record<string, unknown>;
  return (bag[CUSTOM_PROJECT_VALUE] as string | undefined)
    ?? (bag[PSS_PROJECT_VALUE] as string | undefined);
}

/**
 * The project's NAME on a read row, from the lookup's formatted-value annotation.
 *
 * Sibling of readProjectValue, and it has to branch the same way: the annotation hangs
 * off whichever of the two lookups is populated, so reading only one half returns
 * undefined for every row written in the other mode. Dataverse supplies the annotation
 * alongside any selected `_..._value`, so no extra column or join is needed.
 *
 * Returns undefined rather than a placeholder — a cross-project list showing a dash is a
 * different statement from one showing "Unknown project", and only the caller knows which
 * it wants to make.
 */
export function readProjectName(row: ProjectBearingRow): string | undefined {
  const bag = row as Record<string, unknown>;
  const fv = '@OData.Community.Display.V1.FormattedValue';
  return (bag[`${CUSTOM_PROJECT_VALUE}${fv}`] as string | undefined)
    ?? (bag[`${PSS_PROJECT_VALUE}${fv}`] as string | undefined);
}

/**
 * Fire-and-forget project bind for non-React utilities (notify/errorLog/telemetry).
 * Uses the module-cached data source (getCachedDataSource) so callers outside React
 * don't need the settings array. Best-effort: these writes swallow errors, so a
 * stale cache only mislabels a non-critical notification/telemetry project link.
 */
export function projectBindLoose(projectId: string): Record<string, string> {
  return projectBind(projectId, getCachedDataSource());
}

/**
 * Extract the project GUID from a create payload's project @odata.bind entry
 * (custom pmo_ProjectRef or pss pmo_Project). Returns undefined if neither is
 * present. Lets a create path touch the project without an extra read.
 */
export function projectIdFromBindPayload(payload: Record<string, unknown>): string | undefined {
  const bind = (payload[CUSTOM_PROJECT_BIND] ?? payload[PSS_PROJECT_BIND]) as string | undefined;
  if (!bind) return undefined;
  const m = /(([^)]+))s*$/.exec(bind);
  return m ? m[1] : undefined;
}
