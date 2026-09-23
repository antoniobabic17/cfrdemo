import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, Calendar, BarChart3 } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { useActiveProjects } from '../../hooks/useProjects';
import { useAllProjectTasks } from '../../hooks/useAllProjectTasks';
import { cn } from '../../lib/utils';

function pct(n: number, d: number) {
  return d === 0 ? null : Math.round((n / d) * 100);
}

interface ProjectRow {
  id: string;
  name: string;
  taskCount: number;
  scheduledCount: number;
  overdueCount: number;
  coveragePct: number | null;
}

const STATUS_ORDER = ['attention', 'fair', 'healthy', 'none'] as const;
type Status = typeof STATUS_ORDER[number];

function rowStatus(row: ProjectRow): Status {
  if (row.taskCount === 0) return 'none';
  if (row.overdueCount > 0 || (row.coveragePct ?? 0) < 50) return 'attention';
  if ((row.coveragePct ?? 0) < 80) return 'fair';
  return 'healthy';
}

const STATUS_STYLE: Record<Status, { dot: string; label: string }> = {
  healthy:   { dot: 'bg-emerald-500', label: 'Healthy' },
  fair:      { dot: 'bg-amber-400',   label: 'Fair' },
  attention: { dot: 'bg-rose-500',    label: 'Attention' },
  none:      { dot: 'bg-muted-foreground/30', label: 'No tasks' },
};

export function SchedulePage() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading: projectsLoading } = useActiveProjects();
  const { data: tasks = [], isLoading: tasksLoading } = useAllProjectTasks();

  const isLoading = projectsLoading || tasksLoading;

  const rows: ProjectRow[] = useMemo(() => {
    const now = new Date();
    return projects.map((p) => {
      const pid = p.msdyn_projectid;
      const ptasks = tasks.filter((t) => t['_msdyn_project_value'] === pid);
      const withDates = ptasks.filter((t) => t.msdyn_scheduledstart && (t.msdyn_scheduledend ?? t.msdyn_finish));
      const overdue = ptasks.filter((t) => {
        const due = t.msdyn_scheduledend ?? t.msdyn_finish;
        if (!due) return false;
        const prog = t.msdyn_progress ?? 0;
        const done = prog > 0 && prog <= 1 ? prog >= 1 : prog >= 100;
        return !done && new Date(due) < now;
      });
      return {
        id: pid,
        name: p.msdyn_subject,
        taskCount: ptasks.length,
        scheduledCount: withDates.length,
        overdueCount: overdue.length,
        coveragePct: pct(withDates.length, ptasks.length),
      };
    }).sort((a, b) => STATUS_ORDER.indexOf(rowStatus(a)) - STATUS_ORDER.indexOf(rowStatus(b)));
  }, [projects, tasks]);

  const totalTasks = rows.reduce((s, r) => s + r.taskCount, 0);
  const planned = rows.filter((r) => r.taskCount > 0).length;
  const unplanned = rows.filter((r) => r.taskCount === 0).length;
  const totalOverdue = rows.reduce((s, r) => s + r.overdueCount, 0);
  const avgCoverage = (() => {
    const withTasks = rows.filter((r) => r.coveragePct !== null);
    if (withTasks.length === 0) return null;
    return Math.round(withTasks.reduce((s, r) => s + (r.coveragePct ?? 0), 0) / withTasks.length);
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule Quality"
        subtitle="Date coverage and overdue task signals across all active projects"
        showBack
        onBack={() => navigate('/analytics')}
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tasks across portfolio', value: totalTasks, icon: BarChart3, color: 'text-foreground' },
          { label: 'With tasks', value: planned, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Overdue tasks', value: totalOverdue, icon: AlertTriangle, color: totalOverdue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground' },
          { label: 'Avg date coverage', value: avgCoverage != null ? `${avgCoverage}%` : '—', icon: Calendar, color: avgCoverage == null ? 'text-muted-foreground' : avgCoverage >= 80 ? 'text-emerald-600' : avgCoverage >= 50 ? 'text-amber-600' : 'text-rose-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3 text-center">
            <div className="flex justify-center mb-1">
              <Icon className={cn('h-4 w-4', color)} />
            </div>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Per-project table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,2fr)_80px_80px_80px_100px_80px] gap-x-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <span>Project</span>
          <span className="text-right">Tasks</span>
          <span className="text-right">Scheduled</span>
          <span className="text-right">Coverage</span>
          <span className="text-right">Overdue</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-border/60">
          {rows.map((row) => {
            const s = rowStatus(row);
            const style = STATUS_STYLE[s];
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,2fr)_80px_80px_80px_100px_80px] gap-x-4 px-4 py-3 items-center hover:bg-muted/20 transition-colors cursor-pointer"
                onClick={() => navigate(`/projects/${row.id}`)}
              >
                <span className="text-sm font-medium text-foreground truncate">{row.name}</span>
                <span className="text-sm text-muted-foreground text-right tabular-nums">{row.taskCount || '—'}</span>
                <span className="text-sm text-muted-foreground text-right tabular-nums">
                  {row.taskCount > 0 ? row.scheduledCount : '—'}
                </span>
                <span className={cn('text-sm text-right tabular-nums font-medium', {
                  'text-emerald-600': (row.coveragePct ?? -1) >= 80,
                  'text-amber-600': (row.coveragePct ?? -1) >= 50 && (row.coveragePct ?? -1) < 80,
                  'text-rose-600': (row.coveragePct ?? -1) >= 0 && (row.coveragePct ?? -1) < 50,
                  'text-muted-foreground': row.coveragePct === null,
                })}>
                  {row.coveragePct != null ? `${row.coveragePct}%` : '—'}
                </span>
                <span className={cn('text-sm text-right tabular-nums', row.overdueCount > 0 && 'text-rose-600 font-medium')}>
                  {row.taskCount > 0 ? (row.overdueCount > 0 ? row.overdueCount : '✓') : '—'}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', style.dot)} />
                  <span className="text-xs text-muted-foreground">{style.label}</span>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No active projects.</div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Coverage: ≥80% Healthy, 50–79% Fair, &lt;50% Needs Attention</p>
      {unplanned > 0 && (
        <p className="text-xs text-muted-foreground">
          {unplanned} project{unplanned !== 1 ? 's' : ''} have no tasks — work is unplanned.
        </p>
      )}
    </div>
  );
}
