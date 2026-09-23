/**
 * tableViewRegistry — the single catalog of tables that support custom views,
 * their human labels, and every column that can appear in a view.
 *
 * Both the Admin "Default view" editor and the runtime read this so an admin
 * can configure a table's org-wide Default view (which columns show, their
 * order, and default widths) WITHOUT opening each list page. Each list page's
 * DataTable still owns the actual render logic; the registry is the shared
 * description of what's configurable.
 *
 * Keep the `key`/`header` values in sync with each page's DataTable columns.
 */
import { migrateLegacyFormula, isLegacyFormula } from './customColumns';
export interface RegistryColumn {
  key: string;
  header: string;
  defaultWidth?: number;
  /**
   * True for columns that are computed by the app at runtime from other row
   * data (e.g. lastNote, _projectCount, computed labels) and therefore have no
   * backing Dataverse attribute. Virtual columns are NEVER flagged `isRemoved`
   * by a metadata re-pull — they are unconditionally preserved.
   */
  isVirtual?: boolean;
}

export interface RegistryTable {
  tableKey: string;
  label: string;
  columns: RegistryColumn[];
}

/** A column discovered live from Dataverse attribute metadata (admin re-pull).
 *  Persisted per table in pmo_appsettings under columnCatalogKey(tableKey, source). */
export interface DiscoveredColumn {
  key: string;
  header: string;
  /** Dataverse AttributeType (String, Lookup, DateTime, Picklist, ...). Persisted
   *  in the catalog so lookups can be tagged + offered an aspect picker. */
  type?: string;
  /** True when this is a lookup/customer/owner column (derived from type). */
  isLookup?: boolean;
  /** For lookups: referenced entity logical name(s), e.g. ['systemuser']. */
  targets?: string[];
}

