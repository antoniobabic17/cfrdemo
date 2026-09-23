import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { HealthBadge } from '../../components/common/HealthBadge';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjects } from '../../hooks/useProjects';
import { usePrograms } from '../../hooks/usePrograms';
import { useCrossProjectDependencies } from '../../hooks/useCrossProjectDependencies';
import { cn } from '../../lib/utils';

export function RoadmapPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading: loadingP, error: errP } = useProjects();
  const { data: programs = [], isLoading: loadingPr, error: errPr } = usePrograms();
  const dependencies = useCrossProjectDependencies(projects);

  const isLoading = loadingP || loadingPr;
  const error = errP || errPr;

  const allActive = projects.filter((p) => p.statecode === 0);
  const activeProjects = allActive.filter((p) => p.msdyn_scheduledstart);
  const excludedCount = allActive.length - activeProjects.length;

  const timeRange = useMemo(() => {
    if (activeProjects.length === 0) return { min: new Date(), max: new Date(), rangeDays: 1 };
    const starts = activeProjects.map((p) => new Date(p.msdyn_scheduledstart!).getTime());
    const ends = activeProjects.map((p) => p.msdyn_finish ? new Date(p.msdyn_finish).getTime() : new Date(p.msdyn_scheduledstart!).getTime() + 90 * 86400000);
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    const rangeDays = Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000));
    return { min, max, rangeDays };
  }, [activeProjects]);

  function barPosition(start?: string, end?: string) {
    if (!start) return { left: '0%', width: '0%' };
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : s + 90 * 86400000;
    const left = ((s - timeRange.min.getTime()) / (timeRange.rangeDays * 86400000)) * 100;
    const width = ((e - s) / (timeRange.rangeDays * 86400000)) * 100;
    return { left: `${Math.max(0, left)}%`, width: `${Math.min(100 - left, Math.max(2, width))}%` };
  }

  const programMap = Object.fromEntries(programs.map((p) => [p.msdyn_projectprogramid, p.msdyn_name]));

  const grouped = useMemo(() => {
    const byProgram = new Map<string, typeof activeProjects>();
    for (const p of activeProjects) {
      const key = p._msdyn_program_value ?? '__none__';
      const arr = byProgram.get(key) ?? [];
      arr.push(p);
      byProgram.set(key, arr);
    }
    return Array.from(byProgram.entries()).map(([programId, projs]) => ({
      programId,
      programName: programId === '__none__' ? 'Unassigned' : programMap[programId] ?? programId,
      projects: projs.sort((a, b) => new Date(a.msdyn_scheduledstart!).getTime() - new Date(b.msdyn_scheduledstart!).getTime()),
    }));
  }, [activeProjects, programMap]);

  return (
    <div className="space-y-6">
      <PageHeader title="Roadmap" subtitle="Cross-project timeline and dependency visibility" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          <SummaryStrip columns={3} items={[
            { label: 'Projects on Roadmap', value: activeProjects.length },
            { label: 'Programs', value: grouped.length },
            { label: 'Schedule Overlaps', value: dependencies.length, color: dependencies.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground' },
          ]} />

          {excludedCount > 0 && (
            <p className="text-xs text-muted-foreground">{excludedCount} project{excludedCount !== 1 ? 's' : ''} without start dates are not shown on the roadmap.</p>
          )}

          {dependencies.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Schedule Overlaps ({dependencies.length})
              </h3>
              <div className="space-y-1.5">
                {dependencies.slice(0, 10).map((d, i) => (
                  <div key={i} className={cn('rounded-md border p-2 text-xs',
                    d.risk === 'high' ? 'border-rose-200 bg-rose-50/50' : d.risk === 'medium' ? 'border-amber-200 bg-amber-50/50' : 'border-border bg-card')}>
                    <span className="font-medium">{d.fromProjectName}</span>
                    <span className="text-muted-foreground mx-1">↔</span>
                    <span className="font-medium">{d.toProjectName}</span>
                    <span className={cn('ml-2', d.risk === 'high' ? 'text-rose-600' : d.risk === 'medium' ? 'text-amber-600' : 'text-muted-foreground')}>
                      {d.overlapDays}d overlap
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {grouped.map((g) => (
              <div key={g.programId}>
                <h3 className="text-sm font-semibold text-foreground mb-2">{g.programName}</h3>
                <div className="rounded-xl border bg-card overflow-hidden">
                  {g.projects.map((p) => {
                    const pos = barPosition(p.msdyn_scheduledstart, p.msdyn_finish);
                    return (
                      <button
                        key={p.msdyn_projectid}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors border-b last:border-b-0"
                        onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                      >
                        <span className="w-48 text-sm font-medium text-foreground truncate shrink-0">{p.msdyn_subject}</span>
                        <HealthBadge value={p.proj_overallhealth} />
                        <div className="flex-1 h-5 relative bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="absolute h-full rounded-full bg-primary/70"
                            style={{ left: pos.left, width: pos.width }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">
                          {p.msdyn_scheduledstart ? new Date(p.msdyn_scheduledstart).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
