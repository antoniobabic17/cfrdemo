/**
 * T053 — the pace chart and the project rollup.
 *
 * **The indicator carries the answer, not the chart.** A curve tells someone who studies it; a
 * manager scanning a portfolio needs "Behind" in a word. So the tests assert the WORD, and a
 * chart-only implementation would fail them.
 *
 * **The rollup is per project and then summed, and the numbers here are added up by hand.** An
 * org-wide aggregate would hit the 50,000-record ceiling and return a silently truncated answer
 * that looks like a number, so the arithmetic happens in `uatPace.ts` over rows the caller read.
 *
 * **No PSS entity is read.** A source scan asserts it, because reaching for `msdyn_project` in
 * the pace path is exactly the coupling the custom data source exists to remove.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UatPaceChart, UatPortfolioPace, PaceIndicator } from './UatPaceChart';
import { PACE_STATE_LABELS, type PaceTestCase } from '../lib/uatPace';
import { UAT_EXECUTION_STATUS } from '../../../lib/uatOptionSets';

/**
 * Recharts needs real layout: jsdom reports its container as 0×0, so an SVG is never drawn and
 * the legend text never appears. Drawing is recharts' concern. What matters here is that the
 * component asks for BOTH series over the right data, so `Line` is stubbed to record its props
 * and `ResponsiveContainer` is given a size.
 */
