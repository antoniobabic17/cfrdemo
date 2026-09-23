/**
 * Cost Ledger API — backed by the `pmo_costledgeritem` Dataverse table.
 *
 * One row per cost line item on a Financial project's ledger. Rows are parented
 * to a project by plain-text GUID (`pmo_projectid`) — the same polymorphic
 * plain-text-parent convention as `pmo_tracking.pmo_recordid`, so no real
 * Dataverse lookup relationship is needed. The CFR PMO roles have Global CRUD on
 * this table, so any user on a shared project can read/write its cost items.
 *
 * Column map:
 *   pmo_item        — the line-item name, e.g. "Contractor — Q3"
 *   pmo_cost        — Money (returned by the Web API as a plain decimal number)
 *   pmo_description — optional free-text note
 *   pmo_projectid   — parent project GUID as plain text (no braces, lowercase)
 */
import * as dv from '../lib/dataverseClient';

const SET = 'pmo_costledgeritems';

export interface CostLedgerItem {
  pmo_costledgeritemid: string;
  pmo_item: string;
  pmo_cost?: number | null;
  pmo_description?: string | null;
  pmo_projectid: string;
  statecode?: 0 | 1;
  createdon?: string;
  _createdby_value?: string;
  '_createdby_value@OData.Community.Display.V1.FormattedValue'?: string;
}

const SELECT: string[] = [
  'pmo_costledgeritemid', 'pmo_item', 'pmo_cost', 'pmo_description',
  'pmo_projectid', 'statecode', 'createdon', '_createdby_value',
];

const norm = (id: string) => id.replace(/[{}]/g, '').toLowerCase();

/** List active cost ledger items for a project, oldest first. */
export async function listCostLedgerItems(projectId: string): Promise<CostLedgerItem[]> {
  const safeId = norm(projectId).replace(/'/g, "''");
  return dv.list<CostLedgerItem>(SET, {
    $select: SELECT,
    $filter: `pmo_projectid eq '${safeId}' and statecode eq 0`,
    $orderby: 'createdon asc',
  });
}

export interface CostLedgerInput {
  item: string;
  cost: number;
  description?: string;
}

/** Add a cost line item to a project. */
export async function addCostLedgerItem(
  projectId: string,
  input: CostLedgerInput,
): Promise<CostLedgerItem> {
  return dv.create<CostLedgerItem>(SET, {
    pmo_name: input.item,        // primary-name column (required by Dataverse)
    pmo_item: input.item,
    pmo_cost: input.cost,
    pmo_description: input.description ?? null,
    pmo_projectid: norm(projectId),
  });
}

/** Patch an existing cost line item. */
export async function updateCostLedgerItem(
  id: string,
  patch: Partial<CostLedgerInput>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.item !== undefined) { payload.pmo_name = patch.item; payload.pmo_item = patch.item; }
  if (patch.cost !== undefined) payload.pmo_cost = patch.cost;
  if (patch.description !== undefined) payload.pmo_description = patch.description ?? null;
  return dv.update(SET, id, payload);
}

/**
 * Remove a cost line item by its row ID. Hard delete — ledger rows are small and
 * have no historical value once removed (mirrors pmo_tracking cleanup).
 */
export async function removeCostLedgerItem(id: string): Promise<void> {
  return dv.remove(SET, id);
}

/** Sum the cost across a list of ledger items (nulls treated as 0). */
export function sumCostLedger(items: CostLedgerItem[]): number {
  return items.reduce((total, i) => total + (i.pmo_cost ?? 0), 0);
}
