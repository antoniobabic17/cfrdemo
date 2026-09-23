import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  FolderKanban, Inbox, AlertTriangle, CalendarX,
  CheckCircle2, Clock, ChevronRight, ShieldAlert,
  ArrowUpRight, BarChart3,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { HealthBadge } from '../../components/common/HealthBadge';
import { Button } from '../../components/ui/button';
import { KpiCard } from '../../components/data-display/KpiCard';
import { useActiveProjects } from '../../hooks/useProjects';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { OVERALL_HEALTH, REQUEST_STATUS, REQUEST_PRIORITY } from '../../lib/constants';
import { useConfig } from '../../providers/ConfigurationProvider';
import type { Project } from '../../models/project.model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize msdyn_progress (stored 0-1 in Dataverse) to a 0-100 integer. */
function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

function fmtDate(v?: string) {
  return v
    ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';
}

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
// Uses consolidated KpiCard from components/data-display/KpiCard

// ─── Mini Progress Bar ────────────────────────────────────────────────────────

function MiniProgress({ value, className }: { value?: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color =
    pct >= 80 ? 'bg-emerald-500' :
    pct >= 40 ? 'bg-primary' :
                'bg-amber-500';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground w-7 text-right shrink-0">{pct}%</span>
    </div>
  );
}

// ─── Health Pill (uses shared HealthBadge) ───────────────────────────────────

// ─── Priority Pill ────────────────────────────────────────────────────────────