const lineProps: Record<string, unknown>[] = [];
let chartData: Record<string, unknown>[] = [];
vi.mock('recharts', () => ({
  // The whole module is stubbed rather than partially mocked: replacing LineChart alone removes
  // the context XAxis and CartesianGrid demand, and they throw. Recharts' own rendering is not
  // this suite's claim.
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    <div style={{ width: 400, height: 200 }}>{children}</div>,
  LineChart: ({ children, data }: { children: React.ReactNode; data: Record<string, unknown>[] }) => {
    chartData = data;
    return <div data-testid="line-chart">{children}</div>;
  },
  Line: (props: Record<string, unknown>) => {
    lineProps.push(props);
    return <div data-testid={`line-${String(props.dataKey)}`} />;
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

function cases(done: number, outstanding: number): PaceTestCase[] {
  return [
    ...Array.from({ length: done }, (_, i) => ({ testCaseId: `d${i}`, executionStatus: UAT_EXECUTION_STATUS.Completed })),
    ...Array.from({ length: outstanding }, (_, i) => ({ testCaseId: `t${i}`, executionStatus: UAT_EXECUTION_STATUS.NotStarted })),
  ];
}

const CYCLE = { cycleId: 'C1', name: 'Sprint 9', plannedStart: '2026-09-01', plannedEnd: '2026-09-10' };

describe('one cycle: the curves and the word', () => {
  it('says Behind, with the numbers behind the word', () => {
    // Day 5 of 10: 5 expected, 1 done.
    render(<UatPaceChart cycle={CYCLE} cases={cases(1, 9)} today="2026-09-05" />);
    const indicator = screen.getByTestId('uat-pace-indicator');
    expect(indicator.textContent).toContain(PACE_STATE_LABELS.behind);
    expect(indicator.textContent).toContain('1 of 10 done');
    expect(indicator.textContent).toContain('5 expected by today');
  });

  it('says Ahead when it is ahead', () => {
    render(<UatPaceChart cycle={CYCLE} cases={cases(8, 2)} today="2026-09-05" />);
    expect(screen.getByTestId('uat-pace-indicator').textContent).toContain(PACE_STATE_LABELS.ahead);
  });

  it('renders both curves for a cycle with a planned window', () => {
    lineProps.length = 0;
    render(<UatPaceChart cycle={CYCLE} cases={cases(3, 7)} today="2026-09-05" />);
    expect(screen.getByTestId('uat-pace-chart')).toBeTruthy();
    // Both series, by data key — a chart with one line would fail here.
    expect(screen.getByTestId('line-expected')).toBeTruthy();
    expect(screen.getByTestId('line-actual')).toBeTruthy();
    expect(lineProps.map((p) => p.name)).toEqual(['Expected', 'Actual']);
  });

  it('does not connect the actual line across the future', () => {
    // connectNulls:true would draw a straight line from today to the end of the cycle, which
    // reads as a forecast nobody made.
    lineProps.length = 0;
    render(<UatPaceChart cycle={CYCLE} cases={cases(3, 7)} today="2026-09-05" />);
    const actual = lineProps.find((p) => p.dataKey === 'actual')!;
    expect(actual.connectNulls).toBe(false);
  });

  it('feeds the chart one point per planned day, with future actuals null', () => {
    render(<UatPaceChart cycle={CYCLE} cases={cases(3, 7)} today="2026-09-05" />);
    expect(chartData).toHaveLength(10);
    expect(chartData[4]).toMatchObject({ date: '2026-09-05', actual: 3 });
    expect(chartData[5].actual).toBeNull();
  });

  it('explains itself rather than drawing an empty chart when there are no dates', () => {
    lineProps.length = 0;
    render(
      <UatPaceChart
        cycle={{ cycleId: 'C1', plannedStart: null, plannedEnd: null }}
        cases={cases(2, 3)}
        today="2026-09-05"
      />,
    );
    expect(screen.getByText(/no schedule to measure against/i)).toBeTruthy();
    expect(screen.queryByTestId('line-expected')).toBeNull();
  });

  it('says Complete rather than Overdue for a cycle that finished late', () => {
    render(<UatPaceChart cycle={CYCLE} cases={cases(4, 0)} today="2026-09-30" />);
    expect(screen.getByTestId('uat-pace-indicator').textContent).toContain(PACE_STATE_LABELS.complete);
    expect(screen.getByTestId('uat-pace-indicator').textContent).not.toContain(PACE_STATE_LABELS.overdue);
  });

  it('labels each state in the indicator, not by colour alone', () => {
    for (const state of ['ahead', 'behind', 'overdue', 'complete'] as const) {
      const { unmount } = render(<PaceIndicator state={state} />);
      expect(screen.getByTestId('uat-pace-indicator').textContent).toContain(PACE_STATE_LABELS[state]);
      unmount();
    }
  });
});

describe('the portfolio rollup', () => {
  const PROJECTS = [
    {
      projectId: 'p-1',
      cycles: [
        { cycle: CYCLE, cases: cases(8, 2) },
        { cycle: { cycleId: 'C2', plannedStart: '2026-09-01', plannedEnd: '2026-09-10' }, cases: cases(1, 9) },
      ],
    },
    { projectId: 'p-2', cycles: [{ cycle: CYCLE, cases: cases(4, 0) }] },
    { projectId: 'p-3', bypassed: true, cycles: [{ cycle: CYCLE, cases: cases(0, 50) }] },
  ];

  function renderRollup() {
    const onProjectClick = vi.fn();
    render(
      <UatPortfolioPace
        projects={PROJECTS}
        today="2026-09-05"
        onProjectClick={onProjectClick}
        projectNames={{ 'p-1': 'Nexus Rollout', 'p-2': 'Claims Uplift', 'p-3': 'Vendor Patch' }}
      />,
    );
    return { onProjectClick };
  }

  it('shows one row per counted project, and the bypassed one is absent', () => {
    renderRollup();
    const rows = within(screen.getByTestId('uat-portfolio-rows'));
    expect(rows.getByText('Nexus Rollout')).toBeTruthy();
    expect(rows.getByText('Claims Uplift')).toBeTruthy();
    expect(rows.queryByText('Vendor Patch')).toBeNull();
  });

  it('says how many projects it left out, rather than omitting them silently', () => {
    renderRollup();
    expect(screen.getByRole('status').textContent).toMatch(/1 project bypassed UAT and is not counted/i);
  });

  it('sums the counted projects by hand-checkable arithmetic', () => {
    // p-1: 9 of 20, expected 10. p-2: 4 of 4 complete, expected 4. Totals 13 of 24, expected 14.
    // The bypassed project's 50 cases are nowhere in these numbers.
    renderRollup();
    const summary = screen.getByTestId('uat-portfolio-pace').textContent ?? '';
    expect(summary).toContain('13');
    expect(summary).toContain('24');
    expect(summary).toContain('14');
    expect(summary).not.toContain('74');
  });

  it('shows a project\'s WORST cycle state, so good news cannot hide bad', () => {
    renderRollup();
    const row = within(screen.getByTestId('uat-portfolio-rows')).getByText('Nexus Rollout').closest('tr')!;
    // One cycle ahead, one behind → Behind.
    expect(row.textContent).toContain(PACE_STATE_LABELS.behind);
  });

  it('opens a project when its row is clicked', () => {
    const { onProjectClick } = renderRollup();
    fireEvent.click(within(screen.getByTestId('uat-portfolio-rows')).getByText('Claims Uplift'));
    expect(onProjectClick).toHaveBeenCalledWith('p-2');
  });

  it('says so when every project has bypassed UAT', () => {
    render(<UatPortfolioPace projects={[PROJECTS[2]]} today="2026-09-05" />);
    expect(screen.getByText(/Every project here has bypassed UAT/i)).toBeTruthy();
  });
});

describe('no PSS entity is read in the pace path', () => {
  const sources = import.meta.glob(
    ['./UatPaceChart.tsx', '../lib/uatPace.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  it('mentions no msdyn_ table anywhere', () => {
    // The pace path reads UAT cycles and UAT test cases only. Reaching for msdyn_project here
    // is the coupling the custom data source exists to remove.
    for (const [path, source] of Object.entries(sources)) {
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code, path).not.toContain('msdyn_');
      expect(code, path).not.toContain('proj_');
    }
  });

  it('takes project names as a prop rather than reading a project table', () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(source, path).not.toContain('useActiveProjects');
      expect(source, path).not.toContain('useProjects');
    }
  });
});
