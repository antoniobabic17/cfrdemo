import { describe, expect, it } from 'vitest';
import { parseEtlCatchupResult } from './etlBulkCatchup.api';

describe('parseEtlCatchupResult', () => {
  it('parses a well-formed summary', () => {
    const raw = '{"pushed":5,"failed":1,"byEntity":{"pmo_task":{"pushed":3,"failed":1},"pmo_bucket":{"pushed":2,"failed":0}}}';
    expect(parseEtlCatchupResult(raw)).toEqual({
      pushed: 5,
      failed: 1,
      byEntity: {
        pmo_task: { pushed: 3, failed: 1 },
        pmo_bucket: { pushed: 2, failed: 0 },
      },
    });
  });

  it('returns a zeroed summary when the payload is undefined', () => {
    expect(parseEtlCatchupResult(undefined)).toEqual({ pushed: 0, failed: 0, byEntity: {} });
  });

  it('returns a zeroed summary on malformed JSON rather than throwing', () => {
    expect(parseEtlCatchupResult('not json')).toEqual({ pushed: 0, failed: 0, byEntity: {} });
  });

  it('defaults missing numeric fields to 0', () => {
    expect(parseEtlCatchupResult('{"byEntity":{}}')).toEqual({ pushed: 0, failed: 0, byEntity: {} });
  });
});
