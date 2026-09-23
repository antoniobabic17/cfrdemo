import { describe, expect, it } from 'vitest';
import { sumCostLedger, type CostLedgerItem } from './costLedger.api';

function row(overrides: Partial<CostLedgerItem>): CostLedgerItem {
  return {
    pmo_costledgeritemid: 'row-id',
    pmo_item: 'Contractor',
    pmo_cost: 100,
    pmo_projectid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    statecode: 0,
    ...overrides,
  };
}

describe('sumCostLedger', () => {
  it('returns 0 for an empty list', () => {
    expect(sumCostLedger([])).toBe(0);
  });

  it('sums the cost across items', () => {
    const items = [row({ pmo_cost: 100 }), row({ pmo_cost: 250 }), row({ pmo_cost: 50 })];
    expect(sumCostLedger(items)).toBe(400);
  });

  it('treats null/undefined cost as 0', () => {
    const items = [row({ pmo_cost: 100 }), row({ pmo_cost: null }), row({ pmo_cost: undefined })];
    expect(sumCostLedger(items)).toBe(100);
  });

  it('handles decimal costs', () => {
    const items = [row({ pmo_cost: 10.5 }), row({ pmo_cost: 4.25 })];
    expect(sumCostLedger(items)).toBeCloseTo(14.75);
  });
});