export const TABLE_VIEW_REGISTRY: RegistryTable[] = [
  {
    tableKey: 'projects',
    label: 'Projects',
    columns: [
      { key: 'pmo_projectid', header: 'Project ID' },
      { key: 'pmo_legacyprojectid', header: 'Legacy ID' },
      { key: 'msdyn_subject', header: 'Project' },
      { key: 'statecode', header: 'Status' },
      { key: 'pmo_projectstatus', header: 'Project Status' },
      { key: '_msdyn_projectmanager_value', header: 'Project Manager' },
      { key: '_pmo_primaryteam_value', header: 'Team' },
      { key: '_msdyn_program_value', header: 'Program' },
      { key: 'proj_overallhealth', header: 'Health' },
      // Computed at read-time from child task effort/completion — no backing DV attribute.
      { key: 'msdyn_progress', header: 'Progress', isVirtual: true },
      // Task-derived finish: rolled up from child task scheduledend/finish and
      // persisted back to pmo_finish. Normalizer alias: msdyn_finish → pmo_finish.
      { key: 'msdyn_finish', header: 'Task Finish Date' },
      // Manual PMO-entered finish date (editable on Project Detail → Financials tab).
      { key: 'proj_actualfinishdate', header: 'Finish Date' },
      { key: 'msdyn_scheduledstart', header: 'Scheduled Start' },
      { key: 'createdon', header: 'Created On' },
      { key: '_createdby_value', header: 'Created By' },
      { key: 'modifiedon', header: 'Modified On' },
      { key: '_modifiedby_value', header: 'Modified By' },
      { key: '_pmo_payerinitiatives_hpiissue_value', header: 'Issue Number' },
      { key: 'pmo_payerinitiatives_saedisplayname', header: 'Strategic Account Executive' },
      // Computed by ProjectListPage from the latest annotation row — no DV attribute.
      { key: 'lastNote', header: 'Last Note', isVirtual: true },
      { key: 'lastNoteDate', header: 'Last Note Date', isVirtual: true },
      // Computed client-side from pmo_tracking rows — no backing pmo_project attribute.
      { key: 'trackingLabels', header: 'Tracking Label', isVirtual: true },
    ],
  },
  {
    tableKey: 'programs',
    label: 'Programs',
    columns: [
      { key: 'pmo_programid', header: 'Program ID' },
      { key: 'msdyn_name', header: 'Program' },
      { key: 'proj_overallhealth', header: 'Health' },
      { key: 'proj_state', header: 'State' },
      { key: '_proj_manager_value', header: 'Program Manager' },
      // Computed by ProgramListPage from the linked projects query — no DV attribute.
      { key: '_projectCount', header: 'Projects', isVirtual: true },
      { key: 'msdyn_budget', header: 'Budget' },
      { key: 'proj_programdue', header: 'Due' },
      { key: 'proj_programstart', header: 'Program Start' },
      { key: 'createdon', header: 'Created On' },
      { key: '_createdby_value', header: 'Created By' },
      { key: 'modifiedon', header: 'Modified On' },
      { key: '_modifiedby_value', header: 'Modified By' },
    ],
  },
  {
    tableKey: 'intake',
    label: 'Intake Queue',
    columns: [
      // All intake columns are computed from the raw pmo_projectrequest row by
      // the queue builder (IntakeListPage / useIntake hooks) — none map 1:1 to a
      // raw DV attribute key that could be re-pulled from metadata.
      { key: 'ref', header: 'Item', isVirtual: true },
      { key: 'title', header: 'Description', isVirtual: true },
      { key: 'submittedBy', header: 'Submitted By', isVirtual: true },
      { key: 'typeLabel', header: 'Type', isVirtual: true },
      { key: 'statusLabel', header: 'Status', isVirtual: true },
      { key: 'priorityLabel', header: 'Priority', isVirtual: true },
      { key: 'teamLabel', header: 'Team', isVirtual: true },
      { key: 'createdon', header: 'Submitted' },
    ],
  },
  {
    tableKey: 'userFeedback',
    label: 'User Feedback',
    columns: [
      { key: 'pmo_feedbacktype', header: 'Type' },
      { key: 'pmo_title', header: 'Title' },
      { key: 'pmo_description', header: 'Description' },
      { key: 'pmo_priority', header: 'Priority' },
      { key: '_createdby_value', header: 'Submitted By' },
      { key: '_pmo_assignedto_value', header: 'Assigned To' },
      { key: 'pmo_status', header: 'Status' },
      { key: 'createdon', header: 'Submitted' },
    ],
  },
  {
    tableKey: 'hpi',
    label: 'HPI — Health Plan Issues',
    columns: [
      { key: 'rcm_issuenumber', header: 'Issue #' },
      { key: 'rcm_statusdetails', header: 'Name' },
      { key: '_rcm_analyst_value', header: 'Analyst' },
      { key: 'rcm_reservebucketpayer', header: 'Payer / Bucket' },
      { key: 'rcm_risk', header: 'Risk' },
      { key: 'cr87a_arrecoverytype', header: 'AR Recovery Type' },
      // Computed by HpiGallery from the project-lookup — no rcm_payerdeckissue attribute.
      { key: '_relatedProject', header: 'Related Project', isVirtual: true },
      { key: 'cr87a_credentialing', header: 'Credentialing' },
      { key: 'cr87a_pathforward', header: 'Path Forward' },
      { key: 'createdon', header: 'Created On' },
      { key: 'modifiedon', header: 'Modified On' },
    ],
  },
  {
    tableKey: 'payerInquiries',
    label: 'Payer Inquiries',
    columns: [
      { key: 'cr87a_payerissueidauto', header: 'ID' },
      { key: 'cr87a_name', header: 'Name' },
      { key: '_cr87a_assignedanalyst_value', header: 'Analyst' },
      { key: '_cr87a_payer_value', header: 'Payer' },
      { key: 'cr87a_payerissuestatus', header: 'Status' },
      { key: 'cr87a_payerissuetype', header: 'Type' },
      { key: '_pmo_payerinitiatives_project_value', header: 'Project' },
      { key: '_createdby_value', header: 'Created By' },
      { key: 'rcm_accepteddate', header: 'Accepted Date' },
      { key: 'cr87a_response', header: 'Response' },
      { key: 'cr87a_shortdescription', header: 'Short Description' },
      { key: 'createdon', header: 'Created On' },
      { key: 'modifiedon', header: 'Modified On' },
    ],
  },
  {
    tableKey: 'errorLog',
    label: 'Error Log',
    columns: [
      { key: 'createdon', header: 'Time' },
      // All remaining errorLog columns are extracted from the pmo_telemetryevent
      // payload JSON by ErrorLogPage — they are not raw DV attribute keys.
      { key: 'user', header: 'User', isVirtual: true },
      { key: 'route', header: 'Page', isVirtual: true },
      { key: 'action', header: 'Action', isVirtual: true },
      { key: 'message', header: 'Message', isVirtual: true },
      { key: 'attempt', header: 'Attempt', isVirtual: true },
      { key: 'outcome', header: 'Outcome', isVirtual: true },
    ],
  },
];

