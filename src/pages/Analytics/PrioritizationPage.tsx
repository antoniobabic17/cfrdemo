import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjects } from '../../hooks/useProjects';
import { usePrioritizationScoring } from '../../hooks/usePrioritizationScoring';
import { usePrioritizationWeights } from '../../providers/ConfigurationProvider';
import { cn } from '../../lib/utils';

export function PrioritizationPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading, error } = useProjects();
  const scored = usePrioritizationScoring(projects);
  const weights = usePrioritizationWeights();

  const highCount = scored.filter(s => s.score >= 60).length;
  const medCount = scored.filter(s => s.score >= 30 && s.score < 60).length;
  const lowCount = scored.filter(s => s.score < 30).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Prioritization" subtitle="Portfolio prioritization scoring across active projects" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading projects...</span>
        </div>
      ) : (
        <>
          {/* Score Distribution */}
          <SummaryStrip columns={3} items={[
            { label: 'High (≥60)', value: highCount, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Medium (30–59)', value: medCount, color: 'text-amber-600 dark:text-amber-400' },
            { label: 'Low (<30)', value: lowCount, color: 'text-rose-600 dark:text-rose-400' },
          ]} />

          {/* Scoring Legend */}
          <div className="rounded-lg border border-border bg-card px-5 py-3">
            <div className="flex items-center flex-wrap gap-x-6 gap-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Weights:</span>
              <span className="text-xs text-foreground">Strategic Priority <span className="font-bold tabular-nums">{weights.strategicPriority}%</span></span>
              <span className="text-xs text-foreground">Complexity <span className="font-bold tabular-nums">{weights.complexity}%</span></span>
              <span className="text-xs text-foreground">Health <span className="font-bold tabular-nums">{weights.health}%</span></span>
              <span className="text-xs text-foreground">Budget <span className="font-bold tabular-nums">{weights.budget}%</span></span>
              <span className="text-xs text-foreground">Progress <span className="font-bold tabular-nums">{weights.progress}%</span></span>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Weights are configurable in Admin Settings.</p>
          </div>

          {/* Ranked Table */}
          <div className="rounded-xl border divide-y overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground">
              <span className="w-8 text-right">#</span>
              <span className="flex-1">Project</span>
              <span className="w-16 text-right">Score</span>
              <span className="w-20 text-right" title="Weighted score from project strategic priority classification">Strategic</span>
              <span className="w-20 text-right" title="Weighted score from project complexity level">Complexity</span>
              <span className="w-20 text-right" title="Weighted score from overall project health status">Health</span>
              <span className="w-20 text-right" title="Weighted score based on project budget tier">Budget</span>
              <span className="w-20 text-right" title="Weighted score from current project progress">Progress</span>
            </div>
            {scored.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No active projects to score.</div>
            ) : (
              scored.map((s, i) => (
                <button
                  key={s.project.msdyn_projectid}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/projects/${s.project.msdyn_projectid}`)}
                >
                  <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{s.project.msdyn_subject}</span>
                  <span className={cn('w-16 text-right text-sm font-bold tabular-nums', s.score >= 60 ? 'text-emerald-600' : s.score >= 30 ? 'text-amber-600' : 'text-rose-600')}>
                    {s.score}
                  </span>
                  {s.factors.map((f) => (
                    <span key={f.label} className="w-20 text-right text-xs text-muted-foreground tabular-nums">{f.weighted}</span>
                  ))}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
