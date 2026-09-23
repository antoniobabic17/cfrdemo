import { describe, expect, it } from 'vitest';
import { groupByRecord, type TrackingLabel } from './trackingLabels.api';

function row(overrides: Partial<TrackingLabel>): TrackingLabel {
  return {
    pmo_trackingid: 'row-id',
    pmo_label: 'Business Process',
    pmo_recordtype: 'Project',
    pmo_recordid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    statecode: 0,
    ...overrides,
  };
}

describe('groupByRecord', () => {
  it('returns an empty map for an empty input', () => {
    expect(groupByRecord([]).size).toBe(0);
  });

  it('groups a single row under its record id', () => {
    const rows = [row({ pmo_recordid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pmo_label: 'Business Process' })];
    const m = groupByRecord(rows);
    expect(m.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toEqual(['Business Process']);
  });

  it('groups multiple labels for the same record into one array (multi-label support)', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const rows = [
      row({ pmo_recordid: id, pmo_label: 'Business Process' }),
      row({ pmo_recordid: id, pmo_label: 'High Priority' }),
    ];
    const m = groupByRecord(rows);
    expect(m.get(id)).toEqual(['Business Process', 'High Priority']);
  });

  it('keeps different records in separate map entries', () => {
    const rows = [
      row({ pmo_recordid: 'aaaaaaaa-0000-0000-0000-000000000001', pmo_label: 'Business Process' }),
      row({ pmo_recordid: 'bbbbbbbb-0000-0000-0000-000000000002', pmo_label: 'High Priority' }),
    ];
    const m = groupByRecord(rows);
    expect(m.size).toBe(2);
    expect(m.get('aaaaaaaa-0000-0000-0000-000000000001')).toEqual(['Business Process']);
    expect(m.get('bbbbbbbb-0000-0000-0000-000000000002')).toEqual(['High Priority']);
  });

  it('normalizes record ids to lowercase and strips braces so lookups by GUID always match', () => {
    const rows = [row({ pmo_recordid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}' })];
    const m = groupByRecord(rows);
    expect(m.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toEqual(['Business Process']);
    expect(m.has('{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}')).toBe(false);
  });
});
