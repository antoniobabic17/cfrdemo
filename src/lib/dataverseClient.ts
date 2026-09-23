import { getClient } from '@microsoft/power-apps/data';
import type { IOperationOptions } from '@microsoft/power-apps/data';
// Generated connector data sources (Office 365 Users, SharePoint AppDocuments).
// MUST be merged into the object passed to getClient(): the SDK's
// PowerDataSourcesInfoProvider is a process-wide singleton initialized on the
// FIRST getClient() call, which is this module's. If the connector sources
// aren't included here, every connector call fails with "data source not found"
// regardless of what the generated services pass. See
// node_modules/@microsoft/power-apps/.../powerDataSourcesInfoProvider.js.
import { dataSourcesInfo as GENERATED_CONNECTOR_SOURCES } from '../../.power/schemas/appschemas/dataSourcesInfo';
import { applySharePointFileOps } from './sharePointFileOps';
import type { ODataParams } from '../models/common.model';
import { serializeError } from './utils';
import { isDemoModeActive } from './demoMode';

// Seeded demo system user (fixtures USER_1 "Alex Rivera"). Used as the actor id
// for actor-stamped writes when demo mode is on and no host identity exists.
const DEMO_ACTOR_ID = 'demo-user-1-0000-0000-000000000001';
import { withTimeout } from './withTimeout';
import {
  queryRecords, getRecord, addRecord, updateRecord, removeRecord,
  generateId, getPrimaryKey,
  handlePssCreate, handlePssUpdate, handlePssDelete,
  maybeCreateDemoProject,
} from './demoStore';
import { isSharePointDataActive } from './sharePointData';
import {
  spList, spGet, spCreate, spUpdate, spDeactivate, spRemove,
} from './sharePointDataClient';

function toError(sdkErr: unknown, fallback: string): Error {
  const msg = serializeError(sdkErr);
  return new Error(msg !== String(sdkErr) || msg ? msg : fallback);
}

