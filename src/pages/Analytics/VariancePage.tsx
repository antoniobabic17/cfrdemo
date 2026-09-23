import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { useProjects } from '../../hooks/useProjects';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS } from '../../lib/constants';
import { useVarianceData } from '../../hooks/useVarianceData';
import type { ProjectBaseline } from '../../models/projectBaseline.model';
import { cn } from '../../lib/utils';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function useAllBaselines() {
  return useQuery({
    queryKey: ['allBaselines'],
    queryFn: () => dv.list<ProjectBaseline>(ENTITY_SETS.projectBaseline, {
      $select: ['pmo_projectbaselineid', 'pmo_name', 'pmo_captureddate', 'pmo_baselinestart', 'pmo_finish', 'pmo_budget', 'pmo_baselineeffort', '_pmo_project_value'],
      $filter: 'statecode eq 0',
      $orderby: 'pmo_captureddate desc',
    }),
    staleTime: 5 * 60 * 1000,
  });
}

export function VariancePage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading: loadingP, error: errP } = useProjects();
  const { data: baselines = [], isLoading: loadingB, error: errB } = useAllBaselines();
  const isLoading = loadingP || loadingB;
  const error = errP || errB;

  const baselineMap = useMemo(() => {
    const m = new Map<string, ProjectBaseline[]>();
    for (const b of baselines) {
      const pid = b['_pmo_project_value'] ?? '';
      const arr = m.get(pid) ?? [];
      arr.push(b);
      m.set(pid, arr);
    }
    return m;
  }, [baselines]);

  const entries = useVarianceData(projects, baselineMap);
  const projectsWithBaseline = entries.length;
  const projectsWithScheduleSlip = entries.filter((e) => (e.scheduleVarianceDays ?? 0) > 0).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Variance" subtitle="Baseline variance across schedule, budget, and effort" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{projectsWithBaseline}</p>
              <p className="text-xs text-muted-foreground">Projects with baselines</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className={cn('text-2xl font-bold', projectsWithScheduleSlip > 0 ? 'text-rose-600' : 'text-emerald-600')}>{projectsWithScheduleSlip}</p>
              <p className="text-xs text-muted-foreground">Schedule slips</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{baselines.length}</p>
              <p className="text-xs text-muted-foreground">Total baselines captured</p>
              {projectsWithBaseline > 0 && <p className="text-[10px] text-muted-foreground/60 mt-0.5">Across {projectsWithBaseline} project{projectsWithBaseline !== 1 ? 's' : ''}</p>}
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="rounded-xl border p-8 text-center max-w-lg">
              <p className="text-sm font-medium text-foreground">No baseline snapshots captured</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                To start tracking variance, open a project detail page and capture a baseline snapshot in the Monitor workspace.
                Baselines record the project's schedule, budget, and effort at a point in time so future changes can be measured.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border divide-y overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground">
                <span className="flex-1">Project</span>
                <span className="w-24 text-right">Baseline</span>
                <span className="w-28 text-right">Schedule (days)</span>
                <span className="w-24 text-right">Budget</span>
                <span className="w-24 text-right">Effort (hrs)</span>
              </div>
              {entries.map((e) => (
                <button
                  key={e.projectId}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-sm"
                  onClick={() => navigate(`/projects/${e.projectId}`)}
                >
                  <span className="flex-1 font-medium text-foreground truncate">{e.projectName}</span>
                  <span className="w-24 text-right text-xs text-muted-foreground">{new Date(e.capturedDate).toLocaleDateString()}</span>
                  <span className={cn('w-28 text-right tabular-nums flex items-center justify-end gap-1',
                    e.scheduleVarianceDays == null ? 'text-muted-foreground' : e.scheduleVarianceDays > 0 ? 'text-rose-600' : e.scheduleVarianceDays < 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                    {e.scheduleVarianceDays != null ? (
                      <>{e.scheduleVarianceDays > 0 ? <TrendingUp className="h-3 w-3" /> : e.scheduleVarianceDays < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}{Math.abs(e.scheduleVarianceDays)}d</>
                    ) : '—'}
                  </span>
                  <span className={cn('w-24 text-right tabular-nums',
                    e.budgetVariance == null ? 'text-muted-foreground' : e.budgetVariance > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {e.budgetVariance != null ? fmt.format(e.budgetVariance) : '—'}
                  </span>
                  <span className={cn('w-24 text-right tabular-nums',
                    e.effortVarianceHours == null ? 'text-muted-foreground' : e.effortVarianceHours > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {e.effortVarianceHours != null ? `${e.effortVarianceHours > 0 ? '+' : ''}${e.effortVarianceHours}h` : '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