export function getRegistryTable(tableKey: string): RegistryTable | undefined {
  return TABLE_VIEW_REGISTRY.find((t) => t.tableKey === tableKey);
}

/** appsettings key holding the org-wide Default-view config for a table. */
export function orgDefaultViewKey(tableKey: string): string {
  return `view.default.${tableKey}`;
}

/**
 * appsettings key holding the admin-discovered column catalog for a table.
 *
 * For source-dependent tables (projects, programs) the key is scoped by data
 * source — `columns.catalog.projects.pss` vs `columns.catalog.projects.custom`
 * — so a PSS pull never overwrites the custom catalog and vice versa.
 */
export function columnCatalogKey(tableKey: string, source?: string): string {
  return source ? `columns.catalog.${tableKey}.${source}` : `columns.catalog.${tableKey}`;
}

/**
 * appsettings key holding the admin-authored custom computed-column formulas for
 * a table. Stored as JSON CustomColumnFormula[]. Never touched by re-pull.
 *
 * For source-dependent tables (projects, programs) the key is scoped by data
 * source — `columns.custom.projects.pss` vs `columns.custom.projects.custom`
 * — so a PSS formula set never overwrites the custom-source formula set and
 * vice versa. Mirrors the same scoping used by columnCatalogKey.
 */
export function customColumnsKey(tableKey: string, source?: string): string {
  return source ? `columns.custom.${tableKey}.${source}` : `columns.custom.${tableKey}`;
}

/**
 * appsettings key holding the admin-configured column label overrides for a
 * table. Stored as JSON Record<colKey, label>. Org-wide, survives re-pull.
 */
export function columnLabelsKey(tableKey: string): string {
  return `columns.labels.${tableKey}`;
}

/** A lookup column aspect: which part of the related record to display. */
export type LookupAspect = 'name' | 'guid' | 'email' | string;

/** appsettings key for a table's org-wide lookup-aspect map (colKey -> aspect). */
export function lookupAspectKey(tableKey: string): string {
  return `columns.lookupAspect.${tableKey}`;
}

/** Parse the lookup-aspect override map stored in pmo_appsettings. */
export function parseLookupAspects(raw: string | undefined): Record<string, LookupAspect> {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, LookupAspect> : {};
  } catch {
    return {};
  }
}

export function parseColumnCatalog(raw: string | undefined): DiscoveredColumn[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as DiscoveredColumn[];
    return Array.isArray(p)
      ? p.filter((c) => c && typeof c.key === 'string').map((c) => ({
          key: c.key,
          header: c.header,
          ...(c.type ? { type: c.type } : {}),
          ...(c.isLookup ? { isLookup: true } : {}),
          ...(Array.isArray(c.targets) && c.targets.length ? { targets: c.targets } : {}),
        }))
      : [];
  } catch {
    return [];
  }
}

/** Parse the custom-column formula list stored in pmo_appsettings.
 *  Legacy rows with parts[] are migrated on read; they self-heal on next save. */
