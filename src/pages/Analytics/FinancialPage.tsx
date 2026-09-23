import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjects } from '../../hooks/useProjects';
import { cn } from '../../lib/utils';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function FinancialPage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading, error } = useProjects();

  const active = projects.filter((p) => p.statecode === 0);
  const totalBudget = active.reduce((s, p) => s + (p.proj_budget ?? 0), 0);
  const totalForecast = active.reduce((s, p) => s + (p.proj_forecast ?? 0), 0);
  const totalActual = active.reduce((s, p) => s + (p.proj_actualcost ?? 0), 0);
  const totalBenefits = active.reduce((s, p) => s + (p.proj_benefits ?? 0), 0);
  const budgetVariance = totalBudget - totalForecast;
  const utilization = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

  const chartData = useMemo(() =>
    active
      .filter(p => p.proj_budget != null || p.proj_actualcost != null)
      .sort((a, b) => (b.proj_budget ?? 0) - (a.proj_budget ?? 0))
      .slice(0, 10)
      .map(p => ({
        name: (p.msdyn_subject ?? '').length > 20 ? p.msdyn_subject.substring(0, 20) + '...' : p.msdyn_subject,
        Budget: p.proj_budget ?? 0,
        Actual: p.proj_actualcost ?? 0,
      })),
    [active],
  );
  const showChartNote = active.filter(p => p.proj_budget != null || p.proj_actualcost != null).length > 10;

  return (
    <div className="space-y-6">
      <PageHeader title="Financials" subtitle="Portfolio cost and budget visibility across active projects" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          <SummaryStrip columns={3} items={[
            { label: 'Total Budget', value: fmt.format(totalBudget) },
            { label: 'Total Forecast', value: fmt.format(totalForecast) },
            { label: 'Total Actual', value: fmt.format(totalActual) },
            { label: 'Variance', value: fmt.format(budgetVariance), color: budgetVariance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400' },
            { label: 'Utilization', value: `${utilization}%`, color: utilization > 100 ? 'text-rose-600 dark:text-rose-400' : undefined },
            { label: 'Total Benefits', value: fmt.format(totalBenefits) },
          ]} />

          {/* Budget vs Actual Chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4">Budget vs Actual Spend</h3>
              <div style={{ height: Math.max(240, chartData.length * 36) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 140, right: 20, top: 8, bottom: 8 }}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={135}
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    />
                    <Tooltip
                      formatter={(value: number) => fmt.format(value)}
                      contentStyle={{
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--color-foreground)',
                      }}
                    />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                    <Bar dataKey="Budget" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Actual" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {showChartNote && <p className="text-xs text-muted-foreground mt-2">Showing top 10 projects by budget.</p>}
            </div>
          )}

          {/* Per-project table */}
          <div className="rounded-xl border divide-y overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 text-xs font-medium text-muted-foreground">
              <span className="flex-1">Project</span>
              <span className="w-24 text-right">Budget</span>
              <span className="w-24 text-right">Forecast</span>
              <span className="w-24 text-right">Actual</span>
              <span className="w-24 text-right">Variance</span>
              <span className="w-20 text-right">Benefits</span>
            </div>
            {active.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No active projects.</div>
            ) : (
              active.map((p) => {
                const variance = (p.proj_budget ?? 0) - (p.proj_forecast ?? 0);
                return (
                  <button
                    key={p.msdyn_projectid}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-sm"
                    onClick={() => navigate(`/projects/${p.msdyn_projectid}`)}
                  >
                    <span className="flex-1 font-medium text-foreground truncate">{p.msdyn_subject}</span>
                    <span className="w-24 text-right text-muted-foreground tabular-nums">{p.proj_budget != null ? fmt.format(p.proj_budget) : '—'}</span>
                    <span className="w-24 text-right text-muted-foreground tabular-nums">{p.proj_forecast != null ? fmt.format(p.proj_forecast) : '—'}</span>
                    <span className="w-24 text-right text-muted-foreground tabular-nums">{p.proj_actualcost != null ? fmt.format(p.proj_actualcost) : '—'}</span>
                    <span className={cn('w-24 text-right tabular-nums font-medium', variance >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {p.proj_budget != null ? fmt.format(variance) : '—'}
                    </span>
                    <span className="w-20 text-right text-muted-foreground tabular-nums">{p.proj_benefits != null ? fmt.format(p.proj_benefits) : '—'}</span>
                  </button>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">Utilization: Actual spend / total budget</p>
        </>
      )}
    </div>
  );
}
