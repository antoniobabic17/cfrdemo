import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { Input } from '../../components/ui/input';
import { useProjects } from '../../hooks/useProjects';
import { usePrioritizationScoring } from '../../hooks/usePrioritizationScoring';
import { cn } from '../../lib/utils';

export function ScenarioPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading, error } = useProjects();
  const scored = usePrioritizationScoring(projects);
  const [budgetCap, setBudgetCap] = useState('');
  const [capacityHours, setCapacityHours] = useState('');

  const scenario = useMemo(() => {
    const cap = budgetCap ? Number(budgetCap) : Infinity;
    const hrs = capacityHours ? Number(capacityHours) : Infinity;
    let runningBudget = 0;
    let runningEffort = 0;
    return scored.map((s) => {
      const budget = s.project.proj_budget ?? 0;
      const effort = s.project.msdyn_effort ?? 0;
      runningBudget += budget;
      runningEffort += effort;
      const included = runningBudget <= cap && runningEffort <= hrs;
      return { ...s, included, runningBudget, runningEffort };
    });
  }, [scored, budgetCap, capacityHours]);

  const included = scenario.filter((s) => s.included);
  const excluded = scenario.filter((s) => !s.included);
  const totalBudget = scenario.reduce((sum, s) => sum + (s.project.proj_budget ?? 0), 0);
  const totalEffort = scenario.reduce((sum, s) => sum + (s.project.msdyn_effort ?? 0), 0);

  const includedBudget = included.reduce((sum, s) => sum + (s.project.proj_budget ?? 0), 0);
  const includedEffort = included.reduce((sum, s) => sum + (s.project.msdyn_effort ?? 0), 0);
  const excludedBudget = excluded.reduce((sum, s) => sum + (s.project.proj_budget ?? 0), 0);
  const excludedEffort = excluded.reduce((sum, s) => sum + (s.project.msdyn_effort ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Scenario Comparison" subtitle="Compare portfolio options under constrained budget and capacity" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      <SummaryStrip columns={3} items={[
        { label: 'Total Portfolio Budget', value: `$${totalBudget.toLocaleString()}` },
        { label: 'Total Effort', value: `${totalEffort.toLocaleString()}h` },
        { label: 'Projects Scored', value: scenario.length },
      ]} />

      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Budget Cap ($)</label>
          <Input type="number" value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="No limit" className="w-40" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Capacity Cap (hours)</label>
          <Input type="number" value={capacityHours} onChange={(e) => setCapacityHours(e.target.value)} placeholder="No limit" className="w-40" />
        </div>
      </div>

      {(budgetCap || capacityHours) && (
        <p className="text-xs text-muted-foreground">
          {included.length} included: ${includedBudget.toLocaleString()} budget, {includedEffort.toLocaleString()}h effort
          <span className="mx-2">|</span>
          {excluded.length} excluded: ${excludedBudget.toLocaleString()} budget, {excludedEffort.toLocaleString()}h effort
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold text-muted-foreground bg-muted/40 border-b">
            <span className="w-8 text-right">#</span>
            <span className="flex-1">Project</span>
            <span className="w-16 text-right">Score</span>
            <span className="w-24 text-right">Budget</span>
            <span className="w-20 text-right">Effort</span>
            <span className="w-16 text-right">Status</span>
          </div>
          <div className="divide-y">
            {scenario.map((s, i) => (
              <div
                key={s.project.msdyn_projectid}
                onClick={() => navigate(`/projects/${s.project.msdyn_projectid}`)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-sm cursor-pointer hover:bg-muted/30 transition-colors',
                  s.included ? '' : 'opacity-40 bg-muted/20',
                )}
              >
                <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className={cn('flex-1 truncate', s.included ? 'text-foreground font-medium' : 'text-muted-foreground line-through')}>
                  {s.project.msdyn_subject}
                </span>
                <span className="w-16 text-right tabular-nums font-bold">{s.score}</span>
                <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                  ${(s.project.proj_budget ?? 0).toLocaleString()}
                </span>
                <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                  {s.project.msdyn_effort ?? 0}h
                </span>
                <span className={cn('w-16 text-right text-xs tabular-nums', s.included ? 'text-emerald-600' : 'text-rose-500')}>
                  {s.included ? 'IN' : 'OUT'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
