/**
 * demoStore v2 — the in-memory data engine behind Demo Mode.
 *
 * Seeded from DEMO_FIXTURES, mutated freely by the app's create/update/delete
 * paths, and queried with real OData semantics via demoFilter. NOTHING here ever
 * touches the network — this is the entire "backend" when demo mode is active.
 *
 * Session-only: the store is a module-level object. A page reload re-imports this
 * module fresh, so the baseline returns. `resetDemoStore()` re-seeds without a
 * reload (used by the "Reset demo data" control).
 *
 * Exports preserve the surface dataverseClient imports:
 *   listRecords, getRecord, addRecord, updateRecord, removeRecord,
 *   generateId, getPrimaryKey, handlePssCreate/Update/Delete, maybeCreateDemoProject
 * plus new query-aware helpers (queryRecords) and resetDemoStore.
 */
import { DEMO_FIXTURES } from '../fixtures/demoData';
import { CHOICE_LABELS, CHOICE_LABELS_BY_ENTITY } from '../fixtures/demoChoiceLabels';
import { applyQuery, type AnyResolver } from './demoFilter';

import type { ODataParams } from '../models/common.model';

type Rec = Record<string, unknown>;

// ─── Primary key field per entity set ────────────────────────────────────────
const PRIMARY_KEYS: Record<string, string> = {
  pmo_projectrequests:          'pmo_projectrequestid',
  msdyn_projects:               'msdyn_projectid',
  msdyn_projectbuckets:         'msdyn_projectbucketid',
  msdyn_projecttasks:           'msdyn_projecttaskid',
  msdyn_projectrisks:           'msdyn_projectriskid',
  msdyn_projectissues:          'msdyn_projectissueid',
  msdyn_projectchanges:         'msdyn_projectchangeid',
  msdyn_projectstatusreports:   'msdyn_projectstatusreportid',
  msdyn_projectprograms:        'msdyn_projectprogramid',
  pmo_projectteams:             'pmo_projectteamid',
  pmo_projectcollaborators:     'pmo_projectcollaboratorid',
  pmo_projectdecisions:         'pmo_projectdecisionid',
  teams:                        'teamid',
  systemusers:                  'systemuserid',
  pmo_userfeedbacks:            'pmo_userfeedbackid',
  pmo_appsettings:              'pmo_appsettingid',
  pmo_notifications:            'pmo_notificationid',
  pmo_trackings:                'pmo_trackingid',
  pmo_taskassignments:          'pmo_taskassignmentid',
  pmo_checklists:               'pmo_checklistid',
  pmo_tasktolabels:             'pmo_tasktolabelid',
  pmo_gatesettemplates:         'pmo_gatesettemplateid',
  pmo_gatesetitems:             'pmo_gatesetitemid',
  // custom source
  pmo_projects:                 'pmo_projectid',
  pmo_programs:                 'pmo_programid',
  pmo_tasks:                    'pmo_taskid',
  pmo_buckets:                  'pmo_bucketid',
  pmo_projectrisks:             'pmo_projectriskid',
  pmo_projectissues:            'pmo_projectissueid',
  pmo_projectchanges:           'pmo_projectchangeid',
  pmo_projectstatusreports:     'pmo_projectstatusreportid',
};

export function getPrimaryKey(entitySet: string): string {
  return PRIMARY_KEYS[entitySet] ?? `${entitySet.slice(0, -1)}id`;
}

// ─── @odata.type → entity set / id field (PSS create/update) ─────────────────
const ODATA_TYPE_TO_SET: Record<string, string> = {
  'Microsoft.Dynamics.CRM.msdyn_projecttask':   'msdyn_projecttasks',
  'Microsoft.Dynamics.CRM.msdyn_projectbucket': 'msdyn_projectbuckets',
  'Microsoft.Dynamics.CRM.msdyn_projectrisk':   'msdyn_projectrisks',
};
const ODATA_TYPE_TO_ID: Record<string, string> = {
  'Microsoft.Dynamics.CRM.msdyn_projecttask':   'msdyn_projecttaskid',
  'Microsoft.Dynamics.CRM.msdyn_projectbucket': 'msdyn_projectbucketid',
  'Microsoft.Dynamics.CRM.msdyn_projectrisk':   'msdyn_projectriskid',
};

