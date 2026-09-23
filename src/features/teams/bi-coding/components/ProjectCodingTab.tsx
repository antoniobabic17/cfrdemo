/**
 * ProjectCodingTab — BI-team-gated Coding surface inside Project Detail.
 *
 * Renders only when the project's Primary Team is the BI team — gating
 * happens in ProjectDetailPage so this component assumes a valid BI project.
 *
 * Displays spec pipeline status from pmo_specsummaryjson (IC-07 projection),
 * GitHub deep links (pmo_specrepourl), and task velocity from the IC-07
 * tasksComplete / tasksTotal counters.
 *
 * T2-08: Initial implementation. No writes originate from this tab —
 * pmo_specsummaryjson is a read-only projection from rcm_aispeclifecycleevent.
 */
import { ExternalLink, GitBranch, RefreshCw, CheckCircle2, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { useSpecArtifactStatuses } from '../hooks/useSpecArtifactStatuses';
import { fmtDateOnly } from '../../../../lib/dateOnly';

/** Parsed IC-07 projection shape. */
interface SpecSummaryJson {
  specId: string;
  title: string;
  status: 'Draft' | 'InProgress' | 'Review' | 'Merged' | 'Closed';
  currentPhase: string;
  tasksComplete: number;
  tasksTotal: number;
  lastEvent: string;
  repoUrl: string;
  prNumber: number | null;
}

function parseSpecSummaryJson(raw: string | null): SpecSummaryJson | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SpecSummaryJson;
  } catch {
    return null;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return fmtDateOnly(iso);
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: SpecSummaryJson['status'] }) {
  const styles: Record<SpecSummaryJson['status'], string> = {
    Draft:      'bg-muted text-muted-foreground ring-border',
    InProgress: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/20',
    Review:     'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20',
    Merged:     'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
    Closed:     'bg-muted/60 text-muted-foreground ring-border',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', styles[status])}>
      {status}
    </span>
  );
}

function StatusIcon({ status }: { status: SpecSummaryJson['status'] }) {
  switch (status) {
    case 'Merged':     return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case 'Review':     return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
    case 'InProgress': return <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />;
    case 'Closed':     return <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:           return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function VelocityBar({ complete, total }: { complete: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((complete / total) * 100)) : 0;
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 40 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums w-16 text-right">
        {complete} / {total}
      </span>
    </div>
  );
}

function SpecCard({ row }: { row: { pmo_specsummaryjson: string | null; pmo_specrepourl: string | null; pmo_speclastupdatedutc: string | null } }) {
  const summary = parseSpecSummaryJson(row.pmo_specsummaryjson);

  if (!summary) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground italic">
        Spec summary unavailable — projection has not run yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusIcon status={summary.status} />
            <span className="text-sm font-semibold text-foreground truncate">{summary.title || summary.specId}</span>
            <StatusBadge status={summary.status} />
          </div>
          {summary.specId && (
            <p className="text-xs text-muted-foreground font-mono">{summary.specId}</p>
          )}
        </div>
        {row.pmo_specrepourl && (
          <a
            href={row.pmo_specrepourl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            title="Open spec in GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            GitHub
          </a>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Velocity */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Task velocity
          </p>
          <VelocityBar complete={summary.tasksComplete} total={summary.tasksTotal} />
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <MetaCell label="Current phase" value={summary.currentPhase || '—'} />
          <MetaCell label="Last event" value={fmtDate(summary.lastEvent)} />
          <MetaCell label="Projection updated" value={fmtDate(row.pmo_speclastupdatedutc)} />
          {summary.prNumber != null && (
            <MetaCell
              label="PR"
              value={
                row.pmo_specrepourl ? (
                  <a
                    href={`${row.pmo_specrepourl.replace(/\/blob\/.*$/, '')}/pull/${summary.prNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <GitBranch className="h-3 w-3" />
                    #{summary.prNumber}
                  </a>
                ) : (
                  `#${summary.prNumber}`
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="uppercase tracking-widest font-semibold text-[9px] text-muted-foreground/60">{label}</p>
      <div className="truncate text-foreground/90 text-xs">{value}</div>
    </div>
  );
}

interface Props {
  projectId: string;
}

export function ProjectCodingTab({ projectId }: Props) {
  const { data: rows = [], isLoading, error } = useSpecArtifactStatuses(projectId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading spec pipeline…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Failed to load spec pipeline data.
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Spec pipeline
        </h3>
        <p className="text-xs text-muted-foreground">
          Spec lifecycle status projected from the AI Coding Brain. Updated automatically
          when spec events are recorded. Read-only — edits happen in the source repository.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <p className="text-sm text-muted-foreground">
            No spec pipeline data yet for this project.
          </p>
          <p className="text-xs text-muted-foreground">
            Data appears here after the BI Coding Brain projects a spec lifecycle event
            via the IC-07 projection flow. Trigger the flow by pushing a commit with the
            <code className="mx-1 font-mono text-xs bg-muted px-1 rounded">task(&lt;id&gt;):</code>
            convention on a branch with an open PR.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <SpecCard key={row.pmo_projectartifactstatusid} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
