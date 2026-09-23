/**
 * UatPaceChart — the expected and actual curves, and one word for whether that is good.
 *
 * **The indicator is the point, not the chart.** A curve tells someone who studies it; a project
 * manager scanning a portfolio needs "Behind" in a word. So the state label is rendered beside
 * the chart at full size, and the chart supports it rather than replacing it.
 *
 * **Rollups are per project and then summed** — never one org-wide query, which would hit the
 * 50,000-record aggregate ceiling and return a silently truncated answer that looks like a
 * number. `portfolioPace` does the summing over rows the caller read per project, and bypassed
 * projects are excluded (T046).
 *
 * **No PSS entity is read anywhere in this path.** Pace comes from UAT cycles and UAT test cases
 * only; a test asserts the absence, because reaching for `msdyn_project` here is exactly the
 * coupling the custom data source exists to remove.
 */
import { useMemo } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import {
  cyclePace,
  portfolioPace,
  PACE_STATE_LABELS,
  type PaceCycle,
  type PaceState,
  type PaceTestCase,
  type ProjectPaceInput,
} from '../lib/uatPace';

const STATE_VISUAL: Record<PaceState, { Icon: typeof TrendingUp; className: string }> = {
  ahead: { Icon: TrendingUp, className: 'text-emerald-700' },
  'on-track': { Icon: Minus, className: 'text-emerald-700' },
  behind: { Icon: TrendingDown, className: 'text-amber-700' },
  overdue: { Icon: AlertTriangle, className: 'text-rose-700' },
  complete: { Icon: CheckCircle2, className: 'text-emerald-700' },
  'not-started': { Icon: CircleDashed, className: 'text-muted-foreground' },
  'no-dates': { Icon: CircleDashed, className: 'text-muted-foreground' },
};

/** The state word and its icon — shared by the cycle chart and the portfolio rows. */
export function PaceIndicator({ state, detail }: { state: PaceState; detail?: string }) {
  const { Icon, className } = STATE_VISUAL[state];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${className}`} data-testid="uat-pace-indicator">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {PACE_STATE_LABELS[state]}
      {detail && <span className="text-muted-foreground font-normal">· {detail}</span>}
    </span>
  );
}

export interface UatPaceChartProps {
  cycle: PaceCycle;
  cases: readonly PaceTestCase[];
  /** The day to measure against. Passed in so the calculation is testable. */
  today: string;
}

export function UatPaceChart({ cycle, cases, today }: UatPaceChartProps) {
  const pace = useMemo(() => cyclePace(cycle, cases, today), [cycle, cases, today]);

  const detail = pace.expected === null
    ? undefined
    : `${pace.completed} of ${pace.total} done, ${pace.expected} expected by today`;

  return (
    <div className="space-y-3" data-testid="uat-pace-chart">
      <PaceIndicator state={pace.state} detail={detail} />

      {pace.curve.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {pace.state === 'no-dates'
            ? 'This cycle has no planned start and end, so there is no schedule to measure against.'
            : 'Every test case in this cycle is done.'}
        </p>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pace.curve} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone" dataKey="expected" name="Expected"
                stroke="currentColor" className="text-muted-foreground" dot={false}
              />
              {/* connectNulls stays FALSE: the actual line must stop at today rather than being
                  drawn across the future, which would read as a forecast nobody made. */}
              <Line
                type="monotone" dataKey="actual" name="Actual"
                stroke="currentColor" className="text-primary" dot={false} connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export interface UatPortfolioPaceProps {
  projects: readonly ProjectPaceInput[];
  today: string;
  onProjectClick?: (projectId: string) => void;
  /** Project id → display name, so the rollup does not have to read a project table itself. */
  projectNames?: Readonly<Record<string, string>>;
}

/**
 * The dashboard rollup: one row per project, summed here from per-project rows.
 *
 * Names are passed IN rather than looked up, so this component reads no project table at all —
 * which is what keeps the pace path free of any PSS entity.
 */
export function UatPortfolioPace({
  projects, today, onProjectClick, projectNames = {},
}: UatPortfolioPaceProps) {
  const portfolio = useMemo(() => portfolioPace(projects, today), [projects, today]);

  if (portfolio.projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {portfolio.excludedProjectIds.length > 0
          ? 'Every project here has bypassed UAT, so there is no pace to report.'
          : 'No projects with UAT cycles yet.'}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="uat-portfolio-pace">
      <p className="text-sm">
        <span className="tabular-nums font-semibold">{portfolio.completed}</span> of{' '}
        <span className="tabular-nums font-semibold">{portfolio.total}</span> test cases done
        across {portfolio.projects.length} project{portfolio.projects.length === 1 ? '' : 's'},{' '}
        <span className="tabular-nums">{portfolio.expected}</span> expected by today.
      </p>
      {portfolio.excludedProjectIds.length > 0 && (
        <p className="text-xs text-amber-700" role="status">
          {portfolio.excludedProjectIds.length} project
          {portfolio.excludedProjectIds.length === 1 ? '' : 's'} bypassed UAT and{' '}
          {portfolio.excludedProjectIds.length === 1 ? 'is' : 'are'} not counted.
        </p>
      )}

      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm" data-testid="uat-portfolio-rows">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2">Project</th>
              <th className="text-left px-3 py-2 w-44">Pace</th>
              <th className="text-right px-3 py-2 w-24">Done</th>
              <th className="text-right px-3 py-2 w-24">Expected</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.projects.map((project) => (
              <tr
                key={project.projectId}
                className={`border-t border-border ${onProjectClick ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                onClick={() => onProjectClick?.(project.projectId)}
              >
                <td className="px-3 py-1.5">
                  {projectNames[project.projectId] ?? project.projectId}
                </td>
                <td className="px-3 py-1.5"><PaceIndicator state={project.state} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {project.completed} / {project.total}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{project.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default UatPaceChart;
