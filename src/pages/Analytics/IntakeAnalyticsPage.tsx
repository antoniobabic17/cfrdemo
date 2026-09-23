import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock, ArrowRightLeft, AlertTriangle, TrendingUp, Filter } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { REQUEST_STATUS } from '../../lib/constants';
import type { ApprovalAction } from '../../lib/intakeValidation';
import { cn } from '../../lib/utils';

const STATUS_LABELS: Record<number, string> = {
  [REQUEST_STATUS.Draft]: 'Draft',
  [REQUEST_STATUS.Submitted]: 'Submitted',
  [REQUEST_STATUS.InTriage]: 'In Triage',
  [REQUEST_STATUS.Approved]: 'Approved',
  [REQUEST_STATUS.Rejected]: 'Rejected',
  [REQUEST_STATUS.Converted]: 'Converted',
  [REQUEST_STATUS.AwaitingClarification]: 'Awaiting Clarification',
  [REQUEST_STATUS.RoutedOperational]: 'Routed Operational',
  [REQUEST_STATUS.Redirected]: 'Redirected',
};

function parseChain(json: string | undefined): ApprovalAction[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)));
}

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('h-4 w-4', color)} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export function IntakeAnalyticsPage() {
  const navigate = useNavigate();
  const { data: requests = [], isPending } = useProjectRequests();

  const analytics = useMemo(() => {
    const active = requests.filter((r) =>
      r.pmo_status !== REQUEST_STATUS.Converted &&
      r.pmo_status !== REQUEST_STATUS.Rejected &&
      r.pmo_status !== REQUEST_STATUS.RoutedOperational &&
      r.pmo_status !== REQUEST_STATUS.Redirected,
    );

    const byStatus: Record<string, number> = {};
    for (const r of requests) {
      const label = STATUS_LABELS[r.pmo_status ?? 0] ?? 'Unknown';
      byStatus[label] = (byStatus[label] ?? 0) + 1;
    }

    const converted = requests.filter((r) => r.pmo_status === REQUEST_STATUS.Converted).length;
    const rejected = requests.filter((r) => r.pmo_status === REQUEST_STATUS.Rejected).length;
    const conversionRate = converted + rejected > 0 ? Math.round((converted / (converted + rejected)) * 100) : 0;

    const governedRequests = requests.filter((r) => r['_pmo_intakeworkflowid_value']);
    const chains = governedRequests.map((r) => parseChain(r.pmo_approvalchain));

    let totalApprovalTime = 0;
    let approvalCount = 0;
    let sendBackCount = 0;
    let totalActions = 0;

    for (const chain of chains) {
      for (let i = 0; i < chain.length; i++) {
        const action = chain[i];
        totalActions++;
        if (action.action === 'approved') {
          approvalCount++;
          const prevSubmit = [...chain].reverse().find(
            (a, idx) => idx > chain.length - 1 - i && (a.action === 'resubmitted' || a.stageOrder < action.stageOrder),
          );
          if (prevSubmit) {
            totalApprovalTime += daysBetween(prevSubmit.timestamp, action.timestamp);
          }
        }
        if (action.action === 'sent_back') {
          sendBackCount++;
        }
      }
    }

    const avgApprovalDays = approvalCount > 0 ? (totalApprovalTime / approvalCount).toFixed(1) : '—';
    const sendBackRate = totalActions > 0 ? Math.round((sendBackCount / totalActions) * 100) : 0;

    const stalledRequests = active.filter((r) => {
      if (!r.modifiedon) return false;
      return daysBetween(r.modifiedon, new Date().toISOString()) > 10;
    });

    const byStage: Record<number, number> = {};
    for (const r of active) {
      if (r.pmo_currentstagenumber != null) {
        byStage[r.pmo_currentstagenumber] = (byStage[r.pmo_currentstagenumber] ?? 0) + 1;
      }
    }

    return {
      totalActive: active.length,
      totalAll: requests.length,
      byStatus,
      conversionRate,
      avgApprovalDays,
      sendBackRate,
      sendBackCount,
      approvalCount,
      stalledRequests,
      byStage,
      governedCount: governedRequests.length,
    };
  }, [requests]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intake Analytics"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle="Governed intake analytics and governance reporting"
      />

      {isPending ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground justify-center">
          <Clock className="h-4 w-4 animate-spin" />Loading analytics...
        </div>
      ) : (
        <>
          {/* Pipeline overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Active Requests" value={analytics.totalActive} sub={`of ${analytics.totalAll} total`} icon={BarChart3} color="text-primary" />
            <MetricCard label="Conversion Rate" value={`${analytics.conversionRate}%`} sub="Converted / (Converted + Rejected)" icon={TrendingUp} color="text-emerald-500" />
            <MetricCard label="Avg Approval Time" value={`${analytics.avgApprovalDays}d`} sub="Average days between submission and approval per stage" icon={Clock} color="text-blue-500" />
            <MetricCard label="Send-Back Rate" value={`${analytics.sendBackRate}%`} sub="Percentage of all approval actions that were send-backs" icon={ArrowRightLeft} color="text-amber-500" />
          </div>

          {/* Status breakdown */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Requests by Status</h3>
            <div className="space-y-2">
              {Object.entries(analytics.byStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => {
                  const pct = analytics.totalAll > 0 ? Math.round((count / analytics.totalAll) * 100) : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-32 text-right">{status}</span>
                      <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-foreground w-12 text-right">{count}</span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Stage distribution */}
          {Object.keys(analytics.byStage).length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Active Requests by Stage</h3>
              <div className="flex items-end gap-4">
                {Object.entries(analytics.byStage)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([stage, count]) => (
                    <div key={stage} className="flex flex-col items-center gap-1">
                      <span className="text-sm font-bold text-foreground">{count}</span>
                      <div className="w-10 bg-primary/60 rounded-t" style={{ height: `${Math.max(20, count * 20)}px` }} />
                      <span className="text-xs text-muted-foreground">Stage {Number(stage) + 1}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Stalled requests */}
          {analytics.stalledRequests.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/30 dark:bg-amber-950/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-amber-700">Stalled Requests ({analytics.stalledRequests.length})</h3>
                <span className="text-xs text-amber-600">No activity for 10+ business days</span>
              </div>
              <div className="space-y-2">
                {analytics.stalledRequests.map((r) => (
                  <div key={r.pmo_projectrequestid} className="flex items-center gap-3 text-sm">
                    <button
                      onClick={() => navigate(`/intake/${r.pmo_projectrequestid}`)}
                      className="text-primary hover:underline font-medium text-left"
                    >
                      {r.pmo_autonumber ?? r.pmo_name}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Stage {(r.pmo_currentstagenumber ?? 0) + 1}
                    </span>
                    <span className="text-xs text-amber-600">
                      {r.modifiedon ? `${daysBetween(r.modifiedon, new Date().toISOString())} days` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Governed intake info */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {analytics.governedCount} of {analytics.totalAll} requests use governed intake workflows.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
