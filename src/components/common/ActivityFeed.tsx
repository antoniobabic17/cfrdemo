/**
 * ActivityFeed — reusable change-history row renderer.
 *
 * Wave 3 of the user-action change history. Lifts the natural-language row
 * UI out of /admin/change-history so it can be embedded as an "Activity" tab
 * on individual Project and Program detail pages.
 *
 * Scope rules:
 *   - { kind: 'project', projectId }  — events tagged with this project's
 *     pmo_Project lookup. Covers project-level edits AND every task event
 *     (tasks set parentProjectId on their audit row).
 *   - { kind: 'program', programId, childProjectIds } — program-level events
 *     filtered by entityId in payload, PLUS rollup of child-project events
 *     via the same pmo_Project lookup. Pass the program's child projectIds.
 *   - { kind: 'all' } — admin page mode, returns everything.
 *
 * Rendering identical to ChangeHistoryPage so the same row format shows up
 * everywhere. Search/tabs are NOT included here — those live in the admin
 * page; embedded feeds are read-only timelines.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  FolderKanban,
  Layers,
  CheckSquare,
  Plus,
  Trash2,
  Pencil,
  Search,
} from 'lucide-react';
import { ErrorBanner } from './ErrorBanner';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import type { ChangeAuditEntry } from '../../hooks/useChangeAudit';

// ── Types ────────────────────────────────────────────────────────────────────

interface RawChangeEvent {
  pmo_telemetryeventid: string;
  pmo_eventtype: string;
  pmo_source?: string;
  pmo_payload: string;
  createdon?: string;
  '_pmo_project_value'?: string;
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  [key: string]: unknown;
}

interface EntityPayload {
  entityType: 'project' | 'program' | 'task';
  entityId: string;
  entityName: string;
  action: 'create' | 'update' | 'delete';
  changes?: ChangeAuditEntry[];
  parentProjectId?: string;
  parentProjectName?: string;
  /** Explicit actor stamped by useChangeAudit when the row's _createdby_value doesn't reflect the real human (e.g. PSS/service-context writes). Prefer over _createdby_value when present. */
  actorUserId?: string;
  actorFullName?: string;
}

export type ActivityFeedScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'program'; programId: string; childProjectIds: string[] };

// ── Data hook ────────────────────────────────────────────────────────────────

/**
 * Build the OData $filter for a given scope.
 * Project scope: every audit row that bound to this project (project edits
 *                + all of its tasks).
 * Program scope: program-level rows whose payload entityId is the program,
 *                OR rows bound to any of the program's child projects.
 *                Implemented as two filters joined with `or`.
 */
function buildFilter(scope: ActivityFeedScope): string {
  const baseEvent = "pmo_eventtype eq 'EntityChange' and statecode eq 0";
  if (scope.kind === 'project') {
    // Match by payload, not the pmo_Project lookup. Audit rows no longer
    // set that lookup (it required AppendTo on the PSS msdyn_project shell,
    // which blocked custom-source PMO members — see useChangeAudit). The
    // project id lives in the JSON payload as `entityId` (project rows) or
    // `parentProjectId` (task rows); contains() catches both. Same-GUID
    // design means this id is identical across pmo_project + msdyn shell,
    // so legacy rows that DID set the lookup still match too.
    return `(${baseEvent}) and contains(pmo_payload, '${scope.projectId}')`;
  }
  // Program scope. The program-level rows have NO pmo_Project binding, so
  // we match them by source AND payload contains the program guid (cheapest
  // approximation OData supports without parsing JSON server-side: use
  // contains() on the JSON blob).
  const childIds = scope.childProjectIds.filter(Boolean);
  const projectClauses = childIds.map((pid) => `contains(pmo_payload, '${pid}')`).join(' or ');
  const programClause = `pmo_source eq 'program' and contains(pmo_payload, '${scope.programId}')`;
  const inner = projectClauses ? `(${projectClauses}) or (${programClause})` : `(${programClause})`;
  return `(${baseEvent}) and (${inner})`;
}

function useScopedActivityFeed(scope: ActivityFeedScope) {
  // Only react-query key elements that change should land in the key. For
  // program scope we hash the child-id list to keep the cache key stable.
  const cacheKey =
    scope.kind === 'project'
      ? ['activityFeed', 'project', scope.projectId]
      : ['activityFeed', 'program', scope.programId, scope.childProjectIds.slice().sort().join(',')];

  return useQuery<RawChangeEvent[]>({
    queryKey: cacheKey,
    queryFn: () =>
      dv.list<RawChangeEvent>(ENTITY_SETS.telemetryEvent, {
        $select: [
          'pmo_telemetryeventid',
          'pmo_eventtype',
          'pmo_source',
          'pmo_payload',
          'createdon',
          '_createdby_value',
          '_pmo_project_value',
        ],
        $filter: buildFilter(scope),
        $orderby: 'createdon desc',
        $top: 200,
      }),
    // Same auto-refresh story as ChangeHistoryPage — useChangeAudit invalidates
    // ['activityFeed'] after every successful write, so this short staleTime is
    // just a backstop for window-focus / route-remount refreshes.
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
    // Skip program-scope fetches that have neither a programId match path
    // nor any child projects — would return empty anyway.
    enabled:
      scope.kind === 'project'
        ? !!scope.projectId
        : !!scope.programId || scope.childProjectIds.length > 0,
  });
}

