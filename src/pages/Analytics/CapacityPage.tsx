import { useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, TrendingUp } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { useCapacityData, type CapacityEntry } from '../../hooks/useCapacityData';
import { useNewModelCapacityData, type NewModelCapacityEntry } from '../../hooks/useNewModelCapacityData';
import { cn } from '../../lib/utils';

function CapacityBar({ entry }: { entry: CapacityEntry }) {
  const pct = Math.min(Math.round((entry.totalPlannedHours / 160) * 100), 200);
  const color = entry.isOverallocated ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const tooltip = entry.projectNames.length > 0 ? entry.projectNames.join(', ') : 'No project assignments';
  return (
    <div className="flex items-center gap-3 py-2" title={tooltip}>
      <span className="text-sm font-medium text-foreground w-40 truncate">{entry.resourceName}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={cn('text-xs tabular-nums w-16 text-right', entry.isOverallocated ? 'text-rose-600 font-semibold' : 'text-muted-foreground')}>
        {entry.totalPlannedHours}h
      </span>
      <span className="text-xs text-muted-foreground w-12 text-right">{pct}%</span>
      <span className="text-xs text-muted-foreground w-10 text-right">{entry.projectCount}p</span>
    </div>
  );
}

function NewModelCapacityBar({ entry, capacityHours }: { entry: NewModelCapacityEntry; capacityHours: number }) {
  const pct = Math.min(Math.round((entry.totalContributedHours / capacityHours) * 100), 200);
  const color = entry.isOverallocated ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const tooltip = entry.projectNames.length > 0 ? entry.projectNames.join(', ') : 'No contributed hours';
  return (
    <div className="flex items-center gap-3 py-2" title={tooltip}>
      <span className="text-sm font-medium text-foreground w-40 truncate">{entry.userName}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={cn('text-xs tabular-nums w-16 text-right', entry.isOverallocated ? 'text-rose-600 font-semibold' : 'text-muted-foreground')}>
        {entry.totalContributedHours}h
      </span>
      <span className="text-xs text-muted-foreground w-12 text-right">{pct}%</span>
      <span className="text-xs text-muted-foreground w-10 text-right">{entry.projectCount}p</span>
    </div>
  );
}

export function CapacityPage() {
  const navigate = useNavigate();
  const { entries, recommendations, isLoading, overallocatedCount, totalResources } = useCapacityData();
  const { entries: nrmEntries, capacityHours: nrmCapacityHours, overallocatedCount: nrmOverallocated,
          totalUsers: nrmTotalUsers, hasNewModelProjects, isLoading: nrmLoading } = useNewModelCapacityData();

  return (
    <div className="space-y-6">
      <PageHeader title="Capacity" subtitle="Resource demand vs. capacity across the portfolio" showBack onBack={() => navigate('/analytics')} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading capacity data...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{totalResources}</p>
              <p className="text-xs text-muted-foreground">Assigned Resources</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className={cn('text-2xl font-bold', overallocatedCount > 0 ? 'text-rose-600' : 'text-emerald-600')}>{overallocatedCount}</p>
              <p className="text-xs text-muted-foreground">Over-allocated</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-2xl font-bold text-foreground">{recommendations.length}</p>
              <p className="text-xs text-muted-foreground">Recommendations</p>
            </div>
          </div>

          {recommendations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" />
                Recommendations
              </h3>
              <div className="space-y-2">
                {recommendations.map((r) => (
                  <div
                    key={r.resourceId}
                    className={cn(
                      'rounded-lg border p-3 text-sm',
                      r.type === 'overloaded' ? 'border-rose-200 bg-rose-50/50 dark:bg-rose-950/20' : 'border-blue-200 bg-blue-50/50 dark:bg-blue-950/20',
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <AlertTriangle className={cn('h-3.5 w-3.5', r.type === 'overloaded' ? 'text-rose-500' : 'text-blue-500')} />
                      <span className="font-medium">{r.resourceName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Resource Allocation</h3>
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-3 pb-2 mb-2 border-b text-xs text-muted-foreground font-medium">
                <span className="w-40">Resource</span>
                <span className="flex-1">Utilization (160h = 100%)</span>
                <span className="w-16 text-right">Hours</span>
                <span className="w-12 text-right">%</span>
                <span className="w-10 text-right">Proj</span>
              </div>
              {entries.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground text-center">No resource assignments found. Assign resources to project tasks to see capacity data.</p>
              ) : (
                entries.map((e) => <CapacityBar key={e.resourceId} entry={e} />)
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Based on 160 hours/month per resource</p>

          {/* New Resource Model section — side-by-side, never blended with the above. */}
          <div className="border-t border-border/60 pt-6 mt-6">
            <h2 className="text-base font-semibold text-foreground mb-1">New Resource Model — Contributed Hours</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Based on per-assignee contributed hours (pmo_taskassignment) across all projects with the New Resource Model enabled.
              Denominator: {nrmCapacityHours}h/month.
              {!hasNewModelProjects && ' No projects have the New Resource Model enabled yet.'}
            </p>
            {nrmLoading ? (
              <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /><span className="text-sm text-muted-foreground">Loading…</span></div>
            ) : !hasNewModelProjects ? (
              <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground text-center py-6">
                Enable the New Resource Model on a project (Project Detail → Financials → Resourcing → Enable New Resource Model) to track contributed hours here.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-2xl font-bold text-foreground">{nrmTotalUsers}</p>
                    <p className="text-xs text-muted-foreground">Contributors</p>
                  </div>
                  <div className="rounded-lg border bg-card p-4">
                    <p className={cn('text-2xl font-bold', nrmOverallocated > 0 ? 'text-rose-600' : 'text-emerald-600')}>{nrmOverallocated}</p>
                    <p className="text-xs text-muted-foreground">Over-allocated</p>
                  </div>
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-2xl font-bold text-foreground">{nrmCapacityHours}h</p>
                    <p className="text-xs text-muted-foreground">Capacity/month</p>
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-3 pb-2 mb-2 border-b text-xs text-muted-foreground font-medium">
                    <span className="w-40">Contributor</span>
                    <span className="flex-1">Utilization ({nrmCapacityHours}h = 100%)</span>
                    <span className="w-16 text-right">Hours</span>
                    <span className="w-12 text-right">%</span>
                    <span className="w-10 text-right">Proj</span>
                  </div>
                  {nrmEntries.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground text-center">No contributed hours recorded yet. Add hours in the assignee section of any task on a New Resource Model project.</p>
                  ) : (
                    nrmEntries.map((e) => <NewModelCapacityBar key={e.userId} entry={e} capacityHours={nrmCapacityHours} />)
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
