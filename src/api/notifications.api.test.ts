import { describe, expect, it, vi, beforeEach } from 'vitest';

const list = vi.fn();
vi.mock('../lib/dataverseClient', () => ({
  list: (...a: unknown[]) => list(...a),
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
}));

import { listNotifications } from './notifications.api';

const GUID = 'fc98d586-8aff-f011-8407-6045bdd9f8fd';

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue([]);
});

describe('listNotifications — guards against non-GUID user ids', () => {
  it("returns [] for 'anonymous' WITHOUT querying (the Code Apps regression)", async () => {
    const out = await listNotifications('anonymous');
    expect(out).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns [] for empty / undefined without querying', async () => {
    await listNotifications('');
    await listNotifications(undefined as unknown as string);
    expect(list).not.toHaveBeenCalled();
  });

  it('queries with an UNQUOTED guid for a valid id', async () => {
    await listNotifications(GUID);
    expect(list).toHaveBeenCalledTimes(1);
    const params = list.mock.calls[0][1];
    expect(params.$filter).toBe(`_pmo_targetuser_value eq ${GUID} and statecode eq 0`);
    // must NOT wrap the guid in quotes (that triggers Edm.Guid/Edm.String in the SDK)
    expect(params.$filter).not.toContain(`'${GUID}'`);
  });

  it('normalizes braces / casing before querying', async () => {
    await listNotifications(`{${GUID.toUpperCase()}}`);
    expect(list.mock.calls[0][1].$filter).toBe(`_pmo_targetuser_value eq ${GUID} and statecode eq 0`);
  });
});