export function parseCustomColumns(raw: string | undefined): import('./customColumns').CustomColumnFormula[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p
      .filter((c: unknown) => c && typeof (c as { id?: unknown }).id === 'string')
      .map((c: unknown) => isLegacyFormula(c as never) ? migrateLegacyFormula(c as never) : c as import('./customColumns').CustomColumnFormula);
  } catch {
    return [];
  }
}

/** Parse the column-label overrides stored in pmo_appsettings. */
export function parseColumnLabels(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, string> : {};
  } catch {
    return {};
  }
}

/**
 * Column catalogs can exceed the pmo_appsetting `pmo_value` 4000-char cap (a PSS
 * table like msdyn_project has hundreds of attributes), so a catalog is stored
 * ACROSS multiple rows: the base key holds part 0, and `<base>~1`, `<base>~2`, …
 * hold the overflow.
 */
const CATALOG_CHUNK_MAX = 3500;

export function columnCatalogChunkKey(tableKey: string, index: number, source?: string): string {
  const base = columnCatalogKey(tableKey, source);
  return index === 0 ? base : `${base}~${index}`;
}

export function columnCatalogChunkIndex(key: string, tableKey: string, source?: string): number | null {
  const base = columnCatalogKey(tableKey, source);
  if (key === base) return 0;
  const prefix = `${base}~`;
  if (key.startsWith(prefix)) {
    const n = Number(key.slice(prefix.length));
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function serializeColumnCatalogChunks(catalog: DiscoveredColumn[]): string[] {
  // Persist type + lookup metadata (isLookup/targets) so the admin editor can
  // tag lookups and offer the aspect picker without a re-pull. Emit lookup fields
  // only when set to keep the JSON compact (chunk cap is 3500 chars).
  const json = JSON.stringify(catalog.map((c) => ({
    key: c.key,
    header: c.header,
    ...(c.type ? { type: c.type } : {}),
    ...(c.isLookup ? { isLookup: true } : {}),
    ...(c.targets && c.targets.length ? { targets: c.targets } : {}),
  })));
  if (json.length <= CATALOG_CHUNK_MAX) return [json];
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += CATALOG_CHUNK_MAX) {
    chunks.push(json.slice(i, i + CATALOG_CHUNK_MAX));
  }
  return chunks;
}

export function reassembleColumnCatalog(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }>,
  tableKey: string,
  source?: string,
): DiscoveredColumn[] {
  const parts: { idx: number; val: string }[] = [];
  for (const s of settings) {
    const idx = columnCatalogChunkIndex(s.pmo_key ?? '', tableKey, source);
    if (idx == null) continue;
    parts.push({ idx, val: s.pmo_value ?? '' });
  }
  if (parts.length === 0) return [];
  parts.sort((a, b) => a.idx - b.idx);
  return parseColumnCatalog(parts.map((p) => p.val).join(''));
}

/**
 * Merge the shipped registry columns for a table with an admin-discovered
 * catalog.
 *
 * Rules:
 * - Shipped virtual columns (isVirtual) are NEVER flagged isRemoved regardless of
 *   the catalog — they have no Dataverse attribute to look up.
 * - Shipped non-virtual columns are flagged isRemoved when absent from the catalog
 *   (the metadata says the attribute no longer exists).
 * - Catalog-only columns are appended as isNew, EXCEPT when their label is an
 *   exact case-insensitive match of an existing shipped column's label. That
 *   prevents label collisions (e.g. msdyn_name → "Program" shadowing the shipped
 *   _msdyn_program_value → "Program").
 */
export interface MergedColumn {
  key: string;
  header: string;
  isNew?: boolean;
  isRemoved?: boolean;
  /** True for app-computed columns that have no backing Dataverse attribute. */
  isVirtual?: boolean;
  /**
   * When this shipped column is a normalizer alias (e.g. key = 'msdyn_scheduledstart'
   * but the real Dataverse attribute on the custom table is 'pmo_scheduledstart'),
   * this field holds the real attribute key. Shown read-only in the admin editor
   * so admins can identify the actual column — never used for data reads.
   */
  realKey?: string;
  /** True when the backing attribute is a lookup/customer/owner (from catalog). */
  isLookup?: boolean;
  /** Lookup target entity logical name(s), e.g. ['systemuser']. */
  targets?: string[];
}

