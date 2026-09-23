/**
 * SharePoint general-data client.
 *
 * Implements the same contract as `dv.*` (dataverseClient.ts) but routes calls
 * through the SharePoint connector instead of Dataverse OData. Used by the
 * `isSharePointDataActive()` short-circuit in dataverseClient.ts when
 * `pmo.data_source = 'sharepoint'`.
 *
 * Design principles:
 *  1. Mirror the dv.* signatures exactly so no call-site changes are needed.
 *  2. Row translation is centralised here (not scattered across call sites):
 *     - WRITE: strip `@odata.bind` nav-prop keys to their bare `_*_value` guid.
 *     - READ:  synthesise `@OData.Community.Display.V1.FormattedValue` annotations
 *       from stored text so the UI's existing FormattedValue precedence keeps working.
 *  3. OData filter translation: convert Dataverse-style filter expressions to the
 *     SP connector's supported subset. Unknown constructs fall back to client-side
 *     filtering rather than throwing, with a console.warn.
 *  4. Pagination: follow skipToken until exhausted (mirrors dv.list behaviour).
 *  5. No PSS / Dataverse-specific operations (GrantAccess, executeAsync, etc.)
 *     — those are never routed here; they always stay on Dataverse.
 *
 * SP connector is accessed via the same `getClient(ALL_SOURCES)` pattern used by
 * sharePointFiles.ts, with SP_DATASOURCE = 'appdocuments'. Both the file-storage
 * lists and the data lists live on the same connector at runtime — the data-source
 * name is passed per-call.
 */

import { getClient } from '@microsoft/power-apps/data';
import type { IOperationOptions } from '@microsoft/power-apps/data';
import { ALL_SOURCES } from './dataverseClient';
import { getSpListDef } from './sharePointData';
import type { ODataParams } from '../models/common.model';

// ── SP client ─────────────────────────────────────────────────────────────────

function spClient() { return getClient(ALL_SOURCES); }

// The SP data source name.  Must match the connection-reference binding wired at
// provisioning time (power.config.json connectionReferences / dataSets key).
// Using the same 'appdocuments' source as the file library while a dedicated
// data-lists source is provisioned; update this constant when the connection
// reference is split.
const SP_DATA_SOURCE = 'appdocuments';

// ── OData → SP filter translation ────────────────────────────────────────────
//
// Dataverse `$filter` strings the app builds:
//   statecode eq 0
//   _pmo_project_value eq <guid>
//   (_pmo_project_value eq <guid> or _pmo_projectref_value eq <guid>)
//   (or-chained id list)  (_col eq id1 or _col eq id2)
//   contains(col,'val')
//
// SP connector filter quirks:
//   - GUIDs must be quoted: `_col eq 'guid'` not `_col eq guid`
//   - Boolean: `col eq 1` (SP uses 0/1), not `col eq true`
//   - `contains(col,'val')` → `substringof('val',col)` for older SP REST;
//     many connectors also accept `contains` — we keep it as-is and fall back.
//
// Unsupported: `objecttypecode eq 'logicalname'`, expand, startswith on text, etc.

const BARE_GUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b(?!')/gi;
const BOOL_TRUE_RE = /\beq true\b/g;
const BOOL_FALSE_RE = /\beq false\b/g;

/** Translate a Dataverse OData filter string to its SP connector equivalent. */
export function translateFilter(dvFilter: string): string {
  let f = dvFilter;
  // Quote bare GUID literals (SP text columns need quoted values).
  f = f.replace(BARE_GUID_RE, "'$1'");
  // Boolean literals → integer (SP Boolean columns stored as 0/1 for REST filters).
  f = f.replace(BOOL_TRUE_RE, 'eq 1');
  f = f.replace(BOOL_FALSE_RE, 'eq 0');
  return f;
}

/** Apply client-side filtering as a fallback for predicates the SP connector
 *  may reject. Evaluates simple `eq` / `ne` predicates only. */
function clientSideFilter<T extends Record<string, unknown>>(
  rows: T[],
  dvFilter: string,
): T[] {
  // Only attempt the simple `field eq 'value'` and `field ne 'value'` forms.
  // Everything more complex is left unfiltered (safe over-inclusion).
  const EQ_RE = /^\s*([\w_]+)\s+(eq|ne)\s+'([^']*)'\s*$/i;
  const m = dvFilter.match(EQ_RE);
  if (!m) return rows;
  const [, col, op, val] = m;
  return rows.filter((r) => {
    const cv = String(r[col] ?? '').toLowerCase();
    return op.toLowerCase() === 'eq' ? cv === val.toLowerCase() : cv !== val.toLowerCase();
  });
}

