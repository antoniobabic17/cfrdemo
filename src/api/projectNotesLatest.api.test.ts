import { describe, expect, it, vi, beforeEach } from 'vitest';

const list = vi.fn();
vi.mock('../lib/dataverseClient', () => ({
  list: (...a: unknown[]) => list(...a),
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
}));

import { listLatestNotesForProjects } from './projectNotes.api';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue([]);
});

describe('listLatestNotesForProjects', () => {
  it('returns an empty map WITHOUT querying when no ids are supplied', async () => {
    const out = await listLatestNotesForProjects([]);
    expect(out.size).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });

  it('filters on the supplied objecttypecode and excludes documents', async () => {
    await listLatestNotesForProjects([P1], 'pmo_project');
    expect(list).toHaveBeenCalledTimes(1);
    const params = list.mock.calls[0][1];
    expect(params.$filter).toContain(`_objectid_value eq ${P1}`);
    expect(params.$filter).toContain("objecttypecode eq 'pmo_project'");
    expect(params.$filter).toContain('isdocument eq false');
    expect(params.$orderby).toBe('createdon desc');
  });

  it('keeps the newest note per project (by createdon)', async () => {
    list.mockResolvedValueOnce([
      { annotationid: 'a', _objectid_value: P1, notetext: 'older', createdon: '2026-01-01T00:00:00Z' },
      { annotationid: 'b', _objectid_value: P1, notetext: 'newer', createdon: '2026-06-01T00:00:00Z' },
      { annotationid: 'c', _objectid_value: P2, notetext: 'only', createdon: '2026-03-01T00:00:00Z' },
    ]);
    const out = await listLatestNotesForProjects([P1, P2], 'pmo_project');
    expect(out.get(P1)?.notetext).toBe('newer');
    expect(out.get(P2)?.notetext).toBe('only');
  });

  it('ignores rows with no _objectid_value', async () => {
    list.mockResolvedValueOnce([
      { annotationid: 'x', notetext: 'orphan', createdon: '2026-06-01T00:00:00Z' },
    ]);
    const out = await listLatestNotesForProjects([P1], 'pmo_project');
    expect(out.size).toBe(0);
  });
});
