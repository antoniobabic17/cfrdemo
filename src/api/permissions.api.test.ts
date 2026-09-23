/**
 * Unit tests for permissions.api -- pure logic (deriveEffectiveScope +
 * reasonLabel). The network-touching parts (fetchMonthlyUniqueUsers,
 * fetchUserProjectPermissions) are exercised by the integration probes.
 */
import { describe, expect, it } from 'vitest';
import { bucketRowsByMonth, deriveEffectiveScope, reasonLabel } from './permissions.api';
import type { PermissionReason, SessionPingRow } from './permissions.api';

describe('deriveEffectiveScope', () => {
  it('returns read-only when no reasons apply', () => {
    expect(deriveEffectiveScope([])).toBe('read-only');
  });

  it('returns full for each "full" reason on its own', () => {
    const fullReasons: PermissionReason[] = [
      'admin',
      'project_manager',
      'executive_sponsor',
      'manager',
      'primary_team_lead',
      'primary_team_member',
      'collaborator_full',
    ];
    for (const r of fullReasons) {
      expect(deriveEffectiveScope([r])).toBe('full');
    }
  });

  it('returns tasks-and-notes only when collaborator_tasks_and_notes stands alone', () => {
    expect(deriveEffectiveScope(['collaborator_tasks_and_notes'])).toBe('tasks-and-notes');
  });

  it('promotes to full when tasks-and-notes stacks with any full reason', () => {
    expect(deriveEffectiveScope(['collaborator_tasks_and_notes', 'primary_team_member'])).toBe('full');
    expect(deriveEffectiveScope(['collaborator_tasks_and_notes', 'admin'])).toBe('full');
    expect(deriveEffectiveScope(['collaborator_tasks_and_notes', 'collaborator_full'])).toBe('full');
  });

  it('handles multiple full reasons on the same project', () => {
    expect(deriveEffectiveScope(['project_manager', 'primary_team_member'])).toBe('full');
    expect(deriveEffectiveScope(['executive_sponsor', 'manager', 'primary_team_lead'])).toBe('full');
  });
});

describe('reasonLabel', () => {
  it('returns a human-readable label for every reason', () => {
    const reasons: PermissionReason[] = [
      'admin',
      'project_manager',
      'executive_sponsor',
      'manager',
      'primary_team_lead',
      'primary_team_member',
      'collaborator_full',
      'collaborator_tasks_and_notes',
    ];
    for (const r of reasons) {
      const label = reasonLabel(r);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('collaborator labels distinguish the two scopes', () => {
    expect(reasonLabel('collaborator_full')).not.toBe(reasonLabel('collaborator_tasks_and_notes'));
    expect(reasonLabel('collaborator_full')).toContain('Full');
    expect(reasonLabel('collaborator_tasks_and_notes')).toContain('Tasks');
  });
});

describe('bucketRowsByMonth', () => {
  const iso = (y: number, m: number, d = 15) =>
    new Date(y, m - 1, d, 12, 0, 0).toISOString();

  it('prefers pmo_payload.actorUserId over _createdby_value', () => {
    const rows: SessionPingRow[] = [
      {
        createdon: iso(2026, 7),
        pmo_payload: JSON.stringify({ actorUserId: 'AAAA1111-0000-0000-0000-000000000001' }),
        _createdby_value: 'BBBB2222-0000-0000-0000-000000000002',
      },
    ];
    const byMonth = bucketRowsByMonth(rows);
    const july = byMonth.get('2026-07')!;
    expect(july.size).toBe(1);
    expect(july.has('aaaa1111-0000-0000-0000-000000000001')).toBe(true);
    expect(july.has('bbbb2222-0000-0000-0000-000000000002')).toBe(false);
  });

  it('falls back to _createdby_value when payload is missing or unparseable', () => {
    const rows: SessionPingRow[] = [
      { createdon: iso(2026, 7), pmo_payload: null, _createdby_value: 'USER-A' },
      { createdon: iso(2026, 7), pmo_payload: 'not-json-at-all', _createdby_value: 'USER-B' },
      { createdon: iso(2026, 7), pmo_payload: JSON.stringify({ note: 'no actorUserId here' }), _createdby_value: 'USER-C' },
    ];
    const july = bucketRowsByMonth(rows).get('2026-07')!;
    expect(july.size).toBe(3);
    expect(july.has('user-a')).toBe(true);
    expect(july.has('user-b')).toBe(true);
    expect(july.has('user-c')).toBe(true);
  });

  it('skips rows where both actorUserId and _createdby_value are absent', () => {
    const rows: SessionPingRow[] = [
      { createdon: iso(2026, 7), pmo_payload: null, _createdby_value: null },
      { createdon: iso(2026, 7), pmo_payload: JSON.stringify({}), _createdby_value: undefined },
      { createdon: '', pmo_payload: JSON.stringify({ actorUserId: 'X' }) }, // no createdon
    ];
    expect(bucketRowsByMonth(rows).size).toBe(0);
  });

  it('dedupes the same user counted via both paths within one month', () => {
    const userId = 'DDDD4444-0000-0000-0000-000000000004';
    const rows: SessionPingRow[] = [
      {
        createdon: iso(2026, 7, 10),
        pmo_payload: JSON.stringify({ actorUserId: userId }),
        _createdby_value: null,
      },
      {
        // Same user, later that month, no payload — createdby path.
        createdon: iso(2026, 7, 20),
        pmo_payload: null,
        _createdby_value: userId,
      },
    ];
    const july = bucketRowsByMonth(rows).get('2026-07')!;
    expect(july.size).toBe(1);
    expect(july.has(userId.toLowerCase())).toBe(true);
  });

  it('carries actorFullName through from the payload so the UI does not need a systemuser round-trip', () => {
    const rows: SessionPingRow[] = [
      {
        createdon: iso(2026, 7, 10),
        pmo_payload: JSON.stringify({
          actorUserId: '936a6d1e-8434-ec11-b6e6-002248228786',
          actorFullName: 'Weir, Patrick',
          date: '2026-07-10',
        }),
        _createdby_value: '936a6d1e-8434-ec11-b6e6-002248228786',
      },
    ];
    const july = bucketRowsByMonth(rows).get('2026-07')!;
    expect(july.get('936a6d1e-8434-ec11-b6e6-002248228786')).toBe('Weir, Patrick');
  });

  it('leaves the name entry null when the payload has no actorFullName', () => {
    const rows: SessionPingRow[] = [
      {
        createdon: iso(2026, 7, 10),
        pmo_payload: JSON.stringify({ actorUserId: 'AAA' }),
        _createdby_value: null,
      },
    ];
    const july = bucketRowsByMonth(rows).get('2026-07')!;
    expect(july.get('aaa')).toBeNull();
  });

  it('upgrades a null name to a real name when a later row carries actorFullName', () => {
    const uid = 'BBB';
    const rows: SessionPingRow[] = [
      {
        createdon: iso(2026, 7, 5),
        pmo_payload: JSON.stringify({ actorUserId: uid }),
        _createdby_value: null,
      },
      {
        createdon: iso(2026, 7, 25),
        pmo_payload: JSON.stringify({ actorUserId: uid, actorFullName: 'Doe, Jane' }),
        _createdby_value: null,
      },
    ];
    const july = bucketRowsByMonth(rows).get('2026-07')!;
    expect(july.get('bbb')).toBe('Doe, Jane');
  });
});
