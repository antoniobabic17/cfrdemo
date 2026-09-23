/**
 * Admin > Error Log > Analytics tab.
 *
 * Reads the same pmo_telemetryevent rows the Errors tab reads (via
 * useAppErrorLog) and renders four at-a-glance visuals:
 *
 *   1. Errors per day (30 days) -- line chart. Spot spikes / trends.
 *   2. Errors by page (top 8) -- pie chart. Which routes generate the
 *      most user-visible failures?
 *   3. Errors by action -- horizontal bar chart. Which call sites
 *      (`toast.error({ action })`) generate the most failures? Uses the
 *      call-site hint the toast helper already captures.
 *   4. Retry outcome distribution -- pie chart. Percentage of errors that
 *      recovered (succeeded), were abandoned by an admin, gave up on
 *      auto-retry, or are single-attempt failures with no terminal
 *      outcome recorded. Directly answers "how many of these are actually
 *      persistent vs transient".
 *
 * Uses recharts (already in the app) and the app's chart colour palette
 * pattern from PermissionsPage.tsx for visual parity.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, TrendingUp, PieChart as PieIcon, Activity, X } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from 'recharts';
import { ErrorBanner } from '../../components/common/ErrorBanner';
import { useAppErrorLog } from '../../hooks/useTelemetryEvents';
import { parseAppErrorPayload } from '../../lib/errorLog';
import { friendlyRouteLabel, useRouteEntityLookup } from '../../hooks/useRouteEntityLookup';

// Palette borrowed from the app's existing chart usage -- keeps visual
// parity with Permissions + Analytics Hub.
const PIE_COLORS = ['#3b82f6', '#f97316', '#10b981', '#ef4444', '#a855f7', '#eab308', '#06b6d4', '#ec4899'];
const OUTCOME_COLORS: Record<string, string> = {
  succeeded:            '#10b981', // green
  abandoned:            '#f59e0b', // amber
  'gave-up-auto-retry': '#ef4444', // red
  'no-outcome':         '#94a3b8', // slate (single-attempt / no lifecycle)
};

const OUTCOME_LABELS: Record<string, string> = {
  succeeded:            'Succeeded (after retry)',
  abandoned:            'Abandoned by admin',
  'gave-up-auto-retry': 'Gave up (auto-retry)',
  'no-outcome':         'No terminal outcome',
};

const DAYS_WINDOW = 30;
const TOP_PAGES = 8;
const TOP_ACTIONS = 8;

/** Returns YYYY-MM-DD in local time. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Short "Jul 15" style label. */
function shortDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

/** Bucket rows into per-day counts for the last N days, always emitting N
 *  buckets even when a day had zero errors. */
export function bucketErrorsPerDay(
  createdOns: (string | undefined)[],
  now: Date = new Date(),
  days: number = DAYS_WINDOW,
): { day: string; label: string; count: number }[] {
  const buckets = new Map<string, number>();
  // Seed empty buckets so the line chart is continuous.
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(ymdLocal(d), 0);
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  cutoff.setHours(0, 0, 0, 0);
  for (const raw of createdOns) {
    if (!raw) continue;
    const t = new Date(raw);
    if (isNaN(t.getTime())) continue;
    if (t < cutoff) continue;
    const key = ymdLocal(t);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets].map(([day, count]) => ({ day, label: shortDayLabel(day), count }));
}

/** Group a list of string values into { name, value } tuples, sort desc,
 *  keep the top `topN` and roll everything else into 'Other'. */
export function topGroupedCount(
  values: (string | undefined)[],
  topN: number,
  otherLabel: string = 'Other',
): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v && v.trim() ? v.trim() : '(unknown)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restTotal = rest.reduce((sum, [, n]) => sum + n, 0);
  const out = top.map(([name, value]) => ({ name, value }));
  if (restTotal > 0) out.push({ name: otherLabel, value: restTotal });
  return out;
}

