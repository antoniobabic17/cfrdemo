/**
 * columnDiscovery — read Dataverse ATTRIBUTE METADATA so an admin can "re-pull"
 * the set of columns available for a table's views WITHOUT a code deploy.
 *
 * Background: the shipped column catalog is the hand-maintained
 * TABLE_VIEW_REGISTRY. Every new Dataverse column had to be added there by hand
 * before it could appear in the admin Table Default Views editor or any user
 * view. This module discovers columns live from the platform metadata instead.
 *
 * Mechanism: dv.retrieveEntityAttributes() — the SDK's native `getEntityMetadata`
 * action. It is the ONLY metadata path that routes through the Code Apps bridge:
 * the host resolves the registered entity-SET source to its logical name and
 * builds EntityDefinitions(LogicalName='…')?$expand=Attributes itself. (The old
 * implementation tried dv.list() against an EntityDefinitions(…)/Attributes path
 * string, which Code Apps does not support — so every table returned 0 columns.)
 *
 * Source-awareness: PROJECT and PROGRAM live in EITHER the Microsoft PSS tables
 * (msdyn_*) or our custom pmo_* tables depending on the `pmo.data_source` admin
 * flag. Discovery must read the metadata of whichever set is currently active,
 * so the tableKey -> entity-set resolution is computed against the cached data
 * source (see resolveEntitySet).
 *
 * Catalog keys: for source-dependent tables the catalog is stored under a
 * source-scoped key (e.g. `columns.catalog.projects.pss`) so PSS and custom
 * catalogs co-exist without overwriting each other. Callers use
 * `SOURCE_DEPENDENT_TABLE_KEYS` to decide when to pass `source` to
 * columnCatalogChunkKey / reassembleColumnCatalog.
 *
 * Read-only. No schema changes. The discovered catalog is persisted per table in
 * pmo_appsettings by the caller (see TableViewsSection re-pull handler).
 */
import * as dv from './dataverseClient';
import type { DataverseAttributeMetadata } from './dataverseClient';
import { getCachedDataSource, type DataSource } from './taskSource';
import { type DiscoveredColumn } from './tableViewRegistry';

/**
 * Maps each view-supporting tableKey to the registered Dataverse ENTITY-SET
 * source name whose attribute metadata backs it. These keys MUST exist in
 * dataverseClient.DATAVERSE_SOURCES + power.config.json (the host resolves the
 * logical name from them).
 *
 * Project/Program are source-dependent: under `pmo.data_source` = 'pss' the app
 * reads msdyn_*; under 'custom' it reads pmo_*. resolveEntitySet() picks the
 * right one at call time. All other tables are single-source.
 */
const TABLE_KEY_TO_ENTITYSET: Record<string, string | Record<DataSource, string>> = {
  projects: { pss: 'msdyn_projects', custom: 'pmo_projects', sharepoint: 'pmo_projects' },
  programs: { pss: 'msdyn_projectprograms', custom: 'pmo_programs', sharepoint: 'pmo_programs' },
  intake: 'pmo_projectrequests',
  userFeedback: 'pmo_userfeedbacks',
  hpi: 'rcm_payerdeckissues',
  payerInquiries: 'cr87a_payerissues',
  errorLog: 'pmo_telemetryevents',
};

/** The tableKeys discovery can re-pull (stable order for the "re-pull all" run). */
export const DISCOVERABLE_TABLE_KEYS = Object.keys(TABLE_KEY_TO_ENTITYSET);

/**
 * Table keys whose catalog is scoped by data source. For these tables callers
 * must pass the active DataSource to columnCatalogChunkKey / reassembleColumnCatalog
 * so PSS and custom catalogs are stored and read independently.
 */
export const SOURCE_DEPENDENT_TABLE_KEYS: ReadonlySet<string> = new Set(
  Object.entries(TABLE_KEY_TO_ENTITYSET)
    .filter(([, v]) => typeof v === 'object')
    .map(([k]) => k),
);

/**
 * Resolve a tableKey to the entity-set source to query, honoring the active
 * `pmo.data_source` for the source-dependent Project/Program tables. Returns
 * undefined for an unknown tableKey.
 */
