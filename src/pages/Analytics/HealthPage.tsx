import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { resolveSidebarTeamName } from '../../lib/pmoTeams';
import { useAppSettings } from '../../hooks/useAppSettings';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { HealthBadge } from '../../components/common/HealthBadge';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjects } from '../../hooks/useProjects';
import { OVERALL_HEALTH } from '../../lib/constants';
import type { Project } from '../../models/project.model';

const HEALTH_COLUMNS = [
  { value: OVERALL_HEALTH.OnTrack,  label: 'On Track',   accent: 'emerald' as const },
  { value: OVERALL_HEALTH.AtRisk,   label: 'At Risk',    accent: 'amber' as const },
  { value: OVERALL_HEALTH.OffTrack, label: 'Off Track',  accent: 'rose' as const },
];

function groupByHealth(projects: Project[]) {
  const map = new Map<number | null, Project[]>();
  for (const col of HEALTH_COLUMNS) map.set(col.value, []);
  map.set(null, []);
  for (const p of projects) {
    const key = p.proj_overallhealth ?? null;
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

function subHealthDot(value: number | undefined) {
  if (value === OVERALL_HEALTH.OnTrack) return 'bg-emerald-500';
  if (value === OVERALL_HEALTH.AtRisk) return 'bg-amber-500';
  if (value === OVERALL_HEALTH.OffTrack) return 'bg-rose-500';
  return 'bg-muted-foreground/30';
}

export function HealthPage() {
  const navigate = useNavigate();
  const { data: appSettings = [] } = useAppSettings();
  const { data: projects = [], isLoading, error } = useProjects({
    $filter: 'statecode eq 0',
  });

  const grouped = groupByHealth(projects);
  const unsetProjects = grouped.get(null) ?? [];

  const onTrack = (grouped.get(OVERALL_HEALTH.OnTrack) ?? []).length;
  const atRisk = (grouped.get(OVERALL_HEALTH.AtRisk) ?? []).length;
  const offTrack = (grouped.get(OVERALL_HEALTH.OffTrack) ?? []).length;
  const onTrackPct = projects.length > 0 ? Math.round((onTrack / projects.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portfolio Health"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle={`${projects.length} active project${projects.length !== 1 ? 's' : ''} by overall health status`}
      />
      <ErrorBanner error={error as Error | null} />
      {isLoading ? (
        <LoadingOverlay isLoading label="Loading..." />
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No active projects in portfolio.</p>
        </div>
      ) : (
        <>
          <SummaryStrip columns={4} items={[
            { label: 'On Track', value: `${onTrack} (${onTrackPct}%)`, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'At Risk', value: atRisk, color: atRisk > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground' },
            { label: 'Off Track', value: offTrack, color: offTrack > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground' },
            { label: 'No Status Set', value: unsetProjects.length },
          ]} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {HEALTH_COLUMNS.map((col) => {
              const items = grouped.get(col.value) ?? [];
              const borderAccent =
                col.accent === 'emerald' ? 'border-t-emerald-500' :
                col.accent === 'amber'   ? 'border-t-amber-500' :
                                           'border-t-rose-500';
              return (
                <div key={col.value} className={cn('rounded-xl border border-border border-t-2 bg-card overflow-hidden', borderAccent)}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <HealthBadge value={col.value} />
                    <span className="text-sm font-bold text-foreground tabular-nums">{items.length}</span>
                  </div>
                  <div className="divide-y divide-border/60 max-h-80 overflow-y-auto">
                    {items.length === 0 ? (
                      <p className="px-4 py-4 text-xs text-muted-foreground text-center">No projects</p>
                    ) : (
                      items.map((p) => (
                        <button
                          key={p.msdyn_projectid}
                          className="w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                          onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                        >
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium text-foreground truncate flex-1">{p.msdyn_subject}</p>
                            <div className="flex items-center gap-1 shrink-0" title="Schedule / Effort / Financial health">
                              <span className={cn('h-1.5 w-1.5 rounded-full', subHealthDot(p.proj_schedulehealth))} title="Schedule" />
                              <span className={cn('h-1.5 w-1.5 rounded-full', subHealthDot(p.proj_efforthealth))} title="Effort" />
                              <span className={cn('h-1.5 w-1.5 rounded-full', subHealthDot(p.proj_financialhealth))} title="Financial" />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {(() => { const raw = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue']; const id = p._pmo_primaryteam_value; return id && raw ? resolveSidebarTeamName(id, raw, appSettings) : (raw ?? '—'); })()}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {unsetProjects.length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
                <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {unsetProjects.length} project{unsetProjects.length !== 1 ? 's' : ''} without health status
                </span>
              </div>
              <div className="divide-y divide-border/60 max-h-48 overflow-y-auto">
                {unsetProjects.map((p) => (
                  <button
                    key={p.msdyn_projectid}
                    className="w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors flex items-center justify-between"
                    onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                  >
                    <span className="text-xs font-medium text-foreground truncate">{p.msdyn_subject}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {(() => { const raw = p['_pmo_primaryteam_value@OData.Community.Display.V1.FormattedValue']; const id = p._pmo_primaryteam_value; return id && raw ? resolveSidebarTeamName(id, raw, appSettings) : (raw ?? '—'); })()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
