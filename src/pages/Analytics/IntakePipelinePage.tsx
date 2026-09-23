import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { LoadingOverlay } from '../../components/common/LoadingOverlay';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { BarSection } from '../../components/analytics/BarSection';
import { useProjectRequests } from '../../hooks/useProjectRequests';
import { REQUEST_STATUS } from '../../lib/constants';

const STATUS_STAGES = [
  { key: REQUEST_STATUS.Draft,                 label: 'Draft',                  color: 'bg-slate-400' },
  { key: REQUEST_STATUS.Submitted,             label: 'Submitted',              color: 'bg-blue-500' },
  { key: REQUEST_STATUS.InTriage,              label: 'In Triage',              color: 'bg-amber-500' },
  { key: REQUEST_STATUS.AwaitingClarification, label: 'Awaiting Clarification', color: 'bg-orange-500' },
  { key: REQUEST_STATUS.Approved,              label: 'Approved',               color: 'bg-emerald-500' },
  { key: REQUEST_STATUS.Rejected,              label: 'Rejected',               color: 'bg-red-500' },
  { key: REQUEST_STATUS.RoutedOperational,     label: 'Routed Operational',     color: 'bg-cyan-500' },
  { key: REQUEST_STATUS.Redirected,            label: 'Redirected',             color: 'bg-purple-500' },
  { key: REQUEST_STATUS.Converted,             label: 'Converted',              color: 'bg-primary' },
];

const CONFIDENCE_TIERS = [
  { label: 'High (≥70)',    color: 'bg-emerald-500', test: (v: number) => v >= 70 },
  { label: 'Medium (40–69)', color: 'bg-amber-500', test: (v: number) => v >= 40 && v < 70 },
  { label: 'Low (<40)',     color: 'bg-red-500',     test: (v: number) => v < 40 },
];

const OUTCOME_STAGES = [
  { key: REQUEST_STATUS.Approved,          label: 'Approved',            color: 'bg-emerald-500' },
  { key: REQUEST_STATUS.Converted,         label: 'Converted to Project', color: 'bg-primary' },
  { key: REQUEST_STATUS.Rejected,          label: 'Rejected',            color: 'bg-red-500' },
  { key: REQUEST_STATUS.RoutedOperational, label: 'Routed Operational',  color: 'bg-cyan-500' },
  { key: REQUEST_STATUS.Redirected,        label: 'Redirected',          color: 'bg-purple-500' },
];

export function IntakePipelinePage() {
  const navigate = useNavigate();
  const { data: requests = [], isLoading, error } = useProjectRequests();

  const stageCounts = STATUS_STAGES.map((s) => ({
    ...s,
    count: requests.filter((r) => r.pmo_status === s.key).length,
  }));

  const withConfidence = requests.filter((r) => r.pmo_routingconfidence != null);
  const highConfidence = withConfidence.filter((r) => r.pmo_routingconfidence! >= 70).length;
  const highConfidencePct = withConfidence.length > 0 ? Math.round((highConfidence / withConfidence.length) * 100) : 0;

  const terminalStatuses: number[] = [REQUEST_STATUS.Approved, REQUEST_STATUS.Rejected, REQUEST_STATUS.Converted, REQUEST_STATUS.RoutedOperational, REQUEST_STATUS.Redirected];
  const outcomeRate = requests.length > 0 ? Math.round((requests.filter((r) => r.pmo_status != null && terminalStatuses.includes(r.pmo_status)).length / requests.length) * 100) : 0;
  const confidenceBars = [
    ...CONFIDENCE_TIERS.map((t) => ({
      label: t.label,
      color: t.color,
      count: withConfidence.filter((r) => t.test(r.pmo_routingconfidence!)).length,
    })),
    { label: 'Unscored', color: 'bg-slate-400', count: requests.length - withConfidence.length },
  ];

  const outcomeCounts = OUTCOME_STAGES.map((s) => ({
    ...s,
    count: requests.filter((r) => r.pmo_status === s.key).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intake Overview"
        showBack
        onBack={() => navigate('/analytics')}
        subtitle="Status distribution, routing confidence, and outcome breakdown"
      />
      <ErrorBanner error={error as Error | null} />
      {isLoading ? (
        <LoadingOverlay isLoading label="Loading..." />
      ) : (
        <>
          <SummaryStrip columns={4} items={[
            { label: 'Total Requests', value: requests.length },
            { label: 'With AI Routing', value: withConfidence.length },
            { label: 'High Confidence', value: `${highConfidencePct}%`, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Outcome Rate', value: `${outcomeRate}%` },
          ]} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BarSection
              title="Status Funnel"
              bars={stageCounts}
              emptyLabel="No intake requests yet."
            />
            <BarSection
              title="Routing Confidence Distribution"
              bars={confidenceBars}
              emptyLabel="No confidence scores recorded yet."
            />
            <BarSection
              title="Outcome Breakdown"
              bars={outcomeCounts}
              emptyLabel="No terminal outcomes yet."
            />
          </div>
        </>
      )}
    </div>
  );
}