export function resolveEntitySet(
  tableKey: string,
  source: DataSource = getCachedDataSource(),
): string | undefined {
  const entry = TABLE_KEY_TO_ENTITYSET[tableKey];
  if (!entry) return undefined;
  return typeof entry === 'string' ? entry : entry[source];
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function labelOf(r: DataverseAttributeMetadata): string | undefined {
  // DisplayName.UserLocalizedLabel.Label is the human header; fall back to the
  // first localized label if the user-locale one is absent.
  const dn = r.DisplayName;
  const ull = dn?.UserLocalizedLabel?.Label;
  if (ull) return ull;
  const first = dn?.LocalizedLabels?.[0]?.Label;
  if (first) return first;
  return undefined;
}

/** Map an attribute's logical name to the field key the app queries + renders.
 *  Lookups are read through the `_<name>_value` form (matching $select and the
 *  FormattedValue annotation the DataTable already uses). */
function fieldKey(logicalName: string, attrType: string): string {
  const t = attrType.toLowerCase();
  if (t === 'lookup' || t === 'customer' || t === 'owner') {
    return `_${logicalName}_value`;
  }
  return logicalName;
}

function toDiscovered(r: DataverseAttributeMetadata): DiscoveredColumn | null {
  const logical = str(r.LogicalName);
  if (!logical) return null;

  // Skip attributes that can't be read, and synthetic child attributes
  // (AttributeOf points at a parent, e.g. the *_base / formatted shadows).
  if (r.IsValidForRead === false) return null;
  if (r.AttributeOf != null && r.AttributeOf !== '') return null;

  const attrType = str(r.AttributeType);
  // Virtual/embedded types carry no queryable scalar — skip.
  if (attrType.toLowerCase() === 'virtual') return null;

  const key = fieldKey(logical, attrType);
  const header = labelOf(r) ?? logical;
  const t = attrType.toLowerCase();
  const isLookup = t === 'lookup' || t === 'customer' || t === 'owner';
  const targets = isLookup && Array.isArray(r.Targets)
    ? r.Targets.filter((x): x is string => typeof x === 'string')
    : undefined;
  return { key, header, type: attrType || 'String', ...(isLookup ? { isLookup } : {}), ...(targets && targets.length ? { targets } : {}) };
}

/**
 * Discover the readable columns for one table by its tableKey. Reads whichever
 * entity set is active for the current data source. Returns [] if metadata is
 * unreachable (caller keeps the shipped catalog).
 */
export async function discoverColumns(
  tableKey: string,
  source: DataSource = getCachedDataSource(),
): Promise<DiscoveredColumn[]> {
  const entitySet = resolveEntitySet(tableKey, source);
  if (!entitySet) return [];

  let attrs: DataverseAttributeMetadata[] = [];
  try {
    attrs = await dv.retrieveEntityAttributes(entitySet);
  } catch (err) {
    console.warn(`[columnDiscovery] Metadata fetch failed for ${tableKey} (${entitySet}).`, err);
    return [];
  }
  if (attrs.length === 0) {
    console.warn(`[columnDiscovery] No attribute metadata returned for ${tableKey} (${entitySet}).`);
    return [];
  }

  const seen = new Set<string>();
  const out: DiscoveredColumn[] = [];
  for (const a of attrs) {
    const dc = toDiscovered(a);
    if (dc && !seen.has(dc.key)) { seen.add(dc.key); out.push(dc); }
  }
  // Stable, human-friendly order: by header.
  out.sort((a, b) => a.header.localeCompare(b.header));
  return out;
}

export interface TableDiscoveryResult {
  tableKey: string;
  entitySet: string;
  /** The data source used for this discovery run. Populated for source-dependent
   *  tables (projects, programs); undefined for single-source tables. Callers use
   *  this to scope the catalog storage key correctly. */
  source?: DataSource;
  columns: DiscoveredColumn[];
  ok: boolean;
}

/**
 * Discover columns for EVERY table that supports custom views (the admin
 * "re-pull all" action). Runs sequentially to be gentle on the metadata
 * endpoint; each table is independent so one failure never blocks the rest.
 * Uses the active data source for the source-dependent Project/Program tables.
 */
export async function discoverAllTables(
  onProgress?: (done: number, total: number, current: string) => void,
  source: DataSource = getCachedDataSource(),
): Promise<TableDiscoveryResult[]> {
  const keys = DISCOVERABLE_TABLE_KEYS;
  const results: TableDiscoveryResult[] = [];
  let done = 0;
  for (const tableKey of keys) {
    onProgress?.(done, keys.length, tableKey);
    const entitySet = resolveEntitySet(tableKey, source);
    if (!entitySet) { done++; continue; }
    const columns = await discoverColumns(tableKey, source);
    results.push({
      tableKey,
      entitySet,
      source: SOURCE_DEPENDENT_TABLE_KEYS.has(tableKey) ? source : undefined,
      columns,
      ok: columns.length > 0,
    });
    done++;
    onProgress?.(done, keys.length, tableKey);
  }
  return results;
}
