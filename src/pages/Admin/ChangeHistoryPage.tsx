/**
 * Change History page.
 *
 * Wave 1 (audit capture) introduced two pmo_eventtype values:
 *   - 'AdminChange'  : admin setting writes (existing)
 *   - 'EntityChange' : user actions on programs / projects / tasks
 *
 * This page is the unified surface for both. Rows render as natural-language
 * lines like "Antonio modified Start date on task X — May 13, 4:32 PM" and
 * expand to show every field-or-relationship change inside that row.
 *
 * The query fetches both event types in a single OData call (one IN clause,
 * one $top, one $orderby) so the feed is a true unified timeline. Filter tabs
 * subset client-side to keep the UX snappy after the initial fetch.
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
  ShieldAlert,
  AlertCircle,
  GitPullRequest,
  FileText,
  Settings,
  Plus,
  Trash2,
  Pencil,
  Inbox,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Input } from '../../components/ui/input';
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
  '_createdby_value'?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
  [key: string]: unknown;
}

interface AdminPayload {
  settingKey?: string;
  oldValue?: string | null;
  newValue?: string;
}

interface EntityPayload {
  entityType: 'project' | 'program' | 'task' | 'risk' | 'issue' | 'change' | 'statusreport' | 'intake';
  entityId: string;
  entityName: string;
  action: 'create' | 'update' | 'delete' | 'submit' | 'approve' | 'sendback' | 'reject';
  changes?: ChangeAuditEntry[];
  parentProjectId?: string;
  parentProjectName?: string;
}

// ── Data hook ────────────────────────────────────────────────────────────────

function useChangeHistory() {
  return useQuery<RawChangeEvent[]>({
    queryKey: ['changeHistory', 'unified'],
    queryFn: () =>
      dv.list<RawChangeEvent>(ENTITY_SETS.telemetryEvent, {
        $select: [
          'pmo_telemetryeventid',
          'pmo_eventtype',
          'pmo_source',
          'pmo_payload',
          'createdon',
          '_createdby_value',
        ],
        // Both event types in a single fetch — one timeline.
        $filter:
          "(pmo_eventtype eq 'AdminChange' or pmo_eventtype eq 'EntityChange') and statecode eq 0",
        $orderby: 'createdon desc',
        $top: 500,
      }),
    // Audit-write side calls qc.invalidateQueries(['changeHistory']) on every
    // successful row, so cached results are kicked the moment a new event
    // lands. Keep a small staleTime as a backstop for tab-switch refreshes.
    staleTime: 5 * 1000,
    refetchOnWindowFocus: true,
    retry: 0,
  });
}

// ── Formatting helpers ───────────────────────────────────────────────────────

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

function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Render any JSON-ish value as a human-readable string. Booleans show
 *  Yes/No, dates show short date, numbers show as-is, null/undefined as —. */
function renderValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Looks like an ISO date? Show short date.
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

// ── Row presentation ─────────────────────────────────────────────────────────

interface RowMeta {
  /** Top-level icon for the row's category. */
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  /** One-line summary rendered next to the icon. */
  summary: React.ReactNode;
  /** Optional sub-line shown under the summary (e.g. project name for tasks). */
  context?: string;
}

function entityIcon(t: EntityPayload['entityType']) {
  if (t === 'program') return Layers;
  if (t === 'project') return FolderKanban;
  if (t === 'risk') return ShieldAlert;
  if (t === 'issue') return AlertCircle;
  if (t === 'change') return GitPullRequest;
  if (t === 'statusreport') return FileText;
  if (t === 'intake') return Inbox;
  return CheckSquare;
}
function entityIconColor(t: EntityPayload['entityType']) {
  if (t === 'program') return 'text-violet-700 bg-violet-100';
  if (t === 'project') return 'text-blue-700 bg-blue-100';
  if (t === 'risk') return 'text-rose-700 bg-rose-100';
  if (t === 'issue') return 'text-amber-700 bg-amber-100';
  if (t === 'change') return 'text-cyan-700 bg-cyan-100';
  if (t === 'statusreport') return 'text-slate-700 bg-slate-100';
  if (t === 'intake') return 'text-indigo-700 bg-indigo-100';
  return 'text-emerald-700 bg-emerald-100';
}

function actionVerb(action: EntityPayload['action']): string {
  if (action === 'create')   return 'created';
  if (action === 'delete')   return 'deleted';
  if (action === 'submit')   return 'submitted';
  if (action === 'approve')  return 'approved';
  if (action === 'sendback') return 'sent back';
  if (action === 'reject')   return 'rejected';
  return 'modified';
}

