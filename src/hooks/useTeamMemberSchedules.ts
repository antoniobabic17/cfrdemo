/**
 * useTeamMemberSchedules — the data behind the team Scheduling Gantt.
 *
 * For each member of a team, find the projects they MANAGE
 * (_msdyn_projectmanager_value === their systemuserid), across ALL teams (a
 * personal workload view, not just this team's projects), and reduce each to a
 * dated bar. Reuses useProjects() so both data sources (custom pmo_project and
 * PSS msdyn_project) are already normalized to the msdyn_* field names.
 */
import { useMemo } from 'react';
import { useProjects } from './useProjects';
import type { Project } from '../models/project.model';
import { startOfDay, addDays } from '../lib/ganttDates';

export interface ProjectBar {
  id: string;
  subject: string;
  start: Date;
  end: Date;
}

export interface MemberSchedule {
  systemuserid: string;
  fullname: string;
  bars: ProjectBar[];
}

const norm = (id: string | undefined | null) => (id ?? '').replace(/[{}]/g, '').toLowerCase();

/**
 * Pure reducer: given the team's members and all projects, group each member's
 * managed+dated projects into bars. Exported for unit testing.
 *
 * - A project belongs to a member when its project manager is that member.
 * - A project contributes a bar only if it has a start date; end falls back to
 *   msdyn_finish -> proj_scheduledcompletion -> start + 1 day.
 * - Every member appears, even with zero bars (empty lane).
 */
export function buildMemberSchedules(
  members: readonly { systemuserid: string; fullname: string }[],
  projects: readonly Project[],
): MemberSchedule[] {
  const byManager = new Map<string, ProjectBar[]>();
  for (const p of projects) {
    const mgr = norm(p['_msdyn_projectmanager_value']);
    if (!mgr) continue;
    if (!p.msdyn_scheduledstart) continue;
    const start = startOfDay(new Date(p.msdyn_scheduledstart));
    if (isNaN(start.getTime())) continue;
    const endRaw = p.msdyn_finish ?? p.proj_scheduledcompletion;
    let end = endRaw ? startOfDay(new Date(endRaw)) : addDays(start, 1);
    if (isNaN(end.getTime()) || end <= start) end = addDays(start, 1);
    const bar: ProjectBar = { id: p.msdyn_projectid, subject: p.msdyn_subject, start, end };
    const arr = byManager.get(mgr);
    if (arr) arr.push(bar);
    else byManager.set(mgr, [bar]);
  }
  return members.map((m) => {
    const bars = (byManager.get(norm(m.systemuserid)) ?? []).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    return { systemuserid: m.systemuserid, fullname: m.fullname, bars };
  });
}

export function useTeamMemberSchedules(
  members: readonly { systemuserid: string; fullname: string }[],
) {
  // useProjects() returns ALL active projects for the current data source,
  // already normalized to the msdyn_* shape. We need the manager + date fields;
  // they are in the curated base SELECT, so no extraSelect is required.
  const { data: projects = [], isLoading, error } = useProjects();

  const schedules = useMemo(
    () => buildMemberSchedules(members, projects),
    [members, projects],
  );

  return { schedules, isLoading, error };
}
