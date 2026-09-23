import { useMemo } from 'react';
import { Flag } from 'lucide-react';
import { buildTaskTree, type TaskNode } from './taskTree';
import { cn } from '../../lib/utils';
import type { ProjectTask } from '../../models/projectTask.model';
import type { ProjectTaskDependency } from '../../models/projectTaskDependency.model';
import { deriveTaskStatus, STATUS_META } from '../../lib/taskStatus';
import { startOfDay, addDays, diffDays } from '../../lib/ganttDates';

interface Props {
  tasks: ProjectTask[];
  dependencies: ProjectTaskDependency[];
  onSelectTask?: (taskId: string) => void;
  /** Present for parity with other task views; not yet used here since the
   *  timeline bar is too small for an inline checkbox -- click still opens
   *  the detail panel where the completion checkbox lives. */
  projectId?: string;
  canEdit?: boolean;
}

interface FlatRow {
  task: ProjectTask;
  depth: number;
  isSummary: boolean;
}

const ROW_H = 32;
const HEADER_H = 44;
const LEFT_W = 240;
const DAY_W = 24;
const PAD_DAYS = 7;

function taskProgress(t: ProjectTask): number {
  const p = t.msdyn_progress ?? 0;
  return p > 0 && p <= 1 ? p * 100 : p;
}

function getBarColor(task: ProjectTask, isSummary: boolean): string {
  // Timeline bar color is driven by the same derived status as every
  // other task view -- keeps color semantics consistent across surfaces.
  const status = deriveTaskStatus(task);
  if (isSummary) {
    return status === 'done' ? 'bg-emerald-400/80' : 'bg-blue-400/80';
  }
  switch (status) {
    case 'done':        return 'bg-emerald-500';
    case 'overdue':     return 'bg-rose-500';
    case 'at-risk':     return 'bg-amber-500';
    case 'in-progress': return 'bg-sky-500';
    case 'not-started': return 'bg-slate-300 dark:bg-slate-600';
  }
}