function PriorityPill({ priority }: { priority?: number }) {
  if (priority === REQUEST_PRIORITY.Critical)
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/20">Critical</span>;
  if (priority === REQUEST_PRIORITY.High)
    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">High</span>;
  if (priority === REQUEST_PRIORITY.Medium)
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20">Medium</span>;
  if (priority === REQUEST_PRIORITY.Low)
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground ring-1 ring-border">Low</span>;
  return null;
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  title, count, action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {count != null && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

// ─── Project Row (shared between Needs Attention + Due Soon) ──────────────────

function ProjectRow({
  project, onClick, badge,
}: {
  project: Project;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left group"
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {badge}
          <HealthBadge value={project.proj_overallhealth} size="sm" />
          {(project.proj_activerisks ?? 0) > 0 && (
            <span className="text-[10px] text-rose-500/80 font-medium">
              {project.proj_activerisks} risk{project.proj_activerisks !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-foreground truncate leading-snug">
          {project.msdyn_subject}
        </p>
        <MiniProgress value={normPct(project.msdyn_progress)} className="mt-1.5" />
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {project.msdyn_finish && (
          <p className="text-xs text-muted-foreground">{fmtDate(project.msdyn_finish)}</p>
        )}
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}

// ─── Empty panel state ────────────────────────────────────────────────────────

function PanelEmpty({
  icon: Icon, title, description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-5 gap-2 text-center">
      <Icon className="h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-[18rem] leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate();
  const { config: { dashboardDisplay } } = useConfig();

  const { data: projects = [], isLoading: loadingProjects, error: projectsError } = useActiveProjects();
  const { data: requests = [], isLoading: loadingRequests, error: requestsError } = useProjectRequests();

  const isLoading = loadingProjects || loadingRequests;

  // ── Derived KPI values ───────────────────────────────────────────────────────
  const today       = new Date().toISOString().split('T')[0];
  const activeCount = projects.length;
  const avgProgress = activeCount > 0
    ? Math.round(projects.reduce((s, p) => s + normPct(p.msdyn_progress), 0) / activeCount)
    : 0;

  const openIntakeCount = requests.filter(
    (r) => r.pmo_status === REQUEST_STATUS.Submitted || r.pmo_status === REQUEST_STATUS.InTriage
  ).length;
  const inTriageCount = requests.filter((r) => r.pmo_status === REQUEST_STATUS.InTriage).length;

  const onTrackCount  = projects.filter((p) => p.proj_overallhealth === OVERALL_HEALTH.OnTrack).length;
  const atRiskCount   = projects.filter((p) => p.proj_overallhealth === OVERALL_HEALTH.AtRisk).length;
  const offTrackCount = projects.filter((p) => p.proj_overallhealth === OVERALL_HEALTH.OffTrack).length;
  const healthSet     = onTrackCount + atRiskCount + offTrackCount;
  const unhealthyCount = atRiskCount + offTrackCount;

  const overdueCount = projects.filter(
    (p) => p.msdyn_finish && p.msdyn_finish < today && normPct(p.msdyn_progress) < 100
  ).length;

  const submittedCount = requests.filter((r) => r.pmo_status === REQUEST_STATUS.Submitted).length;
  const approvedCount  = requests.filter((r) => r.pmo_status === REQUEST_STATUS.Approved).length;
  const totalRequests  = requests.length;

  // ── Dashboard panel data ─────────────────────────────────────────────────────
  const needsAttention = useMemo(() =>
    [...projects]
      .filter((p) =>
        p.proj_overallhealth === OVERALL_HEALTH.AtRisk ||
        p.proj_overallhealth === OVERALL_HEALTH.OffTrack
      )
      .sort((a, b) => {
        // Off-track first (higher value = worse)
        const ha = a.proj_overallhealth ?? 0;
        const hb = b.proj_overallhealth ?? 0;
        return hb - ha || a.msdyn_subject.localeCompare(b.msdyn_subject);
      })
      .slice(0, dashboardDisplay.needsAttentionLimit),
    [projects, dashboardDisplay.needsAttentionLimit]
  );

  const dueSoon = useMemo(() => {
    const inN = new Date();
    inN.setDate(inN.getDate() + dashboardDisplay.dueSoonDays);
    const in30Str = inN.toISOString().split('T')[0];
    return [...projects]
      .filter(
        (p) =>
          p.msdyn_finish &&
          p.msdyn_finish >= today &&
          p.msdyn_finish <= in30Str &&
          normPct(p.msdyn_progress) < 100
      )
      .sort((a, b) => (a.msdyn_finish ?? '').localeCompare(b.msdyn_finish ?? ''))
      .slice(0, dashboardDisplay.needsAttentionLimit);
  }, [projects, today, dashboardDisplay.dueSoonDays, dashboardDisplay.needsAttentionLimit]);

  const recentIntake = useMemo(() =>
    [...requests]
      .sort((a, b) => (b.createdon ?? '').localeCompare(a.createdon ?? ''))
      .slice(0, dashboardDisplay.recentIntakeLimit),
    [requests, dashboardDisplay.recentIntakeLimit]
  );

  // ── Formatted date for header ────────────────────────────────────────────────
  const todayFmt = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-6">

      {/* ── Hero Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Portfolio Command Center
            </h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">CFR Project Management Office</p>
            {!isLoading && activeCount > 0 && (
              <>
                <span className="text-muted-foreground/30 text-xs">·</span>
                <span className="text-xs font-medium text-muted-foreground/70">
                  {activeCount} active project{activeCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
            {!isLoading && unhealthyCount > 0 && (
              <>
                <span className="text-muted-foreground/30 text-xs">·</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {unhealthyCount} need{unhealthyCount === 1 ? 's' : ''} attention
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 hidden sm:flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground h-7"
            onClick={() => navigate('/analytics')}
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Analytics
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
          <div className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 bg-muted/30">
            <Clock className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground/70">{todayFmt}</span>
          </div>
        </div>
      </div>

      <ErrorBanner error={projectsError as Error | null} />
      <ErrorBanner error={requestsError as Error | null} />

      {isLoading ? (
        <LoadingOverlay isLoading label="Loading portfolio…" />
      ) : (
        <>
          {/* ── KPI Row ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={FolderKanban}
              label="Active Projects"
              value={activeCount}
              secondary={activeCount > 0 ? `Avg. ${avgProgress}% complete` : 'No active projects'}
              accent="primary"
              onClick={() => navigate('/projects')}
            />
            <KpiCard
              icon={Inbox}
              label="Open Intake Requests"
              value={openIntakeCount}
              secondary={inTriageCount > 0 ? `${inTriageCount} in triage` : 'None in triage'}
              accent="blue"
              onClick={() => navigate('/intake')}
            />
            <KpiCard
              icon={AlertTriangle}
              label="At Risk / Off Track"
              value={unhealthyCount}
              secondary={
                activeCount > 0
                  ? `${Math.round((unhealthyCount / activeCount) * 100)}% of portfolio`
                  : '—'
              }
              accent={unhealthyCount > 0 ? 'amber' : 'emerald'}
              onClick={() => navigate('/projects?health=at,off')}
            />
            <KpiCard
              icon={CalendarX}
              label="Overdue Projects"
              value={overdueCount}
              secondary={overdueCount > 0 ? 'Past finish date' : 'None overdue'}
              accent={overdueCount > 0 ? 'rose' : 'emerald'}
              onClick={() => navigate('/projects')}
            />
          </div>

          {/* ── Portfolio Health Overview ───────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Portfolio Health</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {healthSet > 0
                    ? `${healthSet} of ${activeCount} project${activeCount !== 1 ? 's' : ''} have status set`
                    : 'No health status data available yet'}
                </p>
              </div>
              <Button
                size="sm" variant="ghost"
                className="text-xs text-muted-foreground h-7"
                onClick={() => navigate('/projects')}
              >
                All projects <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Button>
            </div>

            <div className="p-5">
              {activeCount === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <p className="text-sm text-muted-foreground">No active projects in portfolio.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Stat blocks */}
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      {
                        label: 'On Track', count: onTrackCount,
                        dot: 'bg-emerald-500',
                        text: 'text-emerald-700 dark:text-emerald-300',
                        bg: 'bg-emerald-500/8 ring-1 ring-emerald-500/15',
                      },
                      {
                        label: 'At Risk', count: atRiskCount,
                        dot: 'bg-amber-500',
                        text: 'text-amber-700 dark:text-amber-300',
                        bg: 'bg-amber-500/8 ring-1 ring-amber-500/15',
                      },
                      {
                        label: 'Off Track', count: offTrackCount,
                        dot: 'bg-rose-500',
                        text: 'text-rose-700 dark:text-rose-300',
                        bg: 'bg-rose-500/8 ring-1 ring-rose-500/15',
                      },
                    ] as const).map((s) => (
                      <button
                        key={s.label}
                        onClick={() => navigate('/projects')}
                        className={cn('rounded-lg px-4 py-3.5 text-center w-full hover:ring-2 transition-all', s.bg)}
                        title={`View ${s.label.toLowerCase()} projects`}
                      >
                        <p className={cn('text-3xl font-bold tabular-nums leading-none', s.text)}>
                          {s.count}
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                          <span className={cn('h-2 w-2 rounded-full shrink-0', s.dot)} />
                          <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Stacked bar */}
                  {healthSet > 0 && (
                    <div className="space-y-2">
                      <div className="flex h-2 rounded-full overflow-hidden bg-muted gap-px">
                        {onTrackCount > 0 && (
                          <div
                            className="bg-emerald-500 transition-all"
                            style={{ width: `${(onTrackCount / healthSet) * 100}%` }}
                          />
                        )}
                        {atRiskCount > 0 && (
                          <div
                            className="bg-amber-500 transition-all"
                            style={{ width: `${(atRiskCount / healthSet) * 100}%` }}
                          />
                        )}
                        {offTrackCount > 0 && (
                          <div
                            className="bg-rose-500 transition-all"
                            style={{ width: `${(offTrackCount / healthSet) * 100}%` }}
                          />
                        )}
                      </div>
                      {activeCount - healthSet > 0 && (
                        <p className="text-xs text-muted-foreground text-right">
                          {activeCount - healthSet} project{activeCount - healthSet !== 1 ? 's' : ''} without health status
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Needs Attention + Due Soon ─────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Needs Attention */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <SectionHeader
                title="Needs Attention"
                count={unhealthyCount > 0 ? unhealthyCount : undefined}
                action={
                  unhealthyCount > 0 ? (
                    <Button
                      size="sm" variant="ghost"
                      className="text-xs text-muted-foreground h-7"
                      onClick={() => navigate('/projects')}
                    >
                      View all <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  ) : undefined
                }
              />
              {needsAttention.length === 0 ? (
                <PanelEmpty
                  icon={CheckCircle2}
                  title="Portfolio is healthy"
                  description="No at-risk or off-track projects. All clear."
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {needsAttention.map((p) => (
                    <ProjectRow
                      key={p.msdyn_projectid}
                      project={p}
                      onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Due Within 30 Days */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <SectionHeader
                title="Due Within 30 Days"
                count={dueSoon.length > 0 ? dueSoon.length : undefined}
              />
              {dueSoon.length === 0 ? (
                <PanelEmpty
                  icon={Clock}
                  title="No upcoming deadlines"
                  description={`No in-progress projects finishing in the next ${dashboardDisplay.dueSoonDays} days.`}
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {dueSoon.map((p) => {
                    const days = daysUntil(p.msdyn_finish);
                    const dayBadge =
                      days != null ? (
                        <span className={cn(
                          'text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded',
                          days <= dashboardDisplay.urgentDayThreshold
                            ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                            : days <= dashboardDisplay.warningDayThreshold
                            ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {days === 0 ? 'Due today' : days === 1 ? '1 day left' : `${days}d left`}
                        </span>
                      ) : null;
                    return (
                      <ProjectRow
                        key={p.msdyn_projectid}
                        project={p}
                        onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                        badge={dayBadge}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Recent Intake + Pipeline ────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">

            {/* Recent Intake */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <SectionHeader
                title="Recent Intake Requests"
                count={requests.length > 0 ? requests.length : undefined}
                action={
                  requests.length > 0 ? (
                    <Button
                      size="sm" variant="ghost"
                      className="text-xs text-muted-foreground h-7"
                      onClick={() => navigate('/intake')}
                    >
                      All requests <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
                  ) : undefined
                }
              />
              {recentIntake.length === 0 ? (
                <PanelEmpty
                  icon={Inbox}
                  title="No intake requests"
                  description="Submit a new intake request to get started."
                />
              ) : (
                <div className="divide-y divide-border/50">
                  {recentIntake.map((r) => (
                    <button
                      key={r.pmo_projectrequestid}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => navigate(`/intake/${r.pmo_projectrequestid}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate leading-snug">
                          {r.pmo_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {r.pmo_autonumber && (
                            <span className="font-mono mr-1">{r.pmo_autonumber} ·</span>
                          )}
                          {r['_pmo_targetteam_value@OData.Community.Display.V1.FormattedValue'] ?? 'No team'}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <PriorityPill priority={r.pmo_priority} />
                        <span className="text-xs text-muted-foreground hidden sm:block whitespace-nowrap">
                          {r['pmo_status@OData.Community.Display.V1.FormattedValue'] ?? '—'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Intake Pipeline */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <SectionHeader title="Intake Pipeline" />
              {totalRequests === 0 ? (
                <PanelEmpty
                  icon={ShieldAlert}
                  title="No requests yet"
                  description="The pipeline is empty."
                />
              ) : (
                <div className="p-5 space-y-5">
                  {([
                    { label: 'Submitted',  count: submittedCount, bar: 'bg-blue-500',    bg: 'bg-blue-500/8',    text: 'text-blue-600 dark:text-blue-400' },
                    { label: 'In Triage',  count: inTriageCount,  bar: 'bg-amber-500',   bg: 'bg-amber-500/8',   text: 'text-amber-600 dark:text-amber-400' },
                    { label: 'Approved',   count: approvedCount,  bar: 'bg-emerald-500', bg: 'bg-emerald-500/8', text: 'text-emerald-600 dark:text-emerald-400' },
                  ] as const).map(({ label, count, bar, bg, text }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-foreground">{label}</span>
                        <span className={cn('text-xs font-bold tabular-nums px-1.5 py-0.5 rounded', bg, text)}>
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', bar)}
                          style={{ width: totalRequests > 0 ? `${(count / totalRequests) * 100}%` : '0%' }}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="pt-1 mt-1 border-t border-border/60 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Total requests</span>
                    <span className="text-sm font-bold text-foreground tabular-nums">{totalRequests}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