export function ErrorLogAnalyticsTab() {
  const { data: events = [], isLoading, error } = useAppErrorLog();

  const parsed = useMemo(
    () => events.map((e) => ({
      id: e.pmo_telemetryeventid,
      createdon: e.createdon,
      user: e['_createdby_value@OData.Community.Display.V1.FormattedValue'] ?? '\u2014',
      payload: parseAppErrorPayload(e.pmo_payload),
    })),
    [events],
  );

  // Drill-down state -- clicking a chart slice reveals the individual
  // AppError rows contributing to that slice. Single filter at a time;
  // opening a slice on one chart clears the selection on the others.
  type DrillKind = 'page' | 'outcome' | 'action';
  const [selected, setSelected] = useState<{ kind: DrillKind; key: string; label: string } | null>(null);
  function toggleSelect(next: { kind: DrillKind; key: string; label: string }) {
    setSelected((prev) => (prev && prev.kind === next.kind && prev.key === next.key ? null : next));
  }

  // 1) Errors per day (30 days).
  const perDay = useMemo(
    () => bucketErrorsPerDay(parsed.map((r) => r.createdon)),
    [parsed],
  );
  const totalWindow = perDay.reduce((s, b) => s + b.count, 0);
  const avgWindow = totalWindow / perDay.length;
  const peakDay = perDay.reduce((max, b) => (b.count > max.count ? b : max), perDay[0] ?? { day: '', label: '—', count: 0 });

  // 2) Errors by page (top pages).
  const pages = useMemo(
    () => parsed.map((r) => r.payload.route ?? '(unknown route)'),
    [parsed],
  );
  const pageBuckets = useMemo(() => topGroupedCount(pages, TOP_PAGES), [pages]);

  // Resolve GUIDs inside routes to entity names -- reuses the same lookup
  // the Errors tab uses for its Page column.
  const { labels: routeLabels } = useRouteEntityLookup(pageBuckets.map((b) => b.name));
  // Rewrite each bucket's `name` to the friendly label so Recharts Pie +
  // Legend read the friendly text through their default `name` accessor.
  // (nameKey overrides are inconsistently honored by the Legend in some
  //  recharts versions -- rewriting `name` directly is the reliable path.)
  const pageBucketsAnnotated = useMemo(
    () => pageBuckets.map((b) => ({
      rawRoute: b.name,
      name: b.name === 'Other' || b.name === '(unknown route)'
        ? b.name
        : (friendlyRouteLabel(b.name, routeLabels) || b.name),
      value: b.value,
    })),
    [pageBuckets, routeLabels],
  );

  // 3) Errors by action (top actions).
  const actions = useMemo(
    () => parsed.map((r) => r.payload.action ?? '(no action)'),
    [parsed],
  );
  const actionBuckets = useMemo(() => topGroupedCount(actions, TOP_ACTIONS), [actions]);

  // 4) Retry outcome distribution.
  const outcomeBuckets = useMemo(() => {
    const counts = { succeeded: 0, abandoned: 0, 'gave-up-auto-retry': 0, 'no-outcome': 0 } as Record<string, number>;
    for (const r of parsed) {
      const o = r.payload.outcome;
      if (o === 'succeeded' || o === 'abandoned' || o === 'gave-up-auto-retry') counts[o]++;
      else counts['no-outcome']++;
    }
    return (Object.entries(counts) as [string, number][])
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: OUTCOME_LABELS[k] ?? k, key: k, value: v }));
  }, [parsed]);

  // Compute the filtered row list for the current selection. Uses the
  // same accessors the buckets use so the count in the chart matches the
  // list length exactly.
  const OTHER = 'Other';
  const drillRows = useMemo(() => {
    if (!selected) return [] as typeof parsed;
    if (selected.kind === 'page') {
      const topKeys = new Set(pageBuckets.filter((b) => b.name !== OTHER).map((b) => b.name));
      return parsed.filter((r) => {
        const key = r.payload.route ?? '(unknown route)';
        if (selected.key === OTHER) return !topKeys.has(key);
        return key === selected.key;
      });
    }
    if (selected.kind === 'outcome') {
      return parsed.filter((r) => {
        const o = r.payload.outcome;
        if (selected.key === 'no-outcome') return o !== 'succeeded' && o !== 'abandoned' && o !== 'gave-up-auto-retry';
        return o === selected.key;
      });
    }
    if (selected.kind === 'action') {
      const topKeys = new Set(actionBuckets.filter((b) => b.name !== OTHER).map((b) => b.name));
      return parsed.filter((r) => {
        const key = r.payload.action ?? '(no action)';
        if (selected.key === OTHER) return !topKeys.has(key);
        return key === selected.key;
      });
    }
    return [];
  }, [selected, parsed, pageBuckets, actionBuckets]);

  if (error) return <ErrorBanner error={error as Error} />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading analytics…</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center">
        <AlertTriangle className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium text-foreground">No errors logged yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Analytics will populate once errors start flowing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Total errors logged"
          value={events.length}
          hint="All time"
        />
        <SummaryTile
          icon={<Calendar className="h-4 w-4" />}
          label="Last 30 days"
          value={totalWindow}
          hint={`avg ${avgWindow.toFixed(1)}/day`}
        />
        <SummaryTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Peak day"
          value={peakDay?.count ?? 0}
          hint={peakDay?.label ?? '—'}
        />
        <SummaryTile
          icon={<Activity className="h-4 w-4" />}
          label="Recovered by retry"
          value={outcomeBuckets.find((b) => b.key === 'succeeded')?.value ?? 0}
          hint="succeeded after N tries"
        />
      </div>

      {/* Row 1: line chart full width */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <header>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Errors per day (last 30 days)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each point is a full local-time day. Zero-error days still show so gaps and spikes are legible.
          </p>
        </header>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={perDay} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(value: number) => [value, 'errors']}
                labelFormatter={(label) => `Day: ${label}`}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Row 2: two pie charts side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <header>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <PieIcon className="h-3.5 w-3.5" /> Errors by page
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Top {TOP_PAGES} routes plus rollup. Route GUIDs are resolved to entity names where possible.
            </p>
          </header>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pageBucketsAnnotated}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={2}
                  isAnimationActive={false}
                  cursor="pointer"
                  onClick={(entry: unknown) => {
                    const e = entry as { payload?: { rawRoute?: string; name?: string } };
                    const rawKey = e.payload?.rawRoute ?? e.payload?.name;
                    const label = e.payload?.name ?? rawKey ?? '';
                    if (rawKey) toggleSelect({ kind: 'page', key: rawKey, label });
                  }}
                >
                  {pageBucketsAnnotated.map((b, i) => {
                    const isSel = selected?.kind === 'page' && selected.key === b.rawRoute;
                    const anySel = selected?.kind === 'page' && !!selected.key;
                    return (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        opacity={anySel && !isSel ? 0.35 : 1}
                        stroke={isSel ? '#111827' : undefined}
                        strokeWidth={isSel ? 2 : 0}
                      />
                    );
                  })}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(value: number, name: string) => [value, name]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(v: string) => (v.length > 40 ? v.slice(0, 40) + '…' : v)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <header>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <PieIcon className="h-3.5 w-3.5" /> Retry outcome distribution
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              How the staging lifecycle usually ends. "No terminal outcome" means single-attempt failures with no retry recorded.
            </p>
          </header>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={outcomeBuckets}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={2}
                  isAnimationActive={false}
                  cursor="pointer"
                  onClick={(entry: unknown) => {
                    const e = entry as { payload?: { key?: string; name?: string } };
                    const key = e.payload?.key;
                    const label = e.payload?.name ?? key ?? '';
                    if (key) toggleSelect({ kind: 'outcome', key, label });
                  }}
                >
                  {outcomeBuckets.map((b, i) => {
                    const isSel = selected?.kind === 'outcome' && selected.key === b.key;
                    const anySel = selected?.kind === 'outcome' && !!selected.key;
                    return (
                      <Cell
                        key={i}
                        fill={OUTCOME_COLORS[b.key] ?? PIE_COLORS[i % PIE_COLORS.length]}
                        opacity={anySel && !isSel ? 0.35 : 1}
                        stroke={isSel ? '#111827' : undefined}
                        strokeWidth={isSel ? 2 : 0}
                      />
                    );
                  })}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(value: number, name: string) => [value, name]}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ fontSize: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {selected && (
        <section className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {selected.kind === 'page' ? 'Errors on page' : selected.kind === 'outcome' ? 'Errors with outcome' : 'Errors from action'}
              </p>
              <p className="text-sm font-semibold text-foreground mt-0.5 break-all">{selected.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {drillRows.length} {drillRows.length === 1 ? 'row' : 'rows'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title="Clear drill-down"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          {drillRows.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No rows match this selection.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card max-h-96 overflow-y-auto">
              {drillRows.map((r) => (
                <li key={r.id} className="px-3 py-2 text-xs space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums text-muted-foreground">
                      {r.createdon ? new Date(r.createdon).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : '\u2014'}
                    </span>
                    <span className="text-foreground truncate max-w-[40%]" title={r.user}>{r.user}</span>
                  </div>
                  <p className="text-foreground line-clamp-2">{r.payload.message ?? '(no message)'}</p>
                  {(r.payload.action || r.payload.entityType) && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {r.payload.action ?? ''}
                      {r.payload.action && r.payload.entityType ? ' \u00b7 ' : ''}
                      {r.payload.entityType ?? ''}
                      {r.payload.attempt !== undefined ? ` \u00b7 attempt ${r.payload.attempt}` : ''}
                      {r.payload.outcome ? ` \u00b7 ${r.payload.outcome}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Row 3: horizontal bar chart of top actions */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <header>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Errors by action (top {TOP_ACTIONS})
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Grouped by the call-site hint that fired the toast. Useful for identifying which write paths fail most.
          </p>
        </header>
        <div style={{ height: Math.max(200, actionBuckets.length * 32 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={actionBuckets} layout="vertical" margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10 }}
                width={180}
                interval={0}
              />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(value: number) => [value, 'errors']}
              />
              <Bar
                dataKey="value"
                fill="#f97316"
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry: unknown) => {
                  const e = entry as { payload?: { name?: string } };
                  const key = e.payload?.name;
                  if (key) toggleSelect({ kind: 'action', key, label: key });
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function SummaryTile({
  icon, label, value, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-widest font-semibold">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-tight mt-1">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