// ── Alias resolution ──────────────────────────────────────────────────────
// Source-dependent tables (projects, programs) use normalizer-remapped keys
// in the registry/hand-written page columns (e.g. msdyn_subject,
// proj_actualfinishdate) but the real Dataverse attribute on the
// custom-source pmo_* entity has a different name (e.g. pmo_subject,
// pmo_actualfinishdate). This map is the authoritative key→key mapping built
// directly from the LOOKUP_MAP / CHOICE_MAP definitions in
// customProjects.api.ts / customPrograms.api.ts. Used by BOTH mergeColumns
// (admin editor dedup) and DataTable (grid + view-editor dedup) so a
// re-pulled catalog column that IS the backing attribute of an existing
// hand-written column never appears twice.
const TABLE_ALIAS_MAP: Record<string, Record<string, string>> = {
  projects: {
    msdyn_subject:                    'pmo_subject',
    msdyn_scheduledstart:             'pmo_scheduledstart',
    msdyn_finish:                     'pmo_finish',
    proj_actualfinishdate:            'pmo_actualfinishdate',
    _msdyn_program_value:             '_pmo_program_value',
    _msdyn_projectmanager_value:      '_pmo_projectmanager_value',
    proj_overallhealth:               'pmo_overallhealth',
    proj_efforthealth:                'pmo_efforthealth',
    proj_financialhealth:             'pmo_financialhealth',
    proj_schedulehealth:              'pmo_schedulehealth',
    proj_issuehealth:                 'pmo_issuehealth',
    // The shipped SAE column (pmo_payerinitiatives_saedisplayname, the AAD
    // snapshot text) SUPERSEDES the legacy systemuser lookup. Both are real,
    // separately-discoverable Dataverse attributes whose catalog labels differ
    // from the shipped header ("Payer Initiative Team: SAE Name" and "Payer
    // Initiative Team: Strategic Account Executive" vs shipped "Strategic
    // Account Executive"), so the shippedLabels collision guard below never
    // catches the lookup. Without this entry a re-pull surfaces the lookup as a
    // SECOND selectable "Strategic Account Executive" column (and it renders
    // blank, since the lookup's FormattedValue is empty for ~91% of rows).
    pmo_payerinitiatives_saedisplayname: '_pmo_payerinitiatives_strategicaccountexecutive_value',
  },
  programs: {
    msdyn_name:          'pmo_name',
    _proj_manager_value: '_pmo_manager_value',
    proj_overallhealth:  'pmo_overallhealth',
    msdyn_budget:        'pmo_budget',
    proj_programstart:   'pmo_programstart',
    proj_programdue:     'pmo_programdue',
    proj_state:          'pmo_state',
  },
};

/** The alias map (shipped/page key → real Dataverse attribute key) for a table. */
export function getAliasMap(tableKey: string): Record<string, string> {
  return TABLE_ALIAS_MAP[tableKey] ?? {};
}

/**
 * The set of real Dataverse attribute keys that are already represented by an
 * existing hand-written/shipped column under a different (alias) key. A
 * catalog-discovered column whose key is in this set must NEVER be surfaced
 * again as a separate selectable column — it IS the same field.
 */
export function getAliasTargets(tableKey: string): Set<string> {
  return new Set(Object.values(getAliasMap(tableKey)));
}

