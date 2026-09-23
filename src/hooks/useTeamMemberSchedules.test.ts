import { describe, expect, it } from 'vitest';
import { buildMemberSchedules } from './useTeamMemberSchedules';
import type { Project } from '../models/project.model';

const ALICE = 'aaaaaaaa-0000-0000-0000-000000000001';
const BOB = 'bbbbbbbb-0000-0000-0000-000000000002';

function proj(over: Partial<Project>): Project {
  return {
    msdyn_projectid: 'p-' + Math.random().toString(36).slice(2),
    msdyn_subject: 'Project',
    ...over,
  } as Project;
}

const members = [
  { systemuserid: ALICE, fullname: 'Alice Adams' },
  { systemuserid: BOB, fullname: 'Bob Brown' },
];

describe('buildMemberSchedules', () => {
  it('groups projects under their manager', () => {
    const projects = [
      proj({ msdyn_subject: 'A1', '_msdyn_projectmanager_value': ALICE, msdyn_scheduledstart: '2026-09-01', msdyn_finish: '2026-09-10' }),
      proj({ msdyn_subject: 'B1', '_msdyn_projectmanager_value': BOB, msdyn_scheduledstart: '2026-09-05', msdyn_finish: '2026-09-20' }),
    ];
    const res = buildMemberSchedules(members, projects);
    expect(res.find((m) => m.systemuserid === ALICE)!.bars.map((b) => b.subject)).toEqual(['A1']);
    expect(res.find((m) => m.systemuserid === BOB)!.bars.map((b) => b.subject)).toEqual(['B1']);
  });

  it('every member appears even with no managed projects', () => {
    const res = buildMemberSchedules(members, []);
    expect(res).toHaveLength(2);
    expect(res.every((m) => m.bars.length === 0)).toBe(true);
  });

  it('skips projects with no start date', () => {
    const projects = [proj({ '_msdyn_projectmanager_value': ALICE, msdyn_finish: '2026-09-10' })];
    expect(buildMemberSchedules(members, projects).find((m) => m.systemuserid === ALICE)!.bars).toHaveLength(0);
  });

  it('falls back end -> scheduledcompletion -> start+1 and never lets end <= start', () => {
    const projects = [
      proj({ '_msdyn_projectmanager_value': ALICE, msdyn_scheduledstart: '2026-09-01', proj_scheduledcompletion: '2026-09-08' }),
      proj({ '_msdyn_projectmanager_value': ALICE, msdyn_scheduledstart: '2026-09-01', msdyn_finish: '2026-08-01' }), // end before start
    ];
    const bars = buildMemberSchedules(members, projects).find((m) => m.systemuserid === ALICE)!.bars;
    expect(bars[0].end.getTime()).toBeGreaterThan(bars[0].start.getTime());
    expect(bars[1].end.getTime()).toBeGreaterThan(bars[1].start.getTime());
  });

  it('matches manager id case-insensitively and ignoring braces', () => {
    const projects = [proj({ '_msdyn_projectmanager_value': `{${ALICE.toUpperCase()}}`, msdyn_scheduledstart: '2026-09-01' })];
    expect(buildMemberSchedules(members, projects).find((m) => m.systemuserid === ALICE)!.bars).toHaveLength(1);
  });

  it('sorts a member bars by start date', () => {
    const projects = [
      proj({ msdyn_subject: 'late', '_msdyn_projectmanager_value': ALICE, msdyn_scheduledstart: '2026-10-01' }),
      proj({ msdyn_subject: 'early', '_msdyn_projectmanager_value': ALICE, msdyn_scheduledstart: '2026-09-01' }),
    ];
    expect(buildMemberSchedules(members, projects).find((m) => m.systemuserid === ALICE)!.bars.map((b) => b.subject))
      .toEqual(['early', 'late']);
  });
});