// ── Row normalisation ─────────────────────────────────────────────────────────
//
// The app reads `<col>@OData.Community.Display.V1.FormattedValue` for choices
// and lookup display names. SP lists don't return these. We synthesise the key
// so the existing UI precedence (genericCellValue, custom*.api.ts FV handling)
// sees a consistent value — for SP rows, the FormattedValue is the raw stored
// text (i.e. the integer code for choices, or the GUID for lookups).
// This is intentionally lightweight: Phase 3 runtime semantics match the
// custom-Dataverse path where FormattedValues are only needed for the fields
// explicitly in the CHOICE_MAP / LOOKUP_MAP normalisers in each api module.
// Those normalisers read pmo_* columns directly, so the absence of a "real"
// FormattedValue (human-readable label) means choice labels will show as their
// integer codes. That is acceptable for the initial SP-backend path; richer
// label synthesis can be added per-table once the SP path is verified to work.

const FV_SUFFIX = '@OData.Community.Display.V1.FormattedValue';

/** Add synthesised FormattedValue annotations to an SP row so the UI's existing
 *  FV-precedence logic keeps working. */
function addFormattedValues(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(row)) {
    // Skip internal SP metadata keys and already-synthesised FV keys.
    if (k.includes('@') || k.startsWith('{') || v == null) continue;
    // Only annotate columns that don't already have an FV.
    if (!(k + FV_SUFFIX in out)) {
      out[k + FV_SUFFIX] = String(v);
    }
  }
  return out;
}

// ── @odata.bind → _*_value flattening ────────────────────────────────────────
//
// Create/update payloads use @odata.bind nav-props:
//   { 'pmo_ProjectRef@odata.bind': '/pmo_projects(<guid>)' }
// SP lists don't support nav-props; flatten to the bare _*_value guid column.

const BIND_RE = /^(.+)@odata\.bind$/i;
const ID_RE   = /\(([0-9a-f-]{36})\)\s*$/i;

function flattenBindPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const bm = k.match(BIND_RE);
    if (bm && typeof v === 'string') {
      // Derive the _*_value column name: 'pmo_ProjectRef' → '_pmo_projectref_value'
      const navProp  = bm[1];
      const colName  = '_' + navProp.replace(/([A-Z])/g, (c) => c.toLowerCase()) + '_value';
      const guidMatch = v.match(ID_RE);
      out[colName]   = guidMatch ? guidMatch[1] : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normId(id: string): string {
  return id.replace(/[{}]/g, '').toLowerCase();
}

/** Map a Dataverse entity set + PK guid to the SP item's internal integer ID.
 *  SP items have an auto-increment integer 'ID' (or ItemInternalId) as the
 *  native primary key. We must resolve the SP item ID from the Dataverse GUID
 *  stored in the primaryKey text column before doing update/delete. */
async function resolveSpItemId(entitySet: string, dvGuid: string): Promise<string> {
  const def = getSpListDef(entitySet);
  if (!def) throw new Error(`[spDataClient] No SP list def for '${entitySet}'`);
  const pk  = def.primaryKey;
  const safe = normId(dvGuid).replace(/'/g, "''");
  const res = await spClient().retrieveMultipleRecordsAsync<Record<string, unknown>>(
    SP_DATA_SOURCE,
    { filter: `${pk} eq '${safe}'`, top: 1, select: ['ID', pk] },
  );
  if (!res.success) throw new Error(`[spDataClient] resolveSpItemId failed for ${entitySet}/${dvGuid}`);
  const row = (res.data ?? [])[0];
  if (!row) throw new Error(`[spDataClient] SP item not found: ${entitySet}/${dvGuid}`);
  const spId = row['ID'] ?? row['ItemInternalId'];
  if (spId == null) throw new Error(`[spDataClient] SP item has no ID: ${entitySet}/${dvGuid}`);
  return String(spId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List records from a SharePoint list. Mirrors dv.list().
 * Pages through skipToken until exhausted (SP connector caps ~5000/page).
 */
export async function spList<T>(entitySet: string, params: ODataParams = {}): Promise<T[]> {
  const def = getSpListDef(entitySet);
  if (!def) return [];

  const translatedFilter = params.$filter ? translateFilter(params.$filter) : undefined;
  const baseOpts: Record<string, unknown> = {};
  if (params.$select?.length) baseOpts.select = params.$select;
  if (translatedFilter) baseOpts.filter = translatedFilter;
  if (params.$orderby) baseOpts.orderBy = params.$orderby.split(',').map((s) => s.trim());
  if (params.$top !== undefined) baseOpts.top = params.$top;

  const all: T[] = [];
  let skipToken: string | undefined;
  const hardCap = params.$top;

  for (let page = 0; page < 200; page++) {
    const opts: IOperationOptions = skipToken
      ? { ...(baseOpts as IOperationOptions), skipToken }
      : (baseOpts as IOperationOptions);
    let result: Awaited<ReturnType<ReturnType<typeof spClient>['retrieveMultipleRecordsAsync']>>;
    try {
      result = await spClient().retrieveMultipleRecordsAsync<Record<string, unknown>>(
        SP_DATA_SOURCE, opts,
      );
    } catch (err) {
      // If the translated filter was rejected, fall back to unfiltered + client-side.
      if (translatedFilter && params.$filter) {
        console.warn(`[spDataClient] SP filter rejected for ${entitySet}; falling back to client-side.`, err);
        const unfiltered = await spList<T>(entitySet, { ...params, $filter: undefined });
        return clientSideFilter(unfiltered as Record<string, unknown>[], params.$filter) as T[];
      }
      throw err;
    }
    if (!result.success) throw new Error(`[spDataClient] spList failed for ${entitySet}: ${String(result.error)}`);
    const rows = ((result.data ?? []) as Record<string, unknown>[]).map(addFormattedValues) as T[];
    all.push(...rows);
    if (hardCap !== undefined && all.length >= hardCap) return all.slice(0, hardCap);
    skipToken = (result as unknown as { skipToken?: string }).skipToken || undefined;
    if (!skipToken || rows.length === 0) break;
  }
  return all;
}

/**
 * Get a single record by its Dataverse GUID. Mirrors dv.get().
 * Filters the SP list on the primaryKey column.
 */
export async function spGet<T>(entitySet: string, id: string, _select?: string[]): Promise<T> {
  const def = getSpListDef(entitySet);
  if (!def) throw new Error(`[spDataClient] No SP list def for '${entitySet}'`);
  const safe = normId(id).replace(/'/g, "''");
  const rows = await spList<T>(entitySet, {
    $filter: `${def.primaryKey} eq ${safe}`,  // translateFilter will quote it
    $top: 1,
    ...(_select?.length ? { $select: _select } : {}),
  });
  if (!rows.length) throw new Error(`[spDataClient] Record not found: ${entitySet}/${id}`);
  return rows[0];
}

/**
 * Create a new record in the SP list. Mirrors dv.create().
 * The PK GUID must be in the payload (callers are responsible for generating it
 * via demoStore.generateId() or crypto.randomUUID()).
 */
export async function spCreate<T>(entitySet: string, payload: object): Promise<T> {
  const def = getSpListDef(entitySet);
  if (!def) throw new Error(`[spDataClient] No SP list def for '${entitySet}'`);
  const flat = flattenBindPayload(payload as Record<string, unknown>);
  // SP CreateRecord requires a 'Title' field.  Map the primaryKey value to Title
  // so the list item is identifiable in the SP UI.
  if (!flat['Title'] && flat[def.primaryKey]) {
    flat['Title'] = String(flat[def.primaryKey]);
  }
  const result = await spClient().createRecordAsync<Record<string, unknown>, Record<string, unknown>>(
    SP_DATA_SOURCE, flat,
  );
  if (!result.success) throw new Error(`[spDataClient] spCreate failed for ${entitySet}: ${String(result.error)}`);
  return addFormattedValues({ ...flat, ...result.data }) as unknown as T;
}

/**
 * Update (PATCH) an existing record. Mirrors dv.update().
 * Resolves the SP item integer ID from the Dataverse GUID first.
 */
export async function spUpdate(entitySet: string, id: string, payload: object): Promise<void> {
  const spItemId = await resolveSpItemId(entitySet, id);
  const flat = flattenBindPayload(payload as Record<string, unknown>);
  const result = await spClient().updateRecordAsync(SP_DATA_SOURCE, spItemId, flat);
  if (!result.success) throw new Error(`[spDataClient] spUpdate failed for ${entitySet}/${id}: ${String(result.error)}`);
}

/** Deactivate: sets statecode=1,statuscode=2.  Mirrors dv.deactivate(). */
export async function spDeactivate(entitySet: string, id: string): Promise<void> {
  return spUpdate(entitySet, id, { statecode: 1, statuscode: 2 });
}

/**
 * Delete a record by its Dataverse GUID. Mirrors dv.remove().
 * Resolves the SP item integer ID first.
 */
export async function spRemove(entitySet: string, id: string): Promise<void> {
  const spItemId = await resolveSpItemId(entitySet, id);
  const result = await spClient().deleteRecordAsync(SP_DATA_SOURCE, spItemId);
  if (!result.success) throw new Error(`[spDataClient] spRemove failed for ${entitySet}/${id}: ${String(result.error)}`);
}
