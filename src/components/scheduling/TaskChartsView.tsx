import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import type { ProjectTask } from '../../models/projectTask.model';
import type { ProjectBucket } from '../../models/projectBucket.model';
import { TASK_PRIORITY_META, TASK_PRIORITY } from '../../lib/constants';
import { deriveTaskStatus, STATUS_HEX, STATUS_META, STATUS_ORDER } from '../../lib/taskStatus';
import type { TaskStatus } from '../../lib/taskStatus';

interface Props {
  tasks: ProjectTask[];
  buckets: ProjectBucket[];
}

function getChartColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  const colors: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const v = style.getPropertyValue(`--color-chart-${i}`).trim();
    if (v) colors.push(v);
  }
  return colors.length > 0 ? colors : ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-foreground mb-2">{children}</h3>;
}

export function TaskChartsView({ tasks, buckets }: Props) {
  const chartColors = useMemo(getChartColors, []);
  const leafTasks = tasks.filter((t) => !t.msdyn_summary && !t.msdyn_projecttaskid.startsWith('optimistic-'));

  const completionData = useMemo(() => {
    // 5-slice status distribution -- same statuses used on tile pills.
    const counts: Record<TaskStatus, number> = {
      'not-started': 0, 'in-progress': 0, 'at-risk': 0, 'overdue': 0, 'done': 0,
    };
    for (const t of leafTasks) counts[deriveTaskStatus(t)]++;
    return STATUS_ORDER.map((status) => ({
      name: STATUS_META[status].label,
      value: counts[status],
      fill: STATUS_HEX[status],
    })).filter((d) => d.value > 0);
  }, [leafTasks]);

  const byBucket = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of leafTasks) {
      const bucketId = t['_msdyn_projectbucket_value'] ?? '__none__';
      map.set(bucketId, (map.get(bucketId) ?? 0) + 1);
    }
    return [...map.entries()].map(([id, count]) => {
      const bucket = buckets.find((b) => b.msdyn_projectbucketid === id);
      return { name: bucket?.msdyn_name ?? 'Unassigned', count };
    }).sort((a, b) => b.count - a.count);
  }, [leafTasks, buckets]);

  const byPriority = useMemo(() => {
    const priorities = [TASK_PRIORITY.Low, TASK_PRIORITY.Medium, TASK_PRIORITY.Important, TASK_PRIORITY.Urgent] as number[];
    return priorities.map((p) => ({
      name: TASK_PRIORITY_META[p]?.label ?? String(p),
      count: leafTasks.filter((t) => t.msdyn_priority === p).length,
    })).filter((d) => d.count > 0);
  }, [leafTasks]);

  const overdueCount = useMemo(() => leafTasks.filter((t) => deriveTaskStatus(t) === 'overdue').length, [leafTasks]);

  return (
    <div className="p-4 space-y-6 overflow-y-auto">
      {overdueCount > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 font-medium">
          {overdueCount} task{overdueCount !== 1 ? 's' : ''} overdue
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Completion donut */}
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionTitle>Status</SectionTitle>
          {completionData.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={completionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                >
                  {completionData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => [`${val} tasks`]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tasks by priority */}
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionTitle>By Priority</SectionTitle>
          {byPriority.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks with priority set</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byPriority} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={64} />
                <Tooltip formatter={(val: number) => [`${val} tasks`]} />
                <Bar dataKey="count" radius={3}>
                  {byPriority.map((_, i) => (
                    <Cell key={i} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tasks by bucket */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <SectionTitle>By Bucket</SectionTitle>
          {byBucket.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, byBucket.length * 36)}>
              <BarChart data={byBucket} layout="vertical" margin={{ left: 8, right: 8 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip formatter={(val: number) => [`${val} tasks`]} />
                <Bar dataKey="count" fill={chartColors[0]} radius={3} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