export function TaskTimelineView({ tasks, dependencies, onSelectTask }: Props) {
  // projectId + canEdit accepted via Props but currently unused; wired
  // through when we add an inline complete UI to the timeline row.
  const rows = useMemo((): FlatRow[] => {
    const tree = buildTaskTree(tasks);
    const result: FlatRow[] = [];
    function walk(nodes: TaskNode[], depth: number) {
      for (const node of nodes) {
        result.push({
          task: node.task,
          depth,
          isSummary: node.children.length > 0 || !!node.task.msdyn_summary,
        });
        walk(node.children, depth + 1);
      }
    }
    walk(tree, 0);
    return result;
  }, [tasks]);

  const { origin, totalDays } = useMemo(() => {
    const starts = tasks.map((t) => t.msdyn_scheduledstart).filter(Boolean).map((d) => new Date(d!));
    const ends = tasks.map((t) => t.msdyn_scheduledend ?? t.msdyn_finish).filter(Boolean).map((d) => new Date(d!));
    const allDates = [...starts, ...ends];
    if (allDates.length === 0) {
      const today = startOfDay(new Date());
      return { origin: addDays(today, -PAD_DAYS), totalDays: PAD_DAYS * 2 + 30 };
    }
    const min = startOfDay(new Date(Math.min(...allDates.map((d) => d.getTime()))));
    const max = startOfDay(new Date(Math.max(...allDates.map((d) => d.getTime()))));
    return { origin: addDays(min, -PAD_DAYS), totalDays: Math.max(diffDays(max, min) + PAD_DAYS * 2, 30) };
  }, [tasks]);

  const timelineWidth = totalDays * DAY_W;
  const today = startOfDay(new Date());
  const todayX = diffDays(today, origin) * DAY_W;

  const months = useMemo(() => {
    const result: Array<{ label: string; x: number; width: number }> = [];
    const endDate = addDays(origin, totalDays);
    let monthStart = new Date(origin.getFullYear(), origin.getMonth(), 1);
    while (monthStart < endDate) {
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const visStart = monthStart < origin ? origin : monthStart;
      const visEnd = monthEnd > endDate ? endDate : monthEnd;
      const x = diffDays(visStart, origin) * DAY_W;
      const width = diffDays(visEnd, visStart) * DAY_W;
      if (width > 0) {
        result.push({
          label: monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
          x,
          width,
        });
      }
      monthStart = monthEnd;
    }
    return result;
  }, [origin, totalDays]);

  const weeks = useMemo(() => {
    const result: Array<{ x: number; dayLabel: string }> = [];
    const d = new Date(origin);
    const dow = d.getDay();
    const daysToMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
    d.setDate(d.getDate() + daysToMon);
    while (diffDays(d, origin) < totalDays) {
      result.push({ x: diffDays(d, origin) * DAY_W, dayLabel: d.getDate().toString() });
      d.setDate(d.getDate() + 7);
    }
    return result;
  }, [origin, totalDays]);

  const rowIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.task.msdyn_projecttaskid, i));
    return m;
  }, [rows]);

  function barPos(t: ProjectTask) {
    const start = t.msdyn_scheduledstart ? startOfDay(new Date(t.msdyn_scheduledstart)) : null;
    const end = t.msdyn_scheduledend ?? t.msdyn_finish;
    const endDate = end ? startOfDay(new Date(end)) : null;
    if (!start) return null;
    const effectiveEnd = endDate && endDate > start ? endDate : addDays(start, 1);
    const x = diffDays(start, origin) * DAY_W;
    const w = Math.max(diffDays(effectiveEnd, start) * DAY_W, DAY_W);
    return { x, w };
  }

  const depPaths = useMemo(() => {
    return dependencies
      .filter((d) => d['_msdyn_predecessortask_value'] && d['_msdyn_successortask_value'])
      .map((dep) => {
        const predId = dep['_msdyn_predecessortask_value']!;
        const succId = dep['_msdyn_successortask_value']!;
        const predIdx = rowIndexMap.get(predId);
        const succIdx = rowIndexMap.get(succId);
        if (predIdx === undefined || succIdx === undefined) return null;
        const predTask = rows[predIdx]?.task;
        const succTask = rows[succIdx]?.task;
        if (!predTask || !succTask) return null;
        const predBar = barPos(predTask);
        const succBar = barPos(succTask);
        if (!predBar || !succBar) return null;

        const linkType = dep.msdyn_linktype ?? 0;
        const fromX = linkType === 2 || linkType === 3 ? predBar.x : predBar.x + predBar.w;
        const toX = linkType === 1 || linkType === 3 ? succBar.x + succBar.w : succBar.x;
        const fromY = predIdx * ROW_H + ROW_H / 2;
        const toY = succIdx * ROW_H + ROW_H / 2;

        const dx = 8;
        const path =
          toX > fromX + dx * 2
            ? `M${fromX},${fromY} L${fromX + dx},${fromY} L${fromX + dx},${toY} L${toX},${toY}`
            : `M${fromX},${fromY} L${fromX + dx},${fromY} L${fromX + dx},${(fromY + toY) / 2} L${toX - dx},${(fromY + toY) / 2} L${toX - dx},${toY} L${toX},${toY}`;

        const arrowSize = 4;
        const arrowDir = toX > (toX > fromX + dx * 2 ? fromX + dx : toX - dx) ? 1 : -1;
        const arrow = `M${toX},${toY} L${toX - arrowSize * arrowDir},${toY - arrowSize} L${toX - arrowSize * arrowDir},${toY + arrowSize} Z`;

        return { path, arrow, key: dep.msdyn_projecttaskdependencyid };
      })
      .filter(Boolean) as Array<{ path: string; arrow: string; key: string }>;
  }, [dependencies, rowIndexMap, rows, origin]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No tasks to display on timeline
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <div style={{ minWidth: LEFT_W + timelineWidth }}>
        {/* Header */}
        <div className="flex border-b border-border" style={{ height: HEADER_H }}>
          <div
            className="sticky left-0 z-20 bg-card border-r border-border shrink-0 flex items-end px-3 pb-1.5"
            style={{ width: LEFT_W }}
          >
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Task</span>
          </div>
          <div className="relative" style={{ width: timelineWidth }}>
            {/* Month labels */}
            {months.map((m, i) => (
              <div
                key={i}
                className="absolute flex items-center px-2 text-[10px] font-semibold text-muted-foreground border-l border-border/40"
                style={{ left: m.x, width: m.width, top: 0, height: HEADER_H / 2 }}
              >
                {m.label}
              </div>
            ))}
            {/* Week day labels */}
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute flex items-center justify-center text-[9px] text-muted-foreground/70"
                style={{ left: w.x, width: DAY_W * 7, top: HEADER_H / 2, height: HEADER_H / 2 }}
              >
                {w.dayLabel}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="relative">
          {rows.map((row, i) => {
            const pos = barPos(row.task);
            const progress = taskProgress(row.task);
            const isMilestone = row.task.msdyn_ismilestone;

            return (
              <div key={row.task.msdyn_projecttaskid} className="flex" style={{ height: ROW_H }}>
                {/* Left — task name (sticky) */}
                <div
                  className={cn(
                    'sticky left-0 z-10 bg-card border-r border-border shrink-0 flex items-center gap-1 text-xs truncate cursor-pointer hover:bg-muted/40 transition-colors border-b border-b-border/10',
                    row.isSummary && 'font-semibold',
                    deriveTaskStatus(row.task) === 'done' && 'text-muted-foreground line-through',
                  )}
                  style={{ width: LEFT_W, paddingLeft: 8 + row.depth * 16 }}
                  onClick={() => onSelectTask?.(row.task.msdyn_projecttaskid)}
                  title={row.task.msdyn_subject}
                >
                  {isMilestone && <Flag className="h-3 w-3 text-amber-500 shrink-0" />}
                  <span className="truncate flex-1">{row.task.msdyn_subject}</span>
                  <span
                    className={cn(
                      'ml-1 shrink-0 text-[8px] font-medium px-1 py-px rounded-full pointer-events-none',
                      STATUS_META[deriveTaskStatus(row.task)].pillCls,
                    )}
                  >
                    {STATUS_META[deriveTaskStatus(row.task)].label}
                  </span>
                </div>

                {/* Right — timeline bar */}
                <div
                  className={cn('relative border-b border-border/10 flex-1', i % 2 !== 0 && 'bg-muted/5')}
                  style={{ width: timelineWidth }}
                >
                  {pos && !isMilestone && (
                    <div
                      className={cn(
                        'absolute rounded-sm cursor-pointer hover:brightness-110 transition-all',
                        getBarColor(row.task, row.isSummary),
                      )}
                      style={{
                        left: pos.x,
                        top: (ROW_H - (row.isSummary ? 6 : 16)) / 2,
                        width: pos.w,
                        height: row.isSummary ? 6 : 16,
                      }}
                      onClick={() => onSelectTask?.(row.task.msdyn_projecttaskid)}
                      title={`${row.task.msdyn_subject} (${Math.round(progress)}%)`}
                    >
                      {deriveTaskStatus(row.task) !== 'done' && progress > 0 && progress < 100 && !row.isSummary && (
                        <div
                          className="absolute inset-y-0 left-0 rounded-l-sm bg-blue-600/30"
                          style={{ width: `${progress}%` }}
                        />
                      )}
                    </div>
                  )}
                  {pos && isMilestone && (
                    <div
                      className="absolute cursor-pointer"
                      style={{ left: pos.x - 6, top: ROW_H / 2 - 6 }}
                      onClick={() => onSelectTask?.(row.task.msdyn_projecttaskid)}
                      title={`${row.task.msdyn_subject} (milestone)`}
                    >
                      <div className="w-3 h-3 bg-amber-500 rotate-45 rounded-sm" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Grid lines overlay */}
          <div
            className="absolute pointer-events-none"
            style={{ left: LEFT_W, top: 0, width: timelineWidth, height: rows.length * ROW_H }}
          >
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-border/15"
                style={{ left: w.x }}
              />
            ))}
            {todayX >= 0 && todayX <= timelineWidth && (
              <div
                className="absolute top-0 bottom-0 border-l-2 border-dashed border-rose-400/60 z-[5]"
                style={{ left: todayX }}
              >
                <div className="absolute -left-3.5 top-0.5 text-[8px] font-bold text-rose-500 bg-card px-0.5 rounded">
                  Today
                </div>
              </div>
            )}
          </div>

          {/* Dependency arrows SVG overlay */}
          {depPaths.length > 0 && (
            <svg
              className="absolute pointer-events-none z-[2]"
              style={{ left: LEFT_W, top: 0, width: timelineWidth, height: rows.length * ROW_H }}
            >
              {depPaths.map(({ path, arrow, key }) => (
                <g key={key}>
                  <path d={path} fill="none" stroke="currentColor" className="text-muted-foreground/40" strokeWidth={1.5} />
                  <path d={arrow} fill="currentColor" className="text-muted-foreground/40" />
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