export function mergeColumns(
  tableKey: string,
  catalog: DiscoveredColumn[],
): MergedColumn[] {
  const shipped = getRegistryTable(tableKey)?.columns ?? [];
  if (catalog.length === 0) {
    return shipped.map((c) => ({ key: c.key, header: c.header, isVirtual: c.isVirtual }));
  }
  const catByKey = new Map(catalog.map((c) => [c.key, c]));
  const shippedKeys = new Set(shipped.map((c) => c.key));
  const aliasMap = getAliasMap(tableKey);
  const aliasTargets = getAliasTargets(tableKey);

  // Build set of shipped labels ONLY for shipped columns that:
  //   a) ARE present in the catalog by key (no alias needed), AND
  //   b) have no alias (so their label isn't confused with the real pmo_* col)
  // This keeps the label-collision fallback for the narrow PSS case (e.g.
  // msdyn_name vs _msdyn_program_value both labelled "Program" on msdyn tables)
  // without accidentally hiding real pmo_* columns.
  const shippedLabels = new Set(
    shipped
      .filter((c) => catByKey.has(c.key) && !aliasMap[c.key])
      .map((c) => c.header.toLowerCase()),
  );

  const merged: MergedColumn[] = shipped.map((c) => {
    const realKey = aliasMap[c.key];
    // When the alias key is found in the catalog, surface it so the admin
    // editor can show the real Dataverse attribute name.
    const resolvedRealKey = realKey && catByKey.has(realKey) ? realKey : undefined;
    const catHit = catByKey.get(c.key) ?? (realKey ? catByKey.get(realKey) : undefined);
    return {
      key: c.key,
      header: c.header,
      isVirtual: c.isVirtual,
      realKey: resolvedRealKey,
      isLookup: catHit?.isLookup,
      targets: catHit?.targets,
      // Virtual columns are never removed.
      // Non-virtual: present if the shipped key is in the catalog, OR if its
      // known alias (real pmo_* attribute) is in the catalog.
      isRemoved: c.isVirtual ? false : (!catByKey.has(c.key) && !catByKey.has(realKey ?? '')),
    };
  });

  for (const c of catalog) {
    // Skip if the key is already in the shipped registry.
    if (shippedKeys.has(c.key)) continue;
    // Skip if this catalog key is the known alias target of a shipped column
    // (it IS that shipped column under a different name — no duplicate needed).
    if (aliasTargets.has(c.key)) continue;
    // Skip if the label exactly matches a shipped column whose key IS present
    // in the catalog (narrow PSS label-collision fallback for cases like
    // msdyn_name/'Program' vs _msdyn_program_value/'Program' on msdyn tables).
    if (shippedLabels.has((c.header ?? '').toLowerCase())) continue;
    merged.push({ key: c.key, header: c.header, isNew: true, isLookup: c.isLookup, targets: c.targets });
  }
  return merged;
}

/**
 * Find groups of columns that share the same display label (case-insensitive)
 * after applying admin label overrides. Returns only groups with 2+ members.
 *
 * Used by the admin Table Default Views editor to warn the admin after a re-pull
 * when the catalog surfaces new columns whose labels collide with existing ones,
 * offering an inline rename to disambiguate.
 *
 * @param columns  Full merged column list (shipped + catalog + custom).
 * @param labelOverrides  The current label-override map (columns.labels.<table>).
 */
export interface DuplicateLabelGroup {
  /** The shared display label (lowercased). */
  label: string;
  /** All column keys sharing this label, in the order they appear in `columns`. */
  keys: string[];
}

export function findDuplicateLabels(
  columns: Array<{ key: string; header: string }>,
  labelOverrides: Record<string, string> = {},
): DuplicateLabelGroup[] {
  const byLabel = new Map<string, string[]>();
  for (const col of columns) {
    const effective = (labelOverrides[col.key] || col.header).trim().toLowerCase();
    if (!effective) continue;
    const existing = byLabel.get(effective);
    if (existing) {
      existing.push(col.key);
    } else {
      byLabel.set(effective, [col.key]);
    }
  }
  return [...byLabel.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([label, keys]) => ({ label, keys }));
}

export interface OrgDefaultViewConfig {
  columns?: string[];
  widths?: Record<string, number>;
}

export function parseOrgDefaultView(raw: string | undefined): OrgDefaultViewConfig {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw) as OrgDefaultViewConfig;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
