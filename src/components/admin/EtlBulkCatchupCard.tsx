/**
 * Option-C Phase 4 admin card: ETL Bulk Catch-up.
 *
 * Re-runs the pmo -> msdyn reverse ETL over a modifiedon date range,
 * backfilling anything the live PmoTaskEtlPlugin skipped while
 * pmo.etl_enabled was false. Invokes the pmo_EtlBulkCatchup Custom API.
 *
 * Admin-only: gated by useWriteGuard('pmo_admin'), same pattern as the other
 * privileged admin panels.
 */
import { useState } from 'react';
import { Loader2, DatabaseZap } from 'lucide-react';
import { Button } from '../ui/button';
import { useAppMutation } from '../../hooks/useAppMutation';
import { useWriteGuard, WriteForbiddenError } from '../../hooks/useWriteGuard';
import { toast } from '../../hooks/useToast';
import {
  invokeEtlBulkCatchup,
  type EtlCatchupResult,
} from '../../api/etlBulkCatchup.api';

/** Convert a `<input type="date">` value (YYYY-MM-DD) to an inclusive ISO
 *  bound. From = start of day, To = end of day, both in UTC to match the
 *  plugin's AssumeUniversal parse. */
function toIsoFrom(ymd: string): string {
  return `${ymd}T00:00:00Z`;
}
function toIsoTo(ymd: string): string {
  return `${ymd}T23:59:59Z`;
}

export function EtlBulkCatchupCard() {
  const guard = useWriteGuard();
  const today = new Date().toISOString().slice(0, 10);
  const [fromYmd, setFromYmd] = useState<string>(today);
  const [toYmd, setToYmd] = useState<string>(today);
  const [includeBuckets, setIncludeBuckets] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [result, setResult] = useState<EtlCatchupResult | null>(null);

  const rangeInvalid = fromYmd > toYmd;

  const mutation = useAppMutation<void, EtlCatchupResult, unknown>({
    action: 'run ETL bulk catch-up',
    mutationFn: async () => {
      const check = guard('pmo_admin');
      if (!check.allow) throw new WriteForbiddenError(check.reason ?? 'Not allowed.', 'pmo_admin');
      return invokeEtlBulkCatchup({
        fromDate: toIsoFrom(fromYmd),
        toDate: toIsoTo(toYmd),
        includeBuckets,
        includeDependencies,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      toast.success(`Catch-up complete: ${res.pushed} pushed, ${res.failed} failed.`);
    },
  });

  return (
    <div>
      <div className="flex items-center gap-2">
        <DatabaseZap className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold text-foreground">ETL Bulk Catch-up</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Re-mirror pmo_task / pmo_bucket / pmo_taskdependency rows out to
        msdyn (P4W) for a date range. Use after the reverse ETL was disabled
        (<code>pmo.etl_enabled = false</code>) to backfill the gap. Idempotent —
        safe to re-run. Keep ranges narrow (the action runs synchronously).
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From (modifiedon)
          <input
            type="date"
            value={fromYmd}
            max={toYmd}
            onChange={(e) => setFromYmd(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To (modifiedon)
          <input
            type="date"
            value={toYmd}
            min={fromYmd}
            onChange={(e) => setToYmd(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input type="checkbox" checked={includeBuckets} onChange={(e) => setIncludeBuckets(e.target.checked)} />
          Buckets
        </label>
        <label className="flex items-center gap-1.5 text-xs text-foreground">
          <input type="checkbox" checked={includeDependencies} onChange={(e) => setIncludeDependencies(e.target.checked)} />
          Dependencies
        </label>
        <Button
          size="sm"
          onClick={() => { setResult(null); mutation.mutate(); }}
          disabled={mutation.isPending || rangeInvalid}
        >
          {mutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Run catch-up
        </Button>
      </div>

      {rangeInvalid && (
        <p className="mt-2 text-xs text-destructive">From date must be on or before To date.</p>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground">
          <div className="font-medium">
            Pushed {result.pushed} · Failed {result.failed}
          </div>
          {Object.keys(result.byEntity).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {Object.entries(result.byEntity).map(([entity, c]) => (
                <li key={entity}>
                  {entity}: {c.pushed} pushed{c.failed > 0 ? `, ${c.failed} failed` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
