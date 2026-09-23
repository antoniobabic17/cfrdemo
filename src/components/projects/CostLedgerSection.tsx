/**
 * CostLedgerSection — per-project cost ledger for Financial projects.
 *
 * Shown on the Plan → Resources tab in place of the labor "New Resource Model"
 * hours table when a project's Resource Metric Type is Financial. Users add cost
 * line items (item, cost, optional description); a summary header shows the
 * forecasted budget (proj_budget), the live spent total, and the remaining/over
 * amount. The running total is written back to proj_actualcost so the existing
 * Financials card / BudgetBar / Variance / ROI stay in sync.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { useCostLedgerItems, useAddCostLedgerItem, useRemoveCostLedgerItem } from '../../hooks/useCostLedger';
import { sumCostLedger } from '../../api/costLedger.api';
import { useUpdateProject } from '../../hooks/useProjects';
import { READ_ONLY_TOOLTIP } from '../../hooks/useProjectPermissions';

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function fmtCurrency(v?: number) { return v != null ? currencyFmt.format(v) : '—'; }

interface CostLedgerSectionProps {
  projectId: string;
  /** Original forecasted budget for the project (proj_budget). */
  budget?: number;
  /** Current proj_actualcost — used to avoid redundant writeback PATCHes. */
  currentActualCost?: number;
  canEdit: boolean;
}

export function CostLedgerSection({ projectId, budget, currentActualCost, canEdit }: CostLedgerSectionProps) {
  const { data: items = [], isLoading, isFetching } = useCostLedgerItems(projectId);
  const addItem = useAddCostLedgerItem(projectId);
  const removeItem = useRemoveCostLedgerItem(projectId);
  const updateProject = useUpdateProject(projectId);

  const [itemDraft, setItemDraft] = useState('');
  const [costDraft, setCostDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const spent = sumCostLedger(items);
  const remaining = budget != null ? budget - spent : undefined;
  const isOver = remaining != null && remaining < 0;

  // Writeback: keep proj_actualcost in sync with the live ledger total so the
  // Financials card / variance / ROI reflect it. Only PATCH when the sum actually
  // differs from the current value, and never mid-fetch (avoids a write loop).
  const lastWritten = useRef<number | null>(null);
  useEffect(() => {
    if (isLoading || isFetching) return;
    if (!canEdit) return;
    const current = currentActualCost ?? 0;
    if (spent === current) { lastWritten.current = spent; return; }
    if (lastWritten.current === spent) return; // already pushed this value
    lastWritten.current = spent;
    updateProject.mutate({ proj_actualcost: spent });
    // updateProject is stable per project; deliberately excluded to avoid re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spent, currentActualCost, isLoading, isFetching, canEdit]);

  async function handleAdd() {
    setAddError(null);
    const item = itemDraft.trim();
    const cost = parseFloat(costDraft);
    if (!item) { setAddError('Enter an item name.'); return; }
    if (costDraft === '' || isNaN(cost) || cost < 0) { setAddError('Enter a valid cost (0 or more).'); return; }
    try {
      await addItem.mutateAsync({ item, cost, description: descDraft.trim() || undefined });
      setItemDraft(''); setCostDraft(''); setDescDraft('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await removeItem.mutateAsync(id);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="border-t border-border/40 pt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Cost Ledger
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Track project costs against the forecasted budget.
      </p>

      {/* Summary header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 max-w-3xl">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Forecasted Budget</p>
          <p className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(budget)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Spent</p>
          <p className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(spent)}</p>
        </div>
        <div className={cn('rounded-xl border p-4', isOver ? 'border-rose-200 bg-rose-50' : 'border-border bg-card')}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {isOver ? 'Over Budget' : 'Remaining'}
          </p>
          <p className={cn('text-lg font-semibold tabular-nums', isOver ? 'text-rose-600' : 'text-emerald-600')}>
            {remaining == null ? '—' : fmtCurrency(Math.abs(remaining))}
          </p>
        </div>
      </div>

      {/* Budget utilization bar */}
      {budget != null && budget > 0 && (
        <div className="mb-4 max-w-3xl">
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Budget utilization</span>
            <span className={cn('font-semibold', isOver ? 'text-rose-600' : 'text-foreground')}>
              {Math.round((spent / budget) * 100)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full', isOver ? 'bg-rose-500' : (spent / budget) > 0.9 ? 'bg-amber-500' : 'bg-emerald-500')}
              style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Add-item row */}
      {canEdit && (
        <div className="max-w-3xl mb-4 rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_120px] gap-2">
            <input
              type="text"
              value={itemDraft}
              onChange={(e) => setItemDraft(e.target.value)}
              placeholder="Item (e.g. Contractor — Q3)"
              className="text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
            />
            <input
              type="number"
              min={0}
              step={0.01}
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              placeholder="Cost"
              className="text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary tabular-nums"
            />
          </div>
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary resize-none"
          />
          {addError && (
            <div className="flex items-center gap-1 text-[11px] text-rose-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {addError}
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd} disabled={addItem.isPending}
              className="h-8 px-3 text-xs">
              {addItem.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Add item
            </Button>
          </div>
        </div>
      )}

      {/* Ledger table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground italic">Loading cost items…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No cost items yet.</p>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden max-w-3xl">
          <div className={cn('grid gap-x-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground',
            canEdit ? 'grid-cols-[minmax(0,2fr)_110px_minmax(0,2fr)_40px]' : 'grid-cols-[minmax(0,2fr)_110px_minmax(0,2fr)]')}>
            <span>Item</span>
            <span className="text-right">Cost</span>
            <span>Description</span>
            {canEdit && <span />}
          </div>
          <div className="divide-y divide-border/60">
            {items.map((row) => (
              <div key={row.pmo_costledgeritemid}
                className={cn('grid gap-x-4 px-4 py-3 items-center hover:bg-muted/20 transition-colors',
                  canEdit ? 'grid-cols-[minmax(0,2fr)_110px_minmax(0,2fr)_40px]' : 'grid-cols-[minmax(0,2fr)_110px_minmax(0,2fr)]')}>
                <span className="text-sm font-medium text-foreground truncate" title={row.pmo_item}>{row.pmo_item}</span>
                <span className="text-sm text-right tabular-nums text-foreground">{fmtCurrency(row.pmo_cost ?? 0)}</span>
                <span className="text-sm text-muted-foreground truncate" title={row.pmo_description ?? ''}>{row.pmo_description || '—'}</span>
                {canEdit && (
                  <button
                    onClick={() => handleRemove(row.pmo_costledgeritemid)}
                    disabled={removingId === row.pmo_costledgeritemid}
                    className="hover:text-destructive transition-colors shrink-0 disabled:opacity-40"
                    title="Remove item"
                  >
                    {removingId === row.pmo_costledgeritemid
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!canEdit && (
        <p className="text-[11px] text-muted-foreground mt-2" title={READ_ONLY_TOOLTIP}>
          Read-only — you aren't assigned to this project.
        </p>
      )}
    </div>
  );
}
