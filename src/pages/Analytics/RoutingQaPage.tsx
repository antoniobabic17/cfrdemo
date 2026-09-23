import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { REQUEST_STATUS } from '../../lib/constants';
import { fmtDateOnly } from '../../lib/dateOnly';

const STATUS_LABELS: Record<number, string> = {
  [REQUEST_STATUS.Draft]:                 'Draft',
  [REQUEST_STATUS.Submitted]:             'Submitted',
  [REQUEST_STATUS.InTriage]:              'In Triage',
  [REQUEST_STATUS.Approved]:              'Approved',
  [REQUEST_STATUS.Rejected]:              'Rejected',
  [REQUEST_STATUS.Converted]:             'Converted',
  [REQUEST_STATUS.AwaitingClarification]: 'Awaiting Clarification',
  [REQUEST_STATUS.RoutedOperational]:     'Routed Operational',
  [REQUEST_STATUS.Redirected]:            'Redirected',
};

type ConfidenceTier = 'all' | 'high' | 'medium' | 'low';

function confidenceTier(v: number | null | undefined): 'high' | 'medium' | 'low' | null {
  if (v == null) return null;
  if (v >= 70) return 'high';
  if (v >= 40) return 'medium';
  return 'low';
}

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const tier = confidenceTier(value);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tier === 'high'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : tier === 'medium'
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      )}
    >
      {value}%
    </span>
  );
}

export function RoutingQaPage() {
  const navigate = useNavigate();
  const [tier, setTier] = useState<ConfidenceTier>('all');
  const { data: requests = [], isLoading, error } = useProjectRequests();

  const routed = requests.filter(
    (r) => r.pmo_routingconfidence != null || r.pmo_routingrecommendation
  );
  const filtered =
    tier === 'all'
      ? routed
      : routed.filter((r) => confidenceTier(r.pmo_routingconfidence) === tier);

  const withConfidence = routed.filter((r) => r.pmo_routingconfidence != null);
  const avgConfidence = withConfidence.length > 0 ? Math.round(withConfidence.reduce((s, r) => s + r.pmo_routingconfidence!, 0) / withConfidence.length) : 0;
  const highPct = withConfidence.length > 0 ? Math.round((withConfidence.filter((r) => r.pmo_routingconfidence! >= 70).length / withConfidence.length) * 100) : 0;

  const TIERS: { label: string; value: ConfidenceTier }[] = [
    { label: 'All', value: 'all' },
    { label: 'High (≥70)', value: 'high' },
    { label: 'Medium (40–69)', value: 'medium' },
    { label: 'Low (<40)', value: 'low' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Routing QA"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle={`${routed.length} request${routed.length !== 1 ? 's' : ''} with AI routing applied`}
      />
      <ErrorBanner error={error as Error | null} />
      {isLoading ? (
        <LoadingOverlay isLoading label="Loading..." />
      ) : routed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center max-w-lg">
          <Bot className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No AI-routed requests</p>
          <p className="text-xs text-muted-foreground mt-1">
            Routing confidence scores appear here after Mira processes intake submissions.
          </p>
        </div>
      ) : (
        <>
          <SummaryStrip columns={3} items={[
            { label: 'AI-Routed Requests', value: routed.length },
            { label: 'Avg Confidence', value: `${avgConfidence}%` },
            { label: 'High Confidence', value: `${highPct}%`, color: 'text-emerald-600 dark:text-emerald-400' },
          ]} />

          <div className="flex gap-2 flex-wrap">
            {TIERS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTier(t.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  tier === t.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Request</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Confidence</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">AI Recommendation</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No requests match this filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.pmo_projectrequestid} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 max-w-[200px] truncate">
                        <span
                          className="font-medium text-primary hover:underline cursor-pointer"
                          onClick={() => navigate(`/intake/${r.pmo_projectrequestid}`)}
                        >
                          {r.pmo_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {fmtDateOnly(r.createdon)}
                      </td>
                      <td className="px-4 py-3">
                        <ConfidenceBadge value={r.pmo_routingconfidence} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate" title={r.pmo_routingrecommendation ?? undefined}>
                        {r.pmo_routingrecommendation ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {r.pmo_status != null ? (STATUS_LABELS[r.pmo_status] ?? '—') : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