// ── Formatting helpers (mirrors ChangeHistoryPage) ───────────────────────────

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function safeParse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function renderValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
      }
    }
    return value;
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}

function entityIconColor(t: 'project' | 'program' | 'task') {
  if (t === 'program') return 'text-violet-700 bg-violet-100';
  if (t === 'project') return 'text-blue-700 bg-blue-100';
  return 'text-emerald-700 bg-emerald-100';
}

function actionVerb(action: 'create' | 'update' | 'delete'): string {
  if (action === 'create') return 'created';
  if (action === 'delete') return 'deleted';
  return 'modified';
}
function entityNoun(t: 'project' | 'program' | 'task'): string {
  return t;
}

function changeOneLine(entry: ChangeAuditEntry): string {
  if (entry.kind === 'field') return `modified ${entry.label.toLowerCase()}`;
  if (entry.action === 'add') return `added ${entry.relation} ${entry.label}`;
  if (entry.action === 'remove') return `removed ${entry.relation} ${entry.label}`;
  return `updated ${entry.relation} ${entry.label}`;
}

// ── Row + detail components ──────────────────────────────────────────────────

function ChangeEntryLine({ entry }: { entry: ChangeAuditEntry }) {
  if (entry.kind === 'field') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <Pencil className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <span className="font-medium text-foreground">{entry.label}</span>
          <span className="text-muted-foreground"> changed from </span>
          <span className="font-mono text-foreground">{renderValue(entry.old)}</span>
          <span className="text-muted-foreground"> to </span>
          <span className="font-mono text-foreground">{renderValue(entry.new)}</span>
        </div>
      </div>
    );
  }
  const verb = entry.action === 'add' ? 'Added' : entry.action === 'remove' ? 'Removed' : 'Updated';
  const iconCls = "h-3 w-3 text-muted-foreground mt-0.5 shrink-0";
  return (
    <div className="flex items-start gap-2 text-xs">
      {entry.action === 'add' ? <Plus className={iconCls} /> :
       entry.action === 'remove' ? <Trash2 className={iconCls} /> :
       <Pencil className={iconCls} />}
      <div className="min-w-0">
        <span className="text-muted-foreground">{verb} {entry.relation} </span>
        <span className="font-medium text-foreground">{entry.label}</span>
        {entry.old !== undefined && entry.new !== undefined && (
          <>
            <span className="text-muted-foreground"> ({renderValue(entry.old)} → </span>
            <span className="text-foreground">{renderValue(entry.new)}</span>
            <span className="text-muted-foreground">)</span>
          </>
        )}
      </div>
    </div>
  );
}