// DataSourcesInfo tells the SDK's operation orchestrator which entity sets are Dataverse
// tables (vs. connector tables). The orchestrator reads `dataSourceType` to route each
// operation to the correct executor. Org URL and auth are resolved by the Dataverse executor
// from the Power Apps host (via power.config.json databaseReferences) at call time.
// Every entity set queried by this app must appear here AND in power.config.json.
// OWNERSHIP [HIGH-RISK]: Platform Domain Owner. New table registrations require a GitHub Issue.
// Do not modify DATAVERSE_SOURCES without coordinating. See CONTRIBUTING.md §Shared Files.
const DATAVERSE_SOURCES = {
  // CFR custom
  pmo_projectrequests:        { tableId: 'pmo_projectrequest',        dataSourceType: 'Dataverse', apis: {} },
  pmo_projectteams:           { tableId: 'pmo_projectteam',           dataSourceType: 'Dataverse', apis: {} },
  pmo_projectcollaborators:   { tableId: 'pmo_projectcollaborator',   dataSourceType: 'Dataverse', apis: {} },
  // P4W + Accelerator
  msdyn_projects: {
    tableId: 'msdyn_project',
    dataSourceType: 'Dataverse',
    apis: {
      msdyn_CreateOperationSetV1: {
        path: '/api/data/v9.2/msdyn_CreateOperationSetV1',
        method: 'POST',
        parameters: [
          { name: 'ProjectId',    in: 'body', required: true,  type: 'string' },
          { name: 'Description', in: 'body', required: false, type: 'string' },
        ],
      },
      msdyn_PssCreateV1: {
        path: '/api/data/v9.2/msdyn_PssCreateV1',
        method: 'POST',
        parameters: [
          { name: 'Entity',          in: 'body', required: true,  type: 'object' },
          { name: 'OperationSetId',  in: 'body', required: true,  type: 'string' },
        ],
      },
      msdyn_PssUpdateV1: {
        path: '/api/data/v9.2/msdyn_PssUpdateV1',
        method: 'POST',
        parameters: [
          { name: 'Entity',          in: 'body', required: true,  type: 'object' },
          { name: 'OperationSetId',  in: 'body', required: true,  type: 'string' },
        ],
      },
      msdyn_PssDeleteV1: {
        path: '/api/data/v9.2/msdyn_PssDeleteV1',
        method: 'POST',
        parameters: [
          { name: 'RecordId',              in: 'body', required: true,  type: 'string' },
          { name: 'EntityLogicalName',     in: 'body', required: true,  type: 'string' },
          { name: 'OperationSetId',        in: 'body', required: true,  type: 'string' },
        ],
      },
      msdyn_ExecuteOperationSetV1: {
        path: '/api/data/v9.2/msdyn_ExecuteOperationSetV1',
        method: 'POST',
        parameters: [
          { name: 'OperationSetId',  in: 'body', required: true,  type: 'string' },
        ],
      },
      msdyn_CreateTeamMemberV1: {
        path: '/api/data/v9.2/msdyn_CreateTeamMemberV1',
        method: 'POST',
        parameters: [
          { name: 'TeamMember', in: 'body', required: true, type: 'object' },
        ],
      },
      // Phase 1 hybrid security: contributing-team sharing. Grant/Revoke
      // are stock SDK messages; we expose them here so the React layer
      // can call them inline with pmo_projectteam mutations (see
      // app/src/api/projectTeams.api.ts and docs/security-model.md).
      GrantAccess: {
        path: '/api/data/v9.2/GrantAccess',
        method: 'POST',
        parameters: [
          { name: 'Target',          in: 'body', required: true, type: 'object' },
          { name: 'PrincipalAccess', in: 'body', required: true, type: 'object' },
        ],
      },
      RevokeAccess: {
        path: '/api/data/v9.2/RevokeAccess',
        method: 'POST',
        parameters: [
          { name: 'Target',  in: 'body', required: true, type: 'object' },
          { name: 'Revokee', in: 'body', required: true, type: 'object' },
        ],
      },
      pmo_FlushTaskStaging: {
        path: '/api/data/v9.2/pmo_FlushTaskStaging',
        method: 'POST',
        parameters: [
          { name: 'ProjectId',  in: 'body', required: true,  type: 'string' },
          { name: 'StagingIds', in: 'body', required: false, type: 'string' },
          { name: 'ForceRetry', in: 'body', required: false, type: 'boolean' },
        ],
      },
      pmo_UploadDocumentToSharePoint: {
        path: '/api/data/v9.2/pmo_UploadDocumentToSharePoint',
        method: 'POST',
        parameters: [
          { name: 'FileName',         in: 'body', required: true,  type: 'string' },
          { name: 'FileContent',      in: 'body', required: true,  type: 'string' },
          { name: 'RecordType',       in: 'body', required: false, type: 'string' },
          { name: 'RecordId',         in: 'body', required: false, type: 'string' },
          { name: 'RecordName',       in: 'body', required: false, type: 'string' },
          { name: 'DocumentCategory', in: 'body', required: false, type: 'string' },
          { name: 'ProjectId',        in: 'body', required: false, type: 'string' },
          { name: 'ProgramId',        in: 'body', required: false, type: 'string' },
          { name: 'IntakeId',         in: 'body', required: false, type: 'string' },
          { name: 'TaskId',           in: 'body', required: false, type: 'string' },
          // UserEmail removed: not declared by pmo_UploadDocumentToSharePoint in PROD.
        ],
      },
    },
  },
  msdyn_projectprograms:      { tableId: 'msdyn_projectprogram',      dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectstatusreports: { tableId: 'msdyn_projectstatusreport', dataSourceType: 'Dataverse', apis: {} },
  msdyn_projecttasks:             { tableId: 'msdyn_projecttask',            dataSourceType: 'Dataverse', apis: {} },
  msdyn_projecttaskdependencies:  { tableId: 'msdyn_projecttaskdependency', dataSourceType: 'Dataverse', apis: {} },
  msdyn_resourceassignments:      { tableId: 'msdyn_resourceassignment',     dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectbuckets:           { tableId: 'msdyn_projectbucket',          dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectteams:             { tableId: 'msdyn_projectteam',            dataSourceType: 'Dataverse', apis: {} },
  bookableresources:              { tableId: 'bookableresource',             dataSourceType: 'Dataverse', apis: {} },
  // P4W scheduling entities (spike discovery targets)
  msdyn_projectlabels:            { tableId: 'msdyn_projectlabel',           dataSourceType: 'Dataverse', apis: {} },
  msdyn_projecttasktolabels:      { tableId: 'msdyn_projecttasktolabel',     dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectchecklists:        { tableId: 'msdyn_projectchecklist',       dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectsprints:           { tableId: 'msdyn_projectsprint',          dataSourceType: 'Dataverse', apis: {} },
  // Dataverse OData metadata entity sets — used only in spike panel to discover schema
  RelationshipDefinitions:        { tableId: 'RelationshipDefinition',       dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectrisks:         { tableId: 'msdyn_projectrisk',         dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectissues:        { tableId: 'msdyn_projectissue',        dataSourceType: 'Dataverse', apis: {} },
  msdyn_projectchanges:       { tableId: 'msdyn_projectchange',       dataSourceType: 'Dataverse', apis: {} },
  // System
  organizations:              { tableId: 'organization',              dataSourceType: 'Dataverse', apis: {} },
  systemusers:                { tableId: 'systemuser',                dataSourceType: 'Dataverse', apis: {} },
  teams:                      { tableId: 'team',                     dataSourceType: 'Dataverse', apis: {} },
  msdyn_documentheaders:      { tableId: 'msdyn_documentheader',     dataSourceType: 'Dataverse', apis: {} },
  // Reference / master data
  cr87a_systems:              { tableId: 'cr87a_system',             dataSourceType: 'Dataverse', apis: {} },
  // Payer Initiatives feature pack — HPI (Health Plan Issue) numbers. Many msdyn_project rows roll up to one rcm_payerdeckissue via the pmo_payerinitiatives_hpiissue lookup (renamed from pmo_hpiissue to follow the pmo_<team>_<feature> convention; data migrated by scripts/rename-hpiissue-to-payerinitiatives-hpiissue.py).
  rcm_payerdeckissues:        { tableId: 'rcm_payerdeckissue',       dataSourceType: 'Dataverse', apis: {} },
  // Payer Initiatives feature pack — Payer Issues catalog (cr87a_payerissue).
  // The existing cr87a_projects lookup on this table points at the legacy
  // cr87a_projects entity (NOT msdyn_project). For new-intake projects the
  // app captures the user's intent in extras.payerIssueIds during the
  // wizard; actual relational binding awaits the schema decision (new
  // lookup to msdyn_project or N:N junction).
  cr87a_payerissues:          { tableId: 'cr87a_payerissue',         dataSourceType: 'Dataverse', apis: {} },
  annotations:                { tableId: 'annotation',               dataSourceType: 'Dataverse', apis: {} },
  pmo_userfeedbacks:           { tableId: 'pmo_userfeedback',          dataSourceType: 'Dataverse', apis: {} },
  pmo_appsettings:            { tableId: 'pmo_appsetting',           dataSourceType: 'Dataverse', apis: {} },
  pmo_projecttemplates:       { tableId: 'pmo_projecttemplate',      dataSourceType: 'Dataverse', apis: {} },
  pmo_projectgates:           { tableId: 'pmo_projectgate',          dataSourceType: 'Dataverse', apis: {} },
  pmo_projectgatedecisions:   { tableId: 'pmo_projectgatedecision',  dataSourceType: 'Dataverse', apis: {} },
  pmo_requiredartifacts:      { tableId: 'pmo_requiredartifact',     dataSourceType: 'Dataverse', apis: {} },
  pmo_projectartifactstatuses: { tableId: 'pmo_projectartifactstatus', dataSourceType: 'Dataverse', apis: {} },
  pmo_projectcloseouts:       { tableId: 'pmo_projectcloseout',      dataSourceType: 'Dataverse', apis: {} },
  pmo_notifications:          { tableId: 'pmo_notification',         dataSourceType: 'Dataverse', apis: {} },
  pmo_userviews:              { tableId: 'pmo_userview',             dataSourceType: 'Dataverse', apis: {} },
  pmo_tasktemplates:          { tableId: 'pmo_tasktemplate',         dataSourceType: 'Dataverse', apis: {} },
  pmo_telemetryevents:        { tableId: 'pmo_telemetryevent',       dataSourceType: 'Dataverse', apis: {} },
  pmo_taskstagings:           { tableId: 'pmo_taskstaging',          dataSourceType: 'Dataverse', apis: {} },
  // Option-C custom tables (pmo_task / pmo_bucket) -- read path shipped in
  // Phase 3, write path in Phase 4. Same native-CDS binding as every other
  // Dataverse table here; auth resolves from the Power Apps host.
  pmo_tasks:                  { tableId: 'pmo_task',                 dataSourceType: 'Dataverse', apis: {} },
  pmo_buckets:                { tableId: 'pmo_bucket',               dataSourceType: 'Dataverse', apis: {} },
  // Stage 2 (2026-07-31): net-new custom project table. Same-GUID dual-key with
  // msdyn_project; the app writes a shell msdyn_project at create-time so child
  // lookups resolve. See docs/pss-decoupling-c-design.md + plan.md Stage 2.
  pmo_projects:               { tableId: 'pmo_project',              dataSourceType: 'Dataverse', apis: {} },
  // Stage 3 (2026-07-31): net-new custom program table (same-GUID shell with msdyn_projectprogram).
  pmo_programs:               { tableId: 'pmo_program',              dataSourceType: 'Dataverse', apis: {} },
  // Tier 2 decoupling (2026-08-13): custom Monitor twins. MUST be registered here
  // AND in power.config.json databaseReferences or the runtime throws
  // "Data source not found: pmo_projectrisks". Read/written only in custom mode.
  pmo_projectrisks:           { tableId: 'pmo_projectrisk',          dataSourceType: 'Dataverse', apis: {} },
  pmo_projectissues:          { tableId: 'pmo_projectissue',         dataSourceType: 'Dataverse', apis: {} },
  pmo_projectchanges:         { tableId: 'pmo_projectchange',        dataSourceType: 'Dataverse', apis: {} },
  pmo_projectstatusreports:   { tableId: 'pmo_projectstatusreport',  dataSourceType: 'Dataverse', apis: {} },
  pmo_taskassignments:        { tableId: 'pmo_taskassignment',       dataSourceType: 'Dataverse', apis: {} },
  pmo_checklists:             { tableId: 'pmo_checklist',            dataSourceType: 'Dataverse', apis: {} },
  // UAT Manager (spec 001, 2026-08-29). Every one of these MUST also appear in
  // power.config.json databaseReferences or the runtime throws at call time --
  // "Data source not found: No Dataverse data source found for table: ...".
  // Entity set names are read from the platform, never derived: see
  // app/src/features/uat/lib/uatDataSources.ts, which is generated from DEV and
  // cross-checked against this map by uatDataSources.test.ts.
  pmo_uattemplates:           { tableId: 'pmo_uattemplate',          dataSourceType: 'Dataverse', apis: {} },
  pmo_uattemplatequestions:   { tableId: 'pmo_uattemplatequestion',  dataSourceType: 'Dataverse', apis: {} },
  pmo_uatrequirements:        { tableId: 'pmo_uatrequirement',       dataSourceType: 'Dataverse', apis: {} },
  pmo_uattestcases:           { tableId: 'pmo_uattestcase',          dataSourceType: 'Dataverse', apis: {} },
  pmo_uatcoveragelinks:       { tableId: 'pmo_uatcoveragelink',      dataSourceType: 'Dataverse', apis: {} },
  pmo_uattags:                { tableId: 'pmo_uattag',               dataSourceType: 'Dataverse', apis: {} },
  pmo_uattaglinks:            { tableId: 'pmo_uattaglink',           dataSourceType: 'Dataverse', apis: {} },
  pmo_uatcycles:              { tableId: 'pmo_uatcycle',             dataSourceType: 'Dataverse', apis: {} },
  pmo_uattestruns:            { tableId: 'pmo_uattestrun',           dataSourceType: 'Dataverse', apis: {} },
  pmo_uattestrunanswers:      { tableId: 'pmo_uattestrunanswer',     dataSourceType: 'Dataverse', apis: {} },
  pmo_uatdefects:             { tableId: 'pmo_uatdefect',            dataSourceType: 'Dataverse', apis: {} },
  pmo_uatattachments:         { tableId: 'pmo_uatattachment',        dataSourceType: 'Dataverse', apis: {} },
  pmo_uatprojectsettings:     { tableId: 'pmo_uatprojectsetting',    dataSourceType: 'Dataverse', apis: {} },
  // pmo_uatimportbatchs, NOT ...batches. Dataverse appends 's' rather than
  // applying English pluralization; the English spelling 404s at runtime.
  pmo_uatimportbatchs:        { tableId: 'pmo_uatimportbatch',       dataSourceType: 'Dataverse', apis: {} },
  pmo_uatimportrows:          { tableId: 'pmo_uatimportrow',         dataSourceType: 'Dataverse', apis: {} },
  pmo_tasktolabels:           { tableId: 'pmo_tasktolabel',          dataSourceType: 'Dataverse', apis: {} },
  pmo_projectdecisions:       { tableId: 'pmo_projectdecision',      dataSourceType: 'Dataverse', apis: {} },
  pmo_projectmeetinglinks:    { tableId: 'pmo_projectmeetinglink',   dataSourceType: 'Dataverse', apis: {} },
  pmo_projectbaselines:       { tableId: 'pmo_projectbaseline',      dataSourceType: 'Dataverse', apis: {} },
  pmo_gatesettemplates:       { tableId: 'pmo_gatesettemplate',      dataSourceType: 'Dataverse', apis: {} },
  pmo_gatesetitems:           { tableId: 'pmo_gatesetitem',          dataSourceType: 'Dataverse', apis: {} },
  roles:                      { tableId: 'role',                     dataSourceType: 'Dataverse', apis: {} },
  // Polymorphic cross-team tracking tags. Global CRUD on all CFR PMO roles so any
  // user can tag any record regardless of project team-sharing (see pmo_tracking).
  pmo_trackings:              { tableId: 'pmo_tracking',             dataSourceType: 'Dataverse', apis: {} },
  // Per-project cost ledger line items (Financial projects). Global CRUD on all
  // CFR PMO roles so any user on a shared project can add cost items.
  pmo_costledgeritems:        { tableId: 'pmo_costledgeritem',       dataSourceType: 'Dataverse', apis: {} },
};

// Returns a DataClient backed by the Power Apps runtime bridge.
// The SDK resolves auth, org URL, and CORS through the host MessageChannel —
// no window.__powerAppsContext injection required.
// Merge Dataverse + generated connector sources ONCE. The provider singleton
// locks on the first getClient() argument, so this combined object must carry
// every source the app uses (Dataverse tables + connectors).
export const ALL_SOURCES = applySharePointFileOps(
  // Deep-ish clone of the connector sources so we can inject the SharePoint file
  // actions (CreateFile / GetFileContentByPath) the generator omits, without
  // mutating the imported generated object.
  { ...structuredClone(GENERATED_CONNECTOR_SOURCES), ...DATAVERSE_SOURCES },
);

function client() {
  return getClient(ALL_SOURCES);
}

function toSdkOptions(params: ODataParams): IOperationOptions {
  const opts: IOperationOptions = {};
  if (params.$select?.length) opts.select = params.$select;
  if (params.$filter) opts.filter = params.$filter;
  if (params.$orderby) opts.orderBy = params.$orderby.split(',').map((s) => s.trim());
  if (params.$top !== undefined) opts.top = params.$top;
  return opts;
}

/** List records with optional OData query params.
 *
 * PAGES THROUGH ALL RESULTS. Dataverse caps a single response at 500 rows and
 * returns a `skipToken` for the next page. Previously we returned only the first
 * page, so a table with >500 active rows (e.g. PROD pmo_projects after the
 * migration) silently truncated — the grid capped at 500 AND client-side-derived
 * filters (e.g. the Team dropdown, built from the loaded rows) only saw whatever
 * teams fell in that first page. We now follow `skipToken` until it's empty and
 * concatenate every page.
 *
 * If the caller passes an explicit `$top`, we honor it as a hard cap and stop once
 * that many rows are collected (a bounded, intentional limit — not the accidental
 * 500 truncation).
 */
export async function list<T>(entitySetName: string, params: ODataParams = {}): Promise<T[]> {
  if (isDemoModeActive()) return queryRecords<T>(entitySetName, params);
  if (isSharePointDataActive(entitySetName)) return spList<T>(entitySetName, params);
  const hardCap = params.$top;
  const baseOptions = toSdkOptions(params);
  const all: T[] = [];
  let skipToken: string | undefined;
  // Guard against a pathological non-terminating skipToken loop.
  for (let page = 0; page < 1000; page++) {
    const result = await withTimeout(
      client().retrieveMultipleRecordsAsync<T>(
        entitySetName,
        skipToken ? { ...baseOptions, skipToken } : baseOptions,
      ),
      `dv.list(${entitySetName})`,
    );
    if (!result.success) throw toError(result.error, 'Dataverse list failed.');
    if (result.data?.length) all.push(...result.data);
    if (hardCap !== undefined && all.length >= hardCap) return all.slice(0, hardCap);
    skipToken = result.skipToken || undefined;
    if (!skipToken) break;
  }
  return all;
}

/**
 * Cap for a dynamic $select column count. The Power Apps host gateway truncates
 * an over-long OData URL with error 0x80060888; a curated list plus a bounded
 * number of view-driven columns stays safely under it. Visible-only unions keep
 * this small in practice; the cap is the hard safety valve.
 */
export const MAX_SELECT_COLUMNS = 60;

/**
 * Build a bounded $select: the curated base columns plus any extra (view-driven)
 * keys, deduped and capped at MAX_SELECT_COLUMNS. Base columns always win the
 * budget; extras fill the remainder in order. Keys already in base are free.
 * Any FormattedValue annotation keys are dropped (never valid in $select).
 */
export function boundedSelect(base: string[], extra: string[] = []): string[] {
  const clean = (k: string) => k && !k.includes('@OData');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of base) {
    if (clean(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const k of extra) {
    if (out.length >= MAX_SELECT_COLUMNS) break;
    if (clean(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/**
 * Fetch records by a set of ids in one logical call. OData has no native IN, so
 * ids are chunked into `or`-chained $filter clauses (~50/request to stay under
 * URL limits) and the pages concatenated. Mirrors listNotesForTasks. Used by the
 * lookup-aspect resolver to pull a chosen sub-field (e.g. email) from a lookup
 * target table keyed by the ids collected across the current page.
 */
export async function listByIds<T>(
  entitySetName: string,
  idField: string,
  ids: string[],
  select: string[],
): Promise<T[]> {
  const uniq = Array.from(new Set(ids.filter(Boolean).map((i) => i.replace(/[{}]/g, '').toLowerCase())));
  if (uniq.length === 0) return [];
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const orClause = chunk.map((id) => `${idField} eq ${id}`).join(' or ');
      return list<T>(entitySetName, { $select: select, $filter: `(${orClause})` });
    }),
  );
  return results.flat();
}

/** Get a single record by ID. */
export async function get<T>(entitySetName: string, id: string, select?: string[]): Promise<T> {
  if (isSharePointDataActive(entitySetName)) return spGet<T>(entitySetName, id, select);
  if (isDemoModeActive()) {
    const found = getRecord<T>(entitySetName, id);
    if (found) return found;
  }
  const result = await withTimeout(
    client().retrieveRecordAsync<T>(
      entitySetName,
      id,
      select?.length ? { select } : undefined,
    ),
    `dv.get(${entitySetName}/${id})`,
  );
  if (!result.success) throw toError(result.error, 'Dataverse get failed.');
  return result.data;
}

/** Create a new record. Returns the created record with server-generated fields. */
export async function create<T>(entitySetName: string, payload: object): Promise<T> {
  if (isSharePointDataActive(entitySetName)) return spCreate<T>(entitySetName, payload);
  if (isDemoModeActive()) {
    const pk = getPrimaryKey(entitySetName);
    // Dataverse defaults annotation.isdocument=false for text notes; stamp it
    // explicitly so listProjectNotes' filter (isdocument eq false) matches.
    // File-upload annotations set documentbody (isdocument implied true) --
    // only default to false when the caller hasn't set isdocument at all.
    const annotationDefaults =
      entitySetName === 'annotations' && !Object.prototype.hasOwnProperty.call(payload, 'isdocument')
        ? { isdocument: false }
        : {};
    const record = { [pk]: generateId(), createdon: new Date().toISOString(), statecode: 0, ...annotationDefaults, ...(payload as object) };
    addRecord(entitySetName, record as Record<string, unknown>);
    return record as T;
  }
  const result = await withTimeout(
    client().createRecordAsync<object, T>(entitySetName, payload),
    `dv.create(${entitySetName})`,
  );
  if (!result.success) throw toError(result.error, 'Dataverse create failed.');
  return result.data;
}

/** Update an existing record (PATCH — partial update). */
export async function update(entitySetName: string, id: string, payload: object): Promise<void> {
  if (isSharePointDataActive(entitySetName)) return spUpdate(entitySetName, id, payload);
  if (isDemoModeActive()) {
    maybeCreateDemoProject(entitySetName, id, payload as Record<string, unknown>);
    updateRecord(entitySetName, id, payload as Record<string, unknown>);
    return;
  }
  const result = await withTimeout(
    client().updateRecordAsync(entitySetName, id, payload),
    `dv.update(${entitySetName}/${id})`,
  );
  if (!result.success) throw toError(result.error, 'Dataverse update failed.');
}

/** Deactivate a record by setting statecode=1, statuscode=2. */
export async function deactivate(entitySetName: string, id: string): Promise<void> {
  if (isSharePointDataActive(entitySetName)) return spDeactivate(entitySetName, id);
  return update(entitySetName, id, { statecode: 1, statuscode: 2 });
}

/** Hard-delete a record by ID. */
export async function remove(entitySetName: string, id: string): Promise<void> {
  if (isSharePointDataActive(entitySetName)) return spRemove(entitySetName, id);
  if (isDemoModeActive()) {
    removeRecord(entitySetName, id);
    return;
  }
  const result = await withTimeout(
    client().deleteRecordAsync(entitySetName, id),
    `dv.remove(${entitySetName}/${id})`,
  );
  if (!result.success) throw toError(result.error, 'Dataverse delete failed.');
}

/**
 * Associate two records over an N:N relationship.
 *
 * Dataverse N:N membership (teammembership_association, systemuserroles_association,
 * etc.) isn't a normal Create — you must use the SDK's associate/disassociate
 * operations. Code Apps SDKs expose these via `associateRecordsAsync` at runtime
 * even when the published type definitions don't surface them.
 */
export async function associate(
  fromEntitySet: string,
  fromId: string,
  relationship: string,
  toEntitySet: string,
  toId: string,
): Promise<void> {
  if (isDemoModeActive()) return;
  const c = client() as unknown as {
    associateRecordsAsync?: (params: {
      entityName: string;
      recordId: string;
      relationship: string;
      relatedEntityName: string;
      relatedRecordId: string;
    }) => Promise<{ success: boolean; error?: unknown }>;
  };
  if (!c.associateRecordsAsync) {
    throw new Error(
      'Associate not supported by this SDK build. Use the Power Platform admin portal to manage this relationship.',
    );
  }
  const result = await withTimeout(
    c.associateRecordsAsync({
      entityName: fromEntitySet,
      recordId: fromId,
      relationship,
      relatedEntityName: toEntitySet,
      relatedRecordId: toId,
    }),
    `dv.associate(${fromEntitySet}/${fromId} <-> ${toEntitySet}/${toId})`,
  );
  if (!result.success) throw toError(result.error, 'Associate failed.');
}

// ── Record-level access sharing ──────────────────────────────────────────────
//
// Dataverse access control has two layers: privilege (granted by role at User/
// BU/Global scope) and record-level grants (per-record share with specific
// principals at specific access masks). The CFR PMO Team role intentionally
// grants Read at Global but defers Writes to ownership + record sharing —
// these helpers are the sharing half.
//
// AccessRights is a comma-separated string of any of: ReadAccess, WriteAccess,
// AppendAccess, AppendToAccess, CreateAccess, DeleteAccess, ShareAccess,
// AssignAccess. For "team can collaborate on this project" the typical mask
// is "ReadAccess, WriteAccess, AppendAccess, AppendToAccess".

export interface AccessTarget {
  /** OData entity-set name, e.g. 'msdyn_projects'. */
  entitySet: string;
  /** PK GUID. */
  recordId: string;
  /** Singular logical name, e.g. 'msdyn_project'. Used to build @odata.type. */
  logicalName: string;
}

export interface AccessPrincipal {
  /** OData entity-set name of the principal — 'teams' or 'systemusers'. */
  entitySet: 'teams' | 'systemusers';
  /** Principal record GUID. */
  recordId: string;
  /** Logical name — 'team' or 'systemuser'. */
  logicalName: 'team' | 'systemuser';
}

export type AccessMask = string; // e.g. 'ReadAccess, WriteAccess, AppendAccess, AppendToAccess'

interface AccessApi {
  grantAccessAsync?: (params: {
    target: { entityName: string; recordId: string };
    principalAccess: { principal: { entityName: string; recordId: string }; accessMask: string };
  }) => Promise<{ success: boolean; error?: unknown }>;
  modifyAccessAsync?: (params: {
    target: { entityName: string; recordId: string };
    principalAccess: { principal: { entityName: string; recordId: string }; accessMask: string };
  }) => Promise<{ success: boolean; error?: unknown }>;
  revokeAccessAsync?: (params: {
    target: { entityName: string; recordId: string };
    revokee: { entityName: string; recordId: string };
  }) => Promise<{ success: boolean; error?: unknown }>;
  retrievePrincipalAccessAsync?: (params: {
    target: { entityName: string; recordId: string };
    principal: { entityName: string; recordId: string };
  }) => Promise<{ success: boolean; data?: { accessMask: string }; error?: unknown }>;
  retrieveSharedPrincipalsAndAccessAsync?: (params: {
    target: { entityName: string; recordId: string };
  }) => Promise<{ success: boolean; data?: Array<{ principal: { entityName: string; recordId: string }; accessMask: string }>; error?: unknown }>;
}

function accessClient(): AccessApi {
  return client() as unknown as AccessApi;
}

/** Grant `accessMask` on the target to the principal. Idempotent at the
 *  Dataverse API level — calling Grant when the principal already has some
 *  access is permitted; combine with modifyAccess() if you want to overwrite. */
export async function grantAccess(target: AccessTarget, principal: AccessPrincipal, accessMask: AccessMask): Promise<void> {
  if (isDemoModeActive()) return;
  const c = accessClient();
  if (!c.grantAccessAsync) {
    throw new Error('grantAccess not supported by this SDK build.');
  }
  const result = await c.grantAccessAsync({
    target: { entityName: target.logicalName, recordId: target.recordId },
    principalAccess: {
      principal: { entityName: principal.logicalName, recordId: principal.recordId },
      accessMask,
    },
  });
  if (!result.success) throw toError(result.error, 'Grant access failed.');
}

/** Change an existing share to a new access mask. Use after a principal
 *  already has SOME access on the target — Dataverse requires Modify (not
 *  another Grant) to widen/narrow the mask. */
export async function modifyAccess(target: AccessTarget, principal: AccessPrincipal, accessMask: AccessMask): Promise<void> {
  if (isDemoModeActive()) return;
  const c = accessClient();
  if (!c.modifyAccessAsync) {
    throw new Error('modifyAccess not supported by this SDK build.');
  }
  const result = await c.modifyAccessAsync({
    target: { entityName: target.logicalName, recordId: target.recordId },
    principalAccess: {
      principal: { entityName: principal.logicalName, recordId: principal.recordId },
      accessMask,
    },
  });
  if (!result.success) throw toError(result.error, 'Modify access failed.');
}

/** Remove all shared access from the principal on the target. Owner access
 *  and role-based privileges are unaffected. */
export async function revokeAccess(target: AccessTarget, principal: AccessPrincipal): Promise<void> {
  if (isDemoModeActive()) return;
  const c = accessClient();
  if (!c.revokeAccessAsync) {
    throw new Error('revokeAccess not supported by this SDK build.');
  }
  const result = await c.revokeAccessAsync({
    target: { entityName: target.logicalName, recordId: target.recordId },
    revokee: { entityName: principal.logicalName, recordId: principal.recordId },
  });
  if (!result.success) throw toError(result.error, 'Revoke access failed.');
}

/** All principals currently sharing the target record, with their access
 *  masks. Useful for "what needs to change" reconciliation. */
export async function retrieveSharedPrincipals(target: AccessTarget): Promise<Array<{
  principal: { entityName: string; recordId: string };
  accessMask: string;
}>> {
  if (isDemoModeActive()) return [];
  const c = accessClient();
  if (!c.retrieveSharedPrincipalsAndAccessAsync) {
    throw new Error('retrieveSharedPrincipalsAndAccess not supported by this SDK build.');
  }
  const result = await c.retrieveSharedPrincipalsAndAccessAsync({
    target: { entityName: target.logicalName, recordId: target.recordId },
  });
  if (!result.success) throw toError(result.error, 'Retrieve shared principals failed.');
  return result.data ?? [];
}

/** Disassociate two records over an N:N relationship. Sibling of associate(). */
export async function disassociate(
  fromEntitySet: string,
  fromId: string,
  relationship: string,
  toEntitySet: string,
  toId: string,
): Promise<void> {
  if (isDemoModeActive()) return;
  const c = client() as unknown as {
    disassociateRecordsAsync?: (params: {
      entityName: string;
      recordId: string;
      relationship: string;
      relatedEntityName: string;
      relatedRecordId: string;
    }) => Promise<{ success: boolean; error?: unknown }>;
  };
  if (!c.disassociateRecordsAsync) {
    throw new Error(
      'Disassociate not supported by this SDK build. Use the Power Platform admin portal to manage this relationship.',
    );
  }
  const result = await c.disassociateRecordsAsync({
    entityName: fromEntitySet,
    recordId: fromId,
    relationship,
    relatedEntityName: toEntitySet,
    relatedRecordId: toId,
  });
  if (!result.success) throw toError(result.error, 'Disassociate failed.');
}

/**
 * Invoke an unbound Dataverse custom action via the SDK bridge.
 *
 * The `tableName` param identifies the data source used to resolve the
 * Dataverse environment connection — use any entity set name registered in
 * DATAVERSE_SOURCES (e.g. 'msdyn_projects'). The SDK resolves auth and org
 * URL from the Power Apps host the same way as standard CRUD calls.
 *
 * Used by schedulingClient.ts for Project Operations scheduling actions
 * (msdyn_CreateOperationSetV1, msdyn_PssCreateV1, etc.) that are not
 * accessible via standard OData CRUD.
 */
export async function executeAction<TRequest, TResult>(
  tableName: string,
  operationName: string,
  body?: TRequest,
): Promise<TResult> {
  if (isDemoModeActive()) {
    const b = (body ?? {}) as Record<string, unknown>;
    let fakeResult: Record<string, unknown> = {};
    switch (operationName) {
      case 'msdyn_CreateOperationSetV1':
        fakeResult = { OperationSetId: generateId() };
        break;
      case 'msdyn_PssCreateV1':
        fakeResult = handlePssCreate(b);
        break;
      case 'msdyn_PssUpdateV1':
        fakeResult = handlePssUpdate(b);
        break;
      case 'msdyn_PssDeleteV1':
        fakeResult = handlePssDelete(b);
        break;
      case 'msdyn_ExecuteOperationSetV1':
        fakeResult = { OperationSetId: b.OperationSetId, name: 'Succeeded', percentComplete: 100 };
        break;
      case 'msdyn_CreateTeamMemberV1':
        fakeResult = { TeamMemberId: generateId() };
        break;
      case 'GrantAccess':
      case 'RevokeAccess':
        // No-op in demo mode — sharing isn't simulated.
        fakeResult = {};
        break;
    }
    return fakeResult as TResult;
  }
  const result = await client().executeAsync<TRequest, TResult>({
    dataverseRequest: {
      action: 'customapi',
      parameters: { operationName, tableName, body },
    },
  });
  if (!result.success) throw toError(result.error, `Action ${operationName} failed`);
  return result.data;
}

/**
 * Raw attribute-metadata row as returned by the getEntityMetadata action's
 * expanded Attributes collection. Only the fields columnDiscovery needs are
 * typed; the platform returns many more.
 */
export interface DataverseAttributeMetadata {
  LogicalName: string;
  AttributeType?: number | string;
  AttributeOf?: string | null;
  IsValidForRead?: boolean;
  DisplayName?: { UserLocalizedLabel?: { Label?: string } | null; LocalizedLabels?: { Label?: string }[] } | null;
  /** For Lookup/Customer/Owner attributes: the referenced entity logical name(s). */
  Targets?: string[] | null;
}

/**
 * Retrieve Dataverse ATTRIBUTE METADATA for a table via the SDK's native
 * `getEntityMetadata` action (executeAsync -> dataverseRequest). This is the
 * ONLY metadata path that routes through the Code Apps bridge: the host resolves
 * `entitySet` -> logicalName from the registered database references, then builds
 * `EntityDefinitions(LogicalName=...)?$select=LogicalName&$expand=Attributes`
 * itself and returns the EntityDefinition object. A raw retrieveMultiple against
 * an `EntityDefinitions(...)/Attributes` path string does NOT work in Code Apps
 * (which is why the old columnDiscovery returned zero columns for every table).
 *
 * `entitySet` MUST be a registered Dataverse source key (entity-SET name, e.g.
 * `msdyn_projects`) present in DATAVERSE_SOURCES + power.config.json - NOT a raw
 * logical name and NOT a path. Unknown sources throw DataSourceNotFound.
 * Used by lib/columnDiscovery.ts for the admin "Re-pull columns" flow.
 */
export async function retrieveEntityAttributes(entitySet: string): Promise<DataverseAttributeMetadata[]> {
  if (isDemoModeActive()) return [];
  const result = await withTimeout(
    client().executeAsync<unknown, { Attributes?: DataverseAttributeMetadata[] }>({
      dataverseRequest: {
        action: 'getEntityMetadata',
        parameters: {
          tableName: entitySet,
          options: {
            metadata: ['LogicalName'],
            schema: { columns: 'all' },
          },
        },
      },
    } as never),
    `dv.metadata(${entitySet})`,
  );
  if (!result.success) throw toError(result.error, `Metadata query failed for ${entitySet}`);
  return result.data?.Attributes ?? [];
}

/** Get the Dataverse organization ID (used for Planner deep link construction). */
export async function getOrganizationId(): Promise<string> {
  const result = await client().retrieveMultipleRecordsAsync<{ organizationid: string }>(
    'organizations',
    { select: ['organizationid'] },
  );
  if (!result.success) throw toError(result.error, 'Organizations query failed.');
  const org = result.data[0];
  if (!org) throw new Error('No organization record found.');
  return org.organizationid;
}

/** Returns the current Power Apps user's system user GUID.
 *  Reads from the Xrm host context when available (model-driven app host).
 *  Falls back to 'anonymous' if the host context is not accessible. */
export function getCurrentUserId(): string {
  try {
    type XrmGlobal = { Xrm?: { Utility?: { getGlobalContext?: () => { getUserId?: () => string } } } };
    const xrm = (window as unknown as XrmGlobal).Xrm;
    const raw = xrm?.Utility?.getGlobalContext?.()?.getUserId?.();
    if (raw) return raw.replace(/[{}]/g, '').toLowerCase();
  } catch {
    // Not running inside an Xrm host (dev mode, testing)
  }
  return 'anonymous';
}

// ─── Async user-id resolution (Power Apps Code App hosting) ──────────────────
//
// `getCurrentUserId()` above only works in model-driven hosts (window.Xrm).
// Power Apps Code Apps don't inject Xrm, so it always returns 'anonymous'
// here. This async resolver uses @microsoft/power-apps/app context to read
// the AAD object id, then looks up the matching systemuser row in Dataverse.
// Same pattern as ConfigurationProvider.resolveAdminRole and
// sharePointClient.getCurrentUserEmail.
//
// Result is cached in a module-scope promise so concurrent callers share
// one network round-trip and subsequent calls are synchronous reads.

let cachedUserIdPromise: Promise<string | null> | null = null;

/**
 * Returns the current user's Dataverse systemuserid (lowercased, no braces),
 * or null if it can't be resolved (dev mode, host without context, etc.).
 *
 * Resolution order:
 *   1. window.Xrm if present (model-driven host)
 *   2. Power Apps SDK context → AAD objectId → systemusers query
 *   3. null
 */
export function resolveCurrentUserId(): Promise<string | null> {
  if (cachedUserIdPromise) return cachedUserIdPromise;
  cachedUserIdPromise = (async (): Promise<string | null> => {
    // Demo mode: no host bridge. getContext() never settles on a static host, so
    // the try/catch below does NOT protect us (it hangs, it never throws). Return
    // the seeded demo system user so any actor-stamped write resolves instantly.
    if (isDemoModeActive()) return DEMO_ACTOR_ID;

    // Try the synchronous Xrm path first.
    const xrmId = getCurrentUserId();
    if (xrmId !== 'anonymous') return xrmId;

    // Fall back to the Power Apps SDK context.
    try {
      const { getContext } = await import('./powerAppsContext');
      const ctx = await getContext();
      const aadObjectId = (ctx.user as Record<string, unknown> | undefined)?.objectId as
        | string
        | undefined;
      if (!aadObjectId) return null;
      const users = await list<{ systemuserid: string }>('systemusers', {
        $select: ['systemuserid'],
        $filter: `azureactivedirectoryobjectid eq '${aadObjectId}'`,
      });
      const id = users[0]?.systemuserid ?? null;
      return id ? id.toLowerCase() : null;
    } catch {
      return null;
    }
  })();
  return cachedUserIdPromise;
}
