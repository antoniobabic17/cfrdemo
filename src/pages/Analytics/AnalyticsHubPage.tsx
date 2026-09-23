import { useNavigate } from 'react-router-dom';
import {
  Users, GitBranch, Activity, ChevronRight, BarChart3, Inbox, Bot,
  ShieldCheck, Gauge, Trophy, DollarSign, Map, GitCompare, TrendingUp,
  Calendar, AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { HealthBadge } from '../../components/common/HealthBadge';
import { useActiveProjects } from '../../hooks/useProjects';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { useCapacityData } from '../../hooks/useCapacityData';
import { OVERALL_HEALTH, REQUEST_STATUS } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { resolveSidebarTeamName } from '../../lib/pmoTeams';
import { useAppSettings } from '../../hooks/useAppSettings';

function normPct(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return raw > 0 && raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
}

const ANALYTICS_SECTIONS = [
  {
    header: 'Intake & Pipeline',
    pages: [
      { path: '/analytics/pipeline', title: 'Pipeline', description: 'Funnel view of intake requests from Draft through Conversion.', icon: GitBranch },
      { path: '/analytics/intake', title: 'Intake Overview', description: 'Status distribution, routing confidence, and outcome breakdown.', icon: Inbox },
      { path: '/analytics/intake-pipeline', title: 'Intake Analytics', description: 'Governed intake analytics with conversion and cycle-time metrics.', icon: BarChart3 },
      { path: '/analytics/routing-qa', title: 'Routing QA', description: 'AI-routed requests by confidence tier, recommendation, and outcome.', icon: Bot },
    ],
  },
  {
    header: 'Portfolio & Delivery',
    pages: [
      { path: '/analytics/health', title: 'Health Matrix', description: 'Active projects organized by overall health status.', icon: Activity },
      { path: '/analytics/by-team', title: 'By Team', description: 'Project distribution and health by team assignment.', icon: Users },
      { path: '/analytics/schedule', title: 'Schedule', description: 'Date coverage and overdue task signals across projects.', icon: Calendar },
      { path: '/analytics/capacity', title: 'Capacity', description: 'Resource demand vs. capacity across the portfolio.', icon: Gauge },
      { path: '/analytics/roadmap', title: 'Roadmap', description: 'Cross-project timeline and dependency visibility.', icon: Map },
    ],
  },
  {
    header: 'Strategy & Finance',
    pages: [
      { path: '/analytics/prioritization', title: 'Prioritization', description: 'Portfolio scoring across weighted strategic factors.', icon: Trophy },
      { path: '/analytics/financials', title: 'Financials', description: 'Budget, forecast, actual spend, and variance.', icon: DollarSign },
      { path: '/analytics/governance', title: 'Governance', description: 'Gate readiness, approvals, and compliance.', icon: ShieldCheck },
      { path: '/analytics/scenarios', title: 'Scenarios', description: 'What-if portfolio modeling under budget and capacity caps.', icon: GitCompare },
      { path: '/analytics/variance', title: 'Variance', description: 'Baseline variance across schedule, budget, and effort.', icon: TrendingUp },
    ],
  },
];

export function AnalyticsHubPage() {
  const navigate = useNavigate();
  const { data: appSettings = [] } = useAppSettings();
  const { data: projects = [] } = useActiveProjects();
  const { data: requests = [] } = useProjectRequests();
  const { overallocatedCount } = useCapacityData();

  const today = new Date().toISOString().split('T')[0];
  const onTrack = projects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.OnTrack).length;
  const atRisk = projects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.AtRisk).length;
  const offTrack = projects.filter(p => p.proj_overallhealth === OVERALL_HEALTH.OffTrack).length;
  const healthSet = onTrack + atRisk + offTrack;
  const unhealthyCount = atRisk + offTrack;
  const openRequests = requests.filter(r => r.pmo_status === REQUEST_STATUS.Submitted || r.pmo_status === REQUEST_STATUS.InTriage).length;
  const overdueCount = projects.filter(p => p.msdyn_finish && p.msdyn_finish < today && normPct(p.msdyn_progress) < 100).length;
  const onTrackPct = projects.length > 0 ? Math.round((onTrack / projects.length) * 100) : 0;

  const needsAttention = [...projects]
    .filter(p => p.proj_overallhealth === OVERALL_HEALTH.AtRisk || p.proj_overallhealth === OVERALL_HEALTH.OffTrack)
    .sort((a, b) => (b.proj_overallhealth ?? 0) - (a.proj_overallhealth ?? 0) || a.msdyn_subject.localeCompare(b.msdyn_subject))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics & Reporting" subtitle="CFR PMO portfolio insights" />

      <SummaryStrip
        columns={3}
        items={[
          { label: 'Active Projects', value: projects.length },
          { label: 'On Track', value: `${onTrackPct}%`, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'At Risk / Off Track', value: unhealthyCount, color: unhealthyCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground' },
          { label: 'Open Requests', value: openRequests },
          { label: 'Overdue Projects', value: overdueCount, color: overdueCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground' },
          { label: 'Over-allocated', value: overallocatedCount, color: overallocatedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground' },
        ]}
      />

      {/* Portfolio Health */}
      {projects.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Portfolio Health</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {healthSet > 0
                  ? `${healthSet} of ${projects.length} project${projects.length !== 1 ? 's' : ''} have health status set`
                  : 'No health status data available yet'}
              </p>
            </div>
            <button onClick={() => navigate('/analytics/health')} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors">
              View details <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3">
              {([
                { label: 'On Track', count: onTrack, dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/8 ring-1 ring-emerald-500/15' },
                { label: 'At Risk', count: atRisk, dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/8 ring-1 ring-amber-500/15' },
                { label: 'Off Track', count: offTrack, dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-500/8 ring-1 ring-rose-500/15' },
              ]).map((s) => (
                <div key={s.label} className={cn('rounded-lg px-4 py-3.5 text-center', s.bg)}>
                  <p className={cn('text-3xl font-bold tabular-nums leading-none', s.text)}>{s.count}</p>
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <span className={cn('h-2 w-2 rounded-full shrink-0', s.dot)} />
                    <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            {healthSet > 0 && (
              <div className="mt-4">
                <div className="flex h-2 rounded-full overflow-hidden bg-muted gap-px">
                  {onTrack > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(onTrack / healthSet) * 100}%` }} />}
                  {atRisk > 0 && <div className="bg-amber-500 transition-all" style={{ width: `${(atRisk / healthSet) * 100}%` }} />}
                  {offTrack > 0 && <div className="bg-rose-500 transition-all" style={{ width: `${(offTrack / healthSet) * 100}%` }} />}
                </div>
                {projects.length - healthSet > 0 && (
                  <p className="text-xs text-muted-foreground text-right mt-1.5">
                    {projects.length - healthSet} project{projects.length - healthSet !== 1 ? 's' : ''} without health status
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Needs Attention */}
      {needsAttention.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-foreground">Needs Attention</h2>
              <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 tabular-nums">{unhealthyCount}</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {needsAttention.map((p) => (
              <button
                key={p.msdyn_projectid}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
              >
                <HealthBadge value={p.proj_overallhealth} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{p.msdyn_subject}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {(() => {
                      const raw = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue'];
                      const id = p._pmo_primaryteam_value;
                      return id && raw ? resolveSidebarTeamName(id, raw, appSettings) : (raw ?? '—');
                    })()}
                    {(p.proj_activerisks ?? 0) > 0 && <span className="text-rose-500/80 ml-2">{p.proj_activerisks} risk{p.proj_activerisks !== 1 ? 's' : ''}</span>}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Analytics Navigation — grouped by domain */}
      <div className="space-y-4">
        {ANALYTICS_SECTIONS.map((section) => (
          <div key={section.header}>
            <h3 className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 px-1">{section.header}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.pages.map(({ path, title, description, icon: Icon }) => (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40 hover:bg-primary/5 transition-all group flex items-start gap-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0 group-hover:bg-primary/25 transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