function entityNoun(t: EntityPayload['entityType']): string {
  if (t === 'program') return 'program';
  if (t === 'project') return 'project';
  if (t === 'risk') return 'risk';
  if (t === 'issue') return 'issue';
  if (t === 'change') return 'change request';
  if (t === 'statusreport') return 'status report';
  if (t === 'intake') return 'intake request';
  return 'task';
}

function summarizeEntityRow(payload: EntityPayload, changedBy: string): RowMeta {
  const Icon = entityIcon(payload.entityType);
  const iconColor = entityIconColor(payload.entityType);
  const verb = actionVerb(payload.action);
  const noun = entityNoun(payload.entityType);

  let summary: React.ReactNode;
  if (payload.action === 'update') {
    const count = payload.changes?.length ?? 0;
    const label =
      count === 0
        ? `made changes`
        : count === 1
          ? changeOneLine(payload.changes![0])
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
  return {
    icon: Icon,
    iconColor,
    summary,
    context:
      payload.entityType === 'task' && payload.parentProjectName
        ? `in project "${payload.parentProjectName}"`
        : undefined,
  };
}

function summarizeAdminRow(event: RawChangeEvent, changedBy: string): RowMeta {
  const payload = safeParse<AdminPayload>(event.pmo_payload) ?? {};
  const settingKey = event.pmo_source ?? payload.settingKey ?? 'Unknown setting';
  return {
    icon: Settings,
    iconColor: 'text-amber-700 bg-amber-100',
    summary: (
      <>
        <span className="font-medium text-foreground">{changedBy}</span>{' '}
        <span className="text-muted-foreground">changed admin setting</span>{' '}
        <span className="font-mono text-foreground">{settingKey}</span>
      </>
    ),
  };
}

/** One-line description for a single ChangeAuditEntry (used when a row has
 *  exactly one change so we can show it inline rather than "made 1 change"). */
function changeOneLine(entry: ChangeAuditEntry): string {
  if (entry.kind === 'field') {
    return `modified ${entry.label.toLowerCase()}`;
  }
  // Completion toggle is its own semantic event; render the label
  // directly so the timeline reads "marked complete" or "reopened"
  // instead of the noisy "updated completion marked complete" that
  // the generic relationship formatter would produce.
  if (entry.relation === 'completion') {
    return entry.label;
  }
  if (entry.action === 'add') return `added ${entry.relation} ${entry.label}`;
  if (entry.action === 'remove') return `removed ${entry.relation} ${entry.label}`;
  return `updated ${entry.relation} ${entry.label}`;
}

// ── Expanded detail blocks ───────────────────────────────────────────────────

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
        ) : (payload.action === 'submit' || payload.action === 'approve' || payload.action === 'sendback' || payload.action === 'reject') ? (
          // Lifecycle actions render any attached `changes` (rationale text,
          // clarification question, status transitions) as field lines.
          payload.changes && payload.changes.length > 0 ? (
            payload.changes.map((c, i) => <ChangeEntryLine key={i} entry={c} />)
          ) : (
            <p className="text-xs text-muted-foreground">
              {actionVerb(payload.action).charAt(0).toUpperCase() + actionVerb(payload.action).slice(1)}{' '}
              <span className="font-medium text-foreground">"{payload.entityName}"</span>.
            </p>
          )
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/50">
        <span><span className="font-medium">By:</span> {changedBy}</span>
        {payload.parentProjectName && (
          <span>
            <span className="font-medium">Project:</span> {payload.parentProjectName}
          </span>
        )}
        <span>
          <span className="font-medium">Entity ID:</span>{' '}
          <span className="font-mono">{payload.entityId.slice(0, 8)}…</span>
        </span>
      </div>
    </div>
  );
}

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
  // Relationship change.
  const Icon = entry.action === 'add' ? Plus : entry.action === 'remove' ? Trash2 : Pencil;
  const verb = entry.action === 'add' ? 'Added' : entry.action === 'remove' ? 'Removed' : 'Updated';
  // Completion toggle -- render the label alone (Task, "reopened") so the
  // timeline reads "Task marked complete" / "Task reopened" instead of
  // "Task Updated completion marked complete."
  if (entry.relation === 'completion') {
    return (
      <div className="flex items-start gap-2 text-xs">
        <Icon className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
        <span className="font-medium text-foreground">Task {entry.label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
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

function AdminChangeDetail({ event, changedBy }: { event: RawChangeEvent; changedBy: string }) {
  const payload = safeParse<AdminPayload>(event.pmo_payload) ?? {};
  return (
    <div className="px-6 pb-4 bg-muted/20 border-t space-y-3">
      <div className="pt-3 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Previous value
          </p>
          <pre className="text-xs bg-background border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {truncate(payload.oldValue, 500) || '—'}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            New value
          </p>
          <pre className="text-xs bg-background border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {truncate(payload.newValue, 500) || '—'}
          </pre>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="font-medium">Setting key:</span>{' '}
          <span className="font-mono">{event.pmo_source ?? payload.settingKey ?? '—'}</span>
        </span>
        <span>
          <span className="font-medium">Changed by:</span> {changedBy}
        </span>
      </div>
    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────────────

function ChangeRow({ event }: { event: RawChangeEvent }) {
  const [expanded, setExpanded] = useState(false);
  const changedBy =
    (event['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined) ?? '—';

  // Decide which renderer to use based on event type.
  const isEntity = event.pmo_eventtype === 'EntityChange';
  const entityPayload = isEntity ? safeParse<EntityPayload>(event.pmo_payload) : null;
  const meta: RowMeta = entityPayload
    ? summarizeEntityRow(entityPayload, changedBy)
    : summarizeAdminRow(event, changedBy);

  const Icon = meta.icon;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md shrink-0', meta.iconColor)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{meta.summary}</p>
          {meta.context && (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{meta.context}</p>
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

      {expanded && (
        entityPayload
          ? <EntityChangeDetail payload={entityPayload} changedBy={changedBy} />
          : <AdminChangeDetail event={event} changedBy={changedBy} />
      )}
    </div>
  );
}

// ── Tabs / filters ───────────────────────────────────────────────────────────

type FilterKind = 'all' | 'project' | 'program' | 'task' | 'intake' | 'admin';

const FILTER_TABS: { key: FilterKind; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'intake',  label: 'Intake' },
  { key: 'project', label: 'Projects' },
  { key: 'program', label: 'Programs' },
  { key: 'task',    label: 'Tasks' },
  { key: 'admin',   label: 'Admin' },
];

function eventMatchesFilter(event: RawChangeEvent, kind: FilterKind): boolean {
  if (kind === 'all') return true;
  if (kind === 'admin') return event.pmo_eventtype === 'AdminChange';
  // Else this is an EntityChange filter — check the source column we set
  // when writing the row (pmo_source = 'project' / 'program' / 'task').
  return event.pmo_eventtype === 'EntityChange' && event.pmo_source === kind;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ChangeHistoryPage() {
  const { data: events = [], isLoading, isError } = useChangeHistory();
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<FilterKind>('all');

  const filtered = useMemo(() => events.filter((e) => {
    if (!eventMatchesFilter(e, filterKind)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const changedBy =
      (e['_createdby_value@OData.Community.Display.V1.FormattedValue'] as string | undefined) ?? '';
    if (changedBy.toLowerCase().includes(q)) return true;
    if ((e.pmo_source ?? '').toLowerCase().includes(q)) return true;
    if (e.pmo_payload.toLowerCase().includes(q)) return true;  // catches entity / setting names
    return false;
  }), [events, filterKind, search]);

  const tabCounts = useMemo(() => {
    const counts: Record<FilterKind, number> = { all: events.length, project: 0, program: 0, task: 0, intake: 0, admin: 0 };
    for (const e of events) {
      if (e.pmo_eventtype === 'AdminChange') counts.admin++;
      else if (e.pmo_eventtype === 'EntityChange') {
        const src = e.pmo_source as FilterKind | undefined;
        if (src === 'project' || src === 'program' || src === 'task' || src === 'intake') counts[src]++;
      }
    }
    return counts;
  }, [events]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Change History"
        subtitle="Audit log of admin configuration changes and user actions on programs, projects, and tasks"
      />
      {isError && (
        <div className="rounded-xl border border-border bg-muted/30 p-12 text-center">
          <History className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Change history is not available</p>
          <p className="text-xs text-muted-foreground mt-1">The audit log table has not been deployed to this Dataverse environment.</p>
        </div>
      )}

      {!isError && (
      <>{/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {FILTER_TABS.map((tab) => {
          const isActive = filterKind === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilterKind(tab.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span className={cn('ml-2 text-xs tabular-nums', isActive ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                {tabCounts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search by user, entity name, or setting key..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {(search || filterKind !== 'all') && filtered.length !== events.length && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {events.length} change{events.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading change history...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center">
          <History className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No changes found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {search || filterKind !== 'all'
              ? 'Try adjusting your filters.'
              : 'No changes have been recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y overflow-hidden">
          {filtered.map((e) => (
            <ChangeRow key={e.pmo_telemetryeventid} event={e} />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}