// ─── Primary-name field per entity set (for FormattedValue synthesis) ─────────
const NAME_FIELDS: Record<string, string> = {
  msdyn_projects: 'msdyn_subject',
  pmo_projects: 'pmo_name',
  msdyn_projectprograms: 'msdyn_name',
  pmo_programs: 'pmo_name',
  teams: 'name',
  systemusers: 'fullname',
  pmo_projectrequests: 'pmo_name',
  msdyn_projecttasks: 'msdyn_subject',
  pmo_tasks: 'pmo_name',
  msdyn_projectbuckets: 'msdyn_name',
  pmo_buckets: 'pmo_name',
};

// ─── In-memory store (deep-cloned from fixtures) ─────────────────────────────
let store: Record<string, Rec[]> = {};
// Team membership relation: which users belong to which teams. Seeded from
// fixtures' optional `_demoMembership` export shape; otherwise empty.
let membership: Array<{ teamid: string; systemuserid: string }> = [];

function clone<T>(v: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

function ensureSet(entitySet: string): Rec[] {
  if (!store[entitySet]) {
    store[entitySet] = ((DEMO_FIXTURES[entitySet] as Rec[] | undefined) ?? []).map((r) => clone(r));
  }
  return store[entitySet];
}

/** Re-seed the entire store from fixtures (no reload). */
export function resetDemoStore(): void {
  store = {};
  const seed = (DEMO_FIXTURES['_membership'] as Array<{ teamid: string; systemuserid: string }> | undefined) ?? [];
  membership = clone(seed);
}

/**
 * The demo app-settings array extracted from fixtures. Exposed so callers
 * (DemoModeSection) can prime the data-source + file-source module caches
 * synchronously on toggle, without creating a circular import by having
 * demoStore import taskSource/fileSource (both of which transitively import
 * dataverseClient, which imports demoStore).
 */
export const DEMO_SETTINGS = DEMO_FIXTURES['pmo_appsettings'] as Array<{ pmo_key: string | null; pmo_value: string | null }>;

// Initialize membership on first module load.
resetDemoStore();

// ─── Team-membership resolver for demoFilter any() clauses ───────────────────
// Handles both directions of the systemuser⇄team N:N used by the app:
//   users where teammembership_association/any(t: t/teamid eq 'X')
//   (and the rarer team-scoped form).
const anyResolver: AnyResolver = (record, navField) => {
  if (navField === 'teammembership_association') {
    const uid = (record.systemuserid as string | undefined)?.toLowerCase();
    if (uid) {
      return membership
        .filter((m) => m.systemuserid.toLowerCase() === uid)
        .map((m) => ({ teamid: m.teamid, systemuserid: m.systemuserid }));
    }
    const tid = (record.teamid as string | undefined)?.toLowerCase();
    if (tid) {
      return membership
        .filter((m) => m.teamid.toLowerCase() === tid)
        .map((m) => ({ teamid: m.teamid, systemuserid: m.systemuserid }));
    }
  }
  if (navField === 'teamroles_association' || navField === 'systemuserroles_association') {
    // Role membership isn't modeled in demo; return empty so role-gated queries
    // simply match nothing (admin short-circuit in ConfigurationProvider covers the
    // "am I admin" path separately).
    return [];
  }
  // Unknown nav: if the record carries an inline array, use it.
  const inline = record[navField];
  return Array.isArray(inline) ? (inline as Rec[]) : [];
};

// ─── Lookup FormattedValue synthesis ─────────────────────────────────────────
// For each `_x_value` field on a record, if there's no matching
// `_x_value@OData...FormattedValue`, try to resolve the target record's name.
// We can't know the target entity set from the field name alone, so we search a
// small set of likely sets. Cheap in-memory scan; demo data is tiny.
const LOOKUP_TARGET_SETS = [
  'msdyn_projects', 'pmo_projects', 'msdyn_projectprograms', 'pmo_programs',
  'teams', 'systemusers', 'pmo_projectrequests', 'msdyn_projecttasks',
  'pmo_tasks', 'msdyn_projectbuckets', 'pmo_buckets',
];
const FV_SUFFIX = '@OData.Community.Display.V1.FormattedValue';

function resolveNameForId(id: string): string | undefined {
  for (const set of LOOKUP_TARGET_SETS) {
    // ensureSet (not store[set]) so a lookup target is lazily seeded on demand.
    // Otherwise, querying an entity whose lookup points at a not-yet-loaded set
    // (e.g. reading pmo_taskassignments before systemusers) skips the target and
    // the FormattedValue (assignee name) never resolves.
    const rows = ensureSet(set);
    if (!rows.length) continue;
    const pk = getPrimaryKey(set);
    const hit = rows.find((r) => String(r[pk]).toLowerCase() === id.toLowerCase());
    if (hit) {
      const nameField = NAME_FIELDS[set];
      const name = nameField ? hit[nameField] : undefined;
      if (name != null) return String(name);
    }
  }
  return undefined;
}

function synthesizeLookupLabels(rec: Rec): Rec {
  const out = { ...rec };
  for (const [k, v] of Object.entries(rec)) {
    const m = /^_(.+)_value$/.exec(k);
    if (!m || v == null) continue;
    const fvKey = `${k}${FV_SUFFIX}`;
    if (out[fvKey] != null) continue; // already labeled
    const name = resolveNameForId(String(v));
    if (name !== undefined) out[fvKey] = name;
  }
  return out;
}

// ─── Choice-label FormattedValue synthesis ───────────────────────────────────
// Real Dataverse returns choice labels via `<field>@OData...FormattedValue`.
// Fixtures store only the integer code; we stamp the label on read from the
// CHOICE_LABELS registry so grids render "On Track"/"Planning"/… not `—`.
// Per-entity overrides (CHOICE_LABELS_BY_ENTITY) win where the same column name
// means different enums on different tables (e.g. pmo_status).
function synthesizeChoiceLabels(rec: Rec, entitySet: string): Rec {
  const out = { ...rec };
  for (const [k, v] of Object.entries(rec)) {
    if (v == null || typeof v !== 'number') continue;
    if (k.includes('@OData')) continue;
    const fvKey = `${k}${FV_SUFFIX}`;
    if (out[fvKey] != null) continue; // already labeled (explicit fixture value)
    const map = CHOICE_LABELS_BY_ENTITY[`${entitySet}.${k}`] ?? CHOICE_LABELS[k];
    if (!map) continue;
    const label = map[v];
    if (label !== undefined) out[fvKey] = label;
  }
  return out;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Query records honoring $filter/$orderby/$top (+ synthesized lookup + choice labels). */
export function queryRecords<T>(entitySet: string, params?: ODataParams): T[] {
  const rows = ensureSet(entitySet).map((r) =>
    synthesizeChoiceLabels(synthesizeLookupLabels(r), entitySet),
  );
  const filtered = applyQuery(rows, params, anyResolver);
  return filtered as T[];
}

/** Back-compat: unfiltered list. Prefer queryRecords. */
export function listRecords<T>(entitySet: string, params?: ODataParams): T[] {
  return queryRecords<T>(entitySet, params);
}

export function getRecord<T>(entitySet: string, id: string): T | undefined {
  const pk = getPrimaryKey(entitySet);
  const found = ensureSet(entitySet).find((r) => String(r[pk]).toLowerCase() === id.toLowerCase());
  return found ? (synthesizeChoiceLabels(synthesizeLookupLabels(found), entitySet) as T) : undefined;
}

// ─── Writes ────────────────────────────────────────────────────────────────────

/** Resolve `nav@odata.bind` binds into `_nav_value` fields.
 *
 * Standard bind:  `pmo_Team@odata.bind` = `/teams(guid)`
 *   → `_pmo_team_value` = `guid`
 *
 * Note/annotation polymorphic bind: `objectid_<logicalName>@odata.bind` = `/entitySets(guid)`
 *   → `_objectid_value` = `guid`, `objecttypecode` = `<logicalName>`
 *   The UI filters annotations by `_objectid_value` + `objecttypecode` so both
 *   must be stored for a demo-created note to be found.
 */
function resolveBinds(input: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === '@odata.type') continue;
    if (k.endsWith('@odata.bind')) {
      const base = k.replace('@odata.bind', '');
      const match = String(v).match(/\(([^)]+)\)$/);
      const resolvedId = match ? match[1] : String(v);
      // Detect the polymorphic objectid_<logicalName>@odata.bind pattern used by
      // the notes API. Map it to _objectid_value + objecttypecode.
      const noteMatch = /^objectid_([a-z0-9_]+)$/i.exec(base);
      if (noteMatch) {
        out['_objectid_value'] = resolvedId;
        out['objecttypecode'] = noteMatch[1];
      } else {
        out[`_${base.toLowerCase()}_value`] = resolvedId;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function nextSeq(entitySet: string): number {
  const records = ensureSet(entitySet);
  return records.length + 1;
}

export function addRecord(entitySet: string, record: Rec): void {
  const resolved = resolveBinds(record);
  // Auto-generate autonumber fields if the record doesn't already have them.
  if (entitySet === 'pmo_projectrequests' && !resolved.pmo_autonumber) {
    const year = new Date().getFullYear();
    resolved.pmo_autonumber = `REQ-${year}-${String(nextSeq(entitySet)).padStart(4, '0')}`;
  }
  if ((entitySet === 'msdyn_projects' || entitySet === 'pmo_projects') && !resolved.pmo_projectnumber) {
    resolved.pmo_projectnumber = `PROJ-${String(nextSeq(entitySet)).padStart(5, '0')}`;
  }
  ensureSet(entitySet).push(resolved);
}

export function updateRecord(entitySet: string, id: string, patch: Rec): void {
  const pk = getPrimaryKey(entitySet);
  const records = ensureSet(entitySet);
  const idx = records.findIndex((r) => String(r[pk]).toLowerCase() === id.toLowerCase());
  if (idx >= 0) records[idx] = { ...records[idx], ...resolveBinds(patch) };
}

export function removeRecord(entitySet: string, id: string): void {
  const pk = getPrimaryKey(entitySet);
  const records = ensureSet(entitySet);
  const idx = records.findIndex((r) => String(r[pk]).toLowerCase() === id.toLowerCase());
  if (idx >= 0) records.splice(idx, 1);
}

// ─── Fake ID generation (valid GUID shape) ───────────────────────────────────
function hex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
export function generateId(): string {
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((8 + Math.floor(Math.random() * 4)).toString(16))}${hex(3)}-${hex(12)}`;
}

// ─── PSS interceptors ────────────────────────────────────────────────────────
function pssResult(body: Rec): Rec {
  return { OperationSetId: body.OperationSetId, OperationId: generateId(), Result: 'Success' };
}

export function handlePssCreate(body: Rec): Rec {
  const entity = (body.Entity ?? {}) as Rec;
  const odataType = entity['@odata.type'] as string | undefined;
  if (!odataType) return {};
  const entitySet = ODATA_TYPE_TO_SET[odataType];
  const idField = ODATA_TYPE_TO_ID[odataType];
  if (!entitySet || !idField) return {};
  const newId = generateId();
  const resolved = resolveBinds(entity);
  addRecord(entitySet, { [idField]: newId, createdon: new Date().toISOString(), statecode: 0, ...resolved });
  return pssResult(body);
}

export function handlePssUpdate(body: Rec): Rec {
  const entity = (body.Entity ?? {}) as Rec;
  const odataType = entity['@odata.type'] as string | undefined;
  if (!odataType) return {};
  const entitySet = ODATA_TYPE_TO_SET[odataType];
  const idField = ODATA_TYPE_TO_ID[odataType];
  if (!entitySet || !idField) return {};
  const id = entity[idField] as string | undefined;
  if (!id) return {};
  const { [idField]: _omit, ...rest } = entity;
  void _omit;
  updateRecord(entitySet, id, rest as Rec);
  return pssResult(body);
}

export function handlePssDelete(body: Rec): Rec {
  const logicalName = body.EntityLogicalName as string | undefined;
  const recordId = body.RecordId as string | undefined;
  if (!logicalName || !recordId) return {};
  removeRecord(`${logicalName}s`, recordId);
  return pssResult(body);
}

// ─── Approval → auto-create project or program (both PSS + custom sources) ───
const APPROVED_STATUS = 893460023;
const CONVERSION_TARGET_PROGRAM = 893460221;

export function maybeCreateDemoProgram(entitySet: string, id: string, patch: Rec): void {
  if (entitySet !== 'pmo_projectrequests') return;
  if (patch.pmo_status !== APPROVED_STATUS) return;
  const request = getRecord<Rec>('pmo_projectrequests', id);
  if (!request) return;
  if (request.pmo_conversiontarget !== CONVERSION_TARGET_PROGRAM) return;

  const programId = generateId();
  const now = new Date().toISOString();
  addRecord('msdyn_projectprograms', {
    msdyn_projectprogramid: programId,
    msdyn_name: String(request.pmo_name ?? 'Demo Program'),
    msdyn_description: request.pmo_description ?? '',
    statecode: 0,
    createdon: now,
    modifiedon: now,
  });
  addRecord('pmo_programs', {
    pmo_programid: programId,
    pmo_name: String(request.pmo_name ?? 'Demo Program'),
    pmo_description: request.pmo_description ?? '',
    statecode: 0,
    createdon: now,
    modifiedon: now,
  });
  updateRecord('pmo_projectrequests', id, {
    '_pmo_convertedprogram_value': programId,
    [`_pmo_convertedprogram_value${FV_SUFFIX}`]: String(request.pmo_name ?? 'Demo Program'),
    pmo_converteddate: now,
    pmo_status: APPROVED_STATUS,
    [`pmo_status${FV_SUFFIX}`]: 'Approved',
  });
}

export function maybeCreateDemoProject(entitySet: string, id: string, patch: Rec): void {
  if (entitySet !== 'pmo_projectrequests') return;
  if (patch.pmo_status !== APPROVED_STATUS) return;
  const request = getRecord<Rec>('pmo_projectrequests', id);
  if (!request) return;
  // Program-type requests are handled by maybeCreateDemoProgram.
  if (request.pmo_conversiontarget === CONVERSION_TARGET_PROGRAM) return;

  const projectId = generateId();
  const now = new Date().toISOString();
  const projectFields: Rec = {
    msdyn_subject: String(request.pmo_name ?? 'Demo Project'),
    msdyn_description: request.pmo_description ?? '',
    msdyn_scheduledstart: request.pmo_requestedstartdate ?? now.slice(0, 10),
    msdyn_finish: request.pmo_targetcompletiondate ?? '',
    msdyn_progress: 0,
    proj_stage: 192350001,
    'proj_stage@OData.Community.Display.V1.FormattedValue': 'Planning',
    proj_state: 0,
    'proj_state@OData.Community.Display.V1.FormattedValue': 'Active',
    proj_overallhealth: 189330000,
    'proj_overallhealth@OData.Community.Display.V1.FormattedValue': 'On Track',
    statecode: 0,
    createdon: now,
    modifiedon: now,
  };

  // PSS shell
  addRecord('msdyn_projects', { msdyn_projectid: projectId, ...projectFields });
  // Custom-source twin (same GUID contract) so custom-source hooks see it too.
  addRecord('pmo_projects', {
    pmo_projectid: projectId,
    pmo_name: projectFields.msdyn_subject,
    pmo_description: projectFields.msdyn_description,
    statecode: 0, createdon: now, modifiedon: now,
  });

  updateRecord('pmo_projectrequests', id, {
    '_pmo_convertedproject_value': projectId,
    [`_pmo_convertedproject_value${FV_SUFFIX}`]: String(request.pmo_name ?? 'Demo Project'),
    pmo_converteddate: now,
    pmo_status: APPROVED_STATUS,
    [`pmo_status${FV_SUFFIX}`]: 'Approved',
  });
}