function EntityChangeDetail({ payload, changedBy }: { payload: EntityPayload; changedBy: string }) {
  return (
    <div className="px-6 pb-4 bg-muted/20 border-t space-y-3">
      <div className="pt-3 space-y-1.5">
        {payload.action === 'update' && payload.changes && payload.changes.length > 0 ? (
          payload.changes.map((c, i) => <ChangeEntryLine key={i} entry={c} />)
        ) : payload.action === 'create' ? (
          <p className="text-xs text-muted-foreground">
            Created with name <span className="font-medium text-foreground">"{payload.entityName}"</span>.
          </p>
        ) : payload.action === 'delete' ? (
          <p className="text-xs text-muted-foreground">
            Deleted <span className="font-medium text-foreground">"{payload.entityName}"</span>.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/50">
        <span><span className="font-medium">By:</span> {changedBy}</span>
        {payload.parentProjectName && (
          <span><span className="font-medium">Project:</span> {payload.parentProjectName}</span>
        )}
        <span>
          <span className="font-medium">Entity ID:</span>{' '}
          <span className="font-mono">{payload.entityId.slice(0, 8)}…</span>
        </span>
      </div>
    </div>
  );
}

/** Render the entity-type icon. Switching directly on the literal lets the
 *  static-components lint rule see real component identifiers in JSX
 *  (rather than a dynamic `const Icon = ...` indirection it flags). */
function EntityIcon({ entityType, className }: { entityType: 'project' | 'program' | 'task'; className?: string }) {
  if (entityType === 'program') return <Layers className={className} />;
  if (entityType === 'project') return <FolderKanban className={className} />;
  return <CheckSquare className={className} />;
}

function ChangeRow({ event }: { event: RawChangeEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isEntity = event.pmo_eventtype === 'EntityChange';
  const payload = isEntity ? safeParse<EntityPayload>(event.pmo_payload) : null;
  // Prefer the actor stamped into the payload -- covers PSS/service-context
  // writes where _createdby_value on the telemetry row lands on the running
  // admin (backfills) or on 'Project, Microsoft' (direct-PSS legacy path).
  const changedBy =
    payload?.actorFullName
    ?? (event['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined)
    ?? '—';

  // The activity feed only renders entity rows. Admin rows are filtered out
  // by buildFilter() server-side, but if any slip through (e.g. legacy data)
  // skip them rather than crash the row renderer.
  if (!payload) return null;

  const iconColor = entityIconColor(payload.entityType);
  const verb = actionVerb(payload.action);
  const noun = entityNoun(payload.entityType);

  let summary: React.ReactNode;
  if (payload.action === 'update') {
    const count = payload.changes?.length ?? 0;
    const label =
      count === 0 ? 'made changes'
      : count === 1 ? changeOneLine(payload.changes![0])
      : `made ${count} changes`;
    summary = (
      <>
        <span className="font-medium text-foreground">{changedBy}</span>{' '}
        <span className="text-muted-foreground">{label} on {noun}</span>{' '}
        <span className="font-medium text-foreground">"{payload.entityName}"</span>
      </>
    );
  } else {
    summary = (
      <>
        <span className="font-medium text-foreground">{changedBy}</span>{' '}
        <span className="text-muted-foreground">{verb} {noun}</span>{' '}
        <span className="font-medium text-foreground">"{payload.entityName}"</span>
      </>
    );
  }

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md shrink-0', iconColor)}>
          <EntityIcon entityType={payload.entityType} className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{summary}</p>
          {payload.entityType === 'task' && payload.parentProjectName && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              in project "{payload.parentProjectName}"
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-right shrink-0 tabular-nums">
          {formatTimestamp(event.createdon)}
        </p>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && <EntityChangeDetail payload={payload} changedBy={changedBy} />}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

interface Props {
  scope: ActivityFeedScope;
  /** Optional empty-state message override (defaults to a generic line). */
  emptyMessage?: string;
  /** Optional cap on rendered rows. Server already $top=200; this is purely
   *  client-side trimming for tiny embedded feeds. */
  limit?: number;
  /** Optional client-side filter by entity type. When set, only events whose
   *  payload.entityType is in this list are rendered. Lets the program
   *  Activity tab render side-by-side level columns (Program / Projects /
   *  Tasks) without firing extra Dataverse queries. */
  entityTypeFilter?: ReadonlyArray<'project' | 'program' | 'task'>;
  /** When true, render a search input above the timeline. Filter matches
   *  changed-by name, entity name, action verb, and field-change content
   *  in the payload. Default false — keeps embedded program-tab views
   *  unchanged. */
  searchable?: boolean;
  /** Placeholder for the search input. Ignored when searchable is false. */
  searchPlaceholder?: string;
}

/** Build a single lowercase haystack from an event so search matches across
 *  every visible piece of information without parsing JSON twice. */
function buildSearchHaystack(event: RawChangeEvent): string {
  const parts: string[] = [];
  const changedBy = event['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined;
  if (changedBy) parts.push(changedBy);
  const payload = safeParse<EntityPayload>(event.pmo_payload);
  if (payload) {
    if (payload.actorFullName) parts.push(payload.actorFullName);
    parts.push(payload.entityName ?? '');
    parts.push(payload.entityType);
    parts.push(payload.action);
    parts.push(actionVerb(payload.action));
    if (payload.parentProjectName) parts.push(payload.parentProjectName);
    if (payload.changes) {
      for (const c of payload.changes) {
        if (c.kind === 'field') {
          parts.push(c.label);
          parts.push(renderValue(c.old));
          parts.push(renderValue(c.new));
        } else {
          parts.push(c.relation);
          parts.push(c.label);
        }
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

export function ActivityFeed({
  scope,
  emptyMessage,
  limit,
  entityTypeFilter,
  searchable,
  searchPlaceholder,
}: Props) {
  const { data: events = [], isLoading, error } = useScopedActivityFeed(scope);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!entityTypeFilter || entityTypeFilter.length === 0) return events;
    const allowed = new Set(entityTypeFilter);
    return events.filter((e) => {
      const payload = safeParse<EntityPayload>(e.pmo_payload);
      return payload != null && allowed.has(payload.entityType);
    });
  }, [events, entityTypeFilter]);

  const searched = useMemo(() => {
    if (!searchable) return filtered;
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((e) => buildSearchHaystack(e).includes(q));
  }, [filtered, search, searchable]);

  const visible = useMemo(() => (limit ? searched.slice(0, limit) : searched), [searched, limit]);

  return (
    <div className="space-y-3">
      <ErrorBanner error={error as Error | null} />

      {searchable && (
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder ?? 'Search activity…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {isLoading ? 'loading…' : `${visible.length} of ${filtered.length}`}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading activity…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center">
          <History className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">
            {searchable && search.trim() ? 'No activity matches your search' : 'No activity yet'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {searchable && search.trim()
              ? 'Try a different search term, or clear the box to see everything.'
              : (emptyMessage ?? 'Edits made by your team will appear here.')}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y overflow-hidden">
          {visible.map((e) => (
            <ChangeRow key={e.pmo_telemetryeventid} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Re-exported icon for callers that want to label their tab consistently. */
export { History as ActivityFeedIcon };
