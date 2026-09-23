/**
 * TeamSchedulingGantt — forecast timeline of a team's members across the
 * projects they manage. One lane per member; each managed, dated project is a
 * bar positioned by its forecasted start → end. v1: read-only, no capacity math.
 *
 * Adapted from TaskTimelineView (same header/scroll/today-line machinery).
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { startOfDay, addDays, diffDays } from '../../lib/ganttDates';
import type { MemberSchedule } from '../../hooks/useTeamMemberSchedules';

interface Props {
  schedules: MemberSchedule[];
  loading?: boolean;
}

const ROW_H = 40;
const HEADER_H = 44;
const LEFT_W = 220;
const DAY_W = 10;
const PAD_DAYS = 7;

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0] ?? '').join('').toUpperCase();
}

function barColor(start: Date, end: Date, today: Date): string {
  if (end < today) return 'bg-slate-400/80 dark:bg-slate-500/70';       // finished
  if (start > today) return 'bg-indigo-500';                             // upcoming
  return 'bg-sky-500';                                                    // in progress (spans today)
}

export function TeamSchedulingGantt({ schedules, loading }: Props) {
  const navigate = useNavigate();

  const allBars = useMemo(() => schedules.flatMap((s) => s.bars), [schedules]);

  const { origin, totalDays } = useMemo(() => {
    if (allBars.length === 0) {
      const today = startOfDay(new Date());
      return { origin: addDays(today, -PAD_DAYS), totalDays: PAD_DAYS * 2 + 60 };
    }
    const min = startOfDay(new Date(Math.min(...allBars.map((b) => b.start.getTime()))));
    const max = startOfDay(new Date(Math.max(...allBars.map((b) => b.end.getTime()))));
    return { origin: addDays(min, -PAD_DAYS), totalDays: Math.max(diffDays(max, min) + PAD_DAYS * 2, 60) };
  }, [allBars]);

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

  // Week gridlines (Mondays).
  const weeks = useMemo(() => {
    const result: number[] = [];
    const d = new Date(origin);
    const dow = d.getDay();
    const daysToMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
    d.setDate(d.getDate() + daysToMon);
    while (diffDays(d, origin) < totalDays) {
      result.push(diffDays(d, origin) * DAY_W);
      d.setDate(d.getDate() + 7);
    }
    return result;
  }, [origin, totalDays]);

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading schedule…</p>;
  }
  if (schedules.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No members on this team.</p>;
  }
  if (allBars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No forecasted project dates for this team&apos;s members yet.
      </p>
    );
  }

  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <div style={{ minWidth: LEFT_W + timelineWidth }}>
        {/* Header */}
        <div className="flex border-b border-border" style={{ height: HEADER_H }}>
          <div
            className="sticky left-0 z-20 bg-card border-r border-border shrink-0 flex items-end px-3 pb-1.5"
            style={{ width: LEFT_W }}
          >
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Team member</span>
          </div>
          <div className="relative" style={{ width: timelineWidth }}>
            {months.map((m, i) => (
              <div
                key={i}
                className="absolute flex items-center px-2 text-[10px] font-semibold text-muted-foreground border-l border-border/40"
                style={{ left: m.x, width: m.width, top: 0, height: HEADER_H }}
              >
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="relative">
          {schedules.map((member, i) => (
            <div key={member.systemuserid} className="flex" style={{ height: ROW_H }}>
              {/* Left — member (sticky) */}
              <div
                className="sticky left-0 z-10 bg-card border-r border-border shrink-0 flex items-center gap-2 px-3 border-b border-b-border/10"
                style={{ width: LEFT_W }}
              >
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0">
                  {initials(member.fullname)}
                </div>
                <span className="text-xs text-foreground truncate flex-1" title={member.fullname}>
                  {member.fullname}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {member.bars.length || '—'}
                </span>
              </div>

              {/* Right — project bars */}
              <div
                className={cn('relative border-b border-border/10 flex-1', i % 2 !== 0 && 'bg-muted/5')}
                style={{ width: timelineWidth }}
              >
                {member.bars.map((bar) => {
                  const x = diffDays(bar.start, origin) * DAY_W;
                  const w = Math.max(diffDays(bar.end, bar.start) * DAY_W, DAY_W);
                  return (
                    <div
                      key={bar.id}
                      className={cn(
                        'absolute rounded-sm cursor-pointer hover:brightness-110 transition-all border border-black/10 flex items-center px-1 overflow-hidden',
                        barColor(bar.start, bar.end, today),
                      )}
                      style={{ left: x, top: (ROW_H - 16) / 2, width: w, height: 16 }}
                      onClick={() => navigate(`/projects/${bar.id}`)}
                      title={`${bar.subject} · ${fmt(bar.start)}–${fmt(bar.end)}`}
                    >
                      <span className="text-[9px] font-medium text-white/90 truncate leading-none">
                        {bar.subject}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Grid + today overlay */}
          <div
            className="absolute pointer-events-none"
            style={{ left: LEFT_W, top: 0, width: timelineWidth, height: schedules.length * ROW_H }}
          >
            {weeks.map((x, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-l border-border/15" style={{ left: x }} />
            ))}
            {todayX >= 0 && todayX <= timelineWidth && (
              <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-rose-400/60 z-[5]" style={{ left: todayX }}>
                <div className="absolute -left-3.5 top-0.5 text-[8px] font-bold text-rose-500 bg-card px-0.5 rounded">
                  Today
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
