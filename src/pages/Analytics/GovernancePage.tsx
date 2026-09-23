import { useState } from 'react';
import { Loader2, ShieldAlert, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { SummaryStrip } from '../../components/analytics/SummaryStrip';
import { useQuery } from '@tanstack/react-query';
import * as dv from '../../lib/dataverseClient';
import { ENTITY_SETS, GATE_STATUS, GATE_TYPE } from '../../lib/constants';
import { cn } from '../../lib/utils';
import type { ProjectGate } from '../../models/projectGate.model';
import { fmtDateOnly } from '../../lib/dateOnly';

const GATE_FIELDS: (keyof ProjectGate)[] = [
  'pmo_projectgateid', 'pmo_name', 'pmo_gatetype', 'pmo_gateorder',
  'pmo_status', 'pmo_targetdate', 'pmo_completeddate', 'pmo_notes',
  'statecode', '_pmo_project_value', '_pmo_owner_value',
];

function useAllGates() {
  return useQuery({
    queryKey: ['allProjectGates'],
    queryFn: () => dv.list<ProjectGate>(ENTITY_SETS.projectGate, {
      $select: GATE_FIELDS,
      $filter: 'statecode eq 0',
      $orderby: 'pmo_targetdate asc',
    }),
    // Refetch on tab entry so gate approvals recorded elsewhere appear at once.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

const GATE_TYPE_FILTERS = [
  { label: 'All', value: 'all' as const },
  { label: 'Initiation', value: GATE_TYPE.Initiation },
  { label: 'Planning', value: GATE_TYPE.Planning },
  { label: 'Execution', value: GATE_TYPE.Execution },
  { label: 'Closeout', value: GATE_TYPE.Closeout },
];

const gateTypeLabel = (v: number) =>
  v === GATE_TYPE.Initiation ? 'Initiation' :
  v === GATE_TYPE.Planning ? 'Planning' :
  v === GATE_TYPE.Execution ? 'Execution' :
  v === GATE_TYPE.Closeout ? 'Closeout' : 'Unknown';

const statusMeta = (v: number) =>
  v === GATE_STATUS.Passed ? { label: 'Passed', cls: 'text-emerald-600', icon: CheckCircle2 } :
  v === GATE_STATUS.Failed ? { label: 'Failed', cls: 'text-rose-600', icon: XCircle } :
  v === GATE_STATUS.InProgress ? { label: 'In Progress', cls: 'text-blue-600', icon: Clock } :
  v === GATE_STATUS.Waived ? { label: 'Waived', cls: 'text-muted-foreground', icon: CheckCircle2 } :
  { label: 'Not Started', cls: 'text-muted-foreground', icon: Clock };

export function GovernancePage() {
  const navigate = useNavigate();
  const { data: gates = [], isLoading, error } = useAllGates();
  const [typeFilter, setTypeFilter] = useState<'all' | number>('all');

  const passed = gates.filter((g) => g.pmo_status === GATE_STATUS.Passed || g.pmo_status === GATE_STATUS.Waived);
  const completionRate = gates.length > 0 ? Math.round((passed.length / gates.length) * 100) : 0;

  const overdue = gates.filter(
    (g) => g.pmo_targetdate && new Date(g.pmo_targetdate) < new Date() &&
      g.pmo_status !== GATE_STATUS.Passed && g.pmo_status !== GATE_STATUS.Waived,
  );
  const pending = gates.filter(
    (g) => g.pmo_status === GATE_STATUS.NotStarted || g.pmo_status === GATE_STATUS.InProgress,
  );
  const failed = gates.filter((g) => g.pmo_status === GATE_STATUS.Failed);

  const filteredGates = typeFilter === 'all' ? gates : gates.filter((g) => g.pmo_gatetype === typeFilter);

  return (
    <div className="space-y-6">
      <PageHeader title="Governance" subtitle="Portfolio-level gate readiness and approvals" showBack onBack={() => navigate('/analytics')} />
      <ErrorBanner error={error as Error | null} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading governance data...</span>
        </div>
      ) : (
        <>
          <SummaryStrip columns={5} items={[
            { label: 'Total Gates', value: gates.length },
            { label: 'Completion Rate', value: `${completionRate}%`, color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Overdue', value: overdue.length, color: overdue.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground' },
            { label: 'Pending', value: pending.length, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Failed', value: failed.length, color: failed.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground' },
          ]} />

          {overdue.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-rose-600 mb-2 flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" />
                Overdue Gates ({overdue.length})
              </h3>
              <div className="space-y-2">
                {overdue.map((g) => {
                  const sm = statusMeta(g.pmo_status);
                  return (
                    <button
                      key={g.pmo_projectgateid}
                      className="w-full text-left rounded-lg border border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-900 p-3 hover:bg-rose-100/50 transition-colors"
                      onClick={() => g['_pmo_project_value'] && navigate(`/projects/${g['_pmo_project_value']}`)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{g.pmo_name}</span>
                        <span className="text-xs text-muted-foreground">{gateTypeLabel(g.pmo_gatetype)}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className={sm.cls}>{sm.label}</span>
                        {g['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] && (
                          <span>{g['_pmo_project_value@OData.Community.Display.V1.FormattedValue']}</span>
                        )}
                        {g.pmo_targetdate && <span>Due: {fmtDateOnly(g.pmo_targetdate)}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">All Gates ({filteredGates.length})</h3>
              <div className="flex gap-1.5">
                {GATE_TYPE_FILTERS.map((f) => (
                  <button
                    key={String(f.value)}
                    onClick={() => setTypeFilter(f.value)}
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                      typeFilter === f.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border divide-y overflow-hidden">
              {filteredGates.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {gates.length === 0 ? 'No governance gates defined. Gates are created on project detail pages to track lifecycle approvals.' : 'No gates match this filter.'}
                </div>
              ) : (
                filteredGates.map((g) => {
                  const sm = statusMeta(g.pmo_status);
                  const Icon = sm.icon;
                  return (
                    <button
                      key={g.pmo_projectgateid}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3"
                      onClick={() => g['_pmo_project_value'] && navigate(`/projects/${g['_pmo_project_value']}`)}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${sm.cls}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{g.pmo_name}</span>
                          <span className="text-xs text-muted-foreground">{gateTypeLabel(g.pmo_gatetype)}</span>
                        </div>
                        {g['_pmo_project_value@OData.Community.Display.V1.FormattedValue'] && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{g['_pmo_project_value@OData.Community.Display.V1.FormattedValue']}</p>
                        )}
                      </div>
                      <span className={`text-xs shrink-0 ${sm.cls}`}>{sm.label}</span>
                      {g.pmo_targetdate && (
                        <span className="text-xs text-muted-foreground shrink-0">{fmtDateOnly(g.pmo_targetdate)}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Completion Rate: Passed or Waived / total gates</p>
        </>
      )}
    </div>
  );
}
