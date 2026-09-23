import { useNavigate } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { REQUEST_STATUS } from '../../lib/constants';

const STAGES = [
  { key: REQUEST_STATUS.Draft,                 label: 'Draft',                  color: 'bg-slate-500' },
  { key: REQUEST_STATUS.Submitted,             label: 'Submitted',              color: 'bg-blue-500' },
  { key: REQUEST_STATUS.InTriage,              label: 'In Triage',              color: 'bg-amber-500' },
  { key: REQUEST_STATUS.AwaitingClarification, label: 'Awaiting Clarification', color: 'bg-orange-500' },
  { key: REQUEST_STATUS.Approved,              label: 'Approved',               color: 'bg-emerald-500' },
  { key: REQUEST_STATUS.Rejected,              label: 'Rejected',               color: 'bg-red-500' },
  { key: REQUEST_STATUS.RoutedOperational,     label: 'Routed Operational',     color: 'bg-cyan-500' },
  { key: REQUEST_STATUS.Redirected,            label: 'Redirected',             color: 'bg-purple-500' },
  { key: REQUEST_STATUS.Converted,             label: 'Converted',              color: 'bg-primary' },
];

export function PipelinePage() {
  const navigate = useNavigate();
  const { data: requests = [], isLoading, error } = useProjectRequests();

  const stageCounts = STAGES.map((s) => ({
    ...s,
    count: requests.filter((r) => r.pmo_status === s.key).length,
  }));
  const maxCount = Math.max(...stageCounts.map((s) => s.count), 1);
  const totalRequests = requests.length;

  const converted = requests.filter(r => r.pmo_status === REQUEST_STATUS.Converted).length;
  const rejected = requests.filter(r => r.pmo_status === REQUEST_STATUS.Rejected).length;
  const conversionRate = converted + rejected > 0 ? Math.round((converted / (converted + rejected)) * 100) : 0;

  const inTriageRequests = requests.filter(r => r.pmo_status === REQUEST_STATUS.InTriage);
  const avgDaysInTriage = (() => {
    if (inTriageRequests.length === 0) return '—';
    const now = Date.now();
    const totalDays = inTriageRequests.reduce((sum, r) => {
      if (!r.createdon) return sum;
      return sum + Math.max(0, Math.round((now - new Date(r.createdon).getTime()) / (1000 * 60 * 60 * 24)));
    }, 0);
    return Math.round(totalDays / inTriageRequests.length);
  })();

  const aiRouted = requests.filter(r => r.pmo_routingconfidence != null).length;
  const aiRoutedPct = totalRequests > 0 ? Math.round((aiRouted / totalRequests) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Pipeline"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle={`${totalRequests} total request${totalRequests !== 1 ? 's' : ''} across all stages`}
      />
      <ErrorBanner error={error as Error | null} />
      {isLoading ? (
        <LoadingOverlay isLoading label="Loading..." />
      ) : totalRequests === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center max-w-lg">
          <GitBranch className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No intake requests</p>
          <p className="text-xs text-muted-foreground mt-1">Submit a new intake request to see the pipeline.</p>
        </div>
      ) : (
        <>
          <SummaryStrip items={[
            { label: 'Total Requests', value: totalRequests },
            { label: 'Conversion Rate', value: `${conversionRate}%`, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Avg Days in Triage', value: avgDaysInTriage, color: typeof avgDaysInTriage === 'number' && avgDaysInTriage > 7 ? 'text-amber-600 dark:text-amber-400' : undefined },
            { label: 'AI-Routed', value: `${aiRoutedPct}%` },
          ]} />

          <div className="rounded-xl border border-border bg-card p-6 max-w-3xl">
            <div className="space-y-3">
              {stageCounts.map(({ label, count, color }, i) => {
                const pct = (count / maxCount) * 100;
                const prevCount = i > 0 ? stageCounts[i - 1].count : null;
                const convPct = prevCount && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
                return (
                  <div key={label}>
                    {convPct !== null && (
                      <div className="flex justify-end mb-0.5">
                        <span className="text-[10px] text-muted-foreground/60 tabular-nums">{convPct}% of previous</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">{count}</span>
                    </div>
                    <div className="h-8 rounded-lg bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-lg transition-all', color)}
                        style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total requests</span>
              <span className="text-lg font-bold text-foreground tabular-nums">{totalRequests}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Conversion Rate: Converted / (Converted + Rejected)</p>
          </div>
        </>
      )}
    </div>
  );
}
