/**
 * PSS OperationSet diagnostic tile — Admin > Error Log page.
 *
 * PSS caps each user at 10 unexecuted OperationSets at a time. Any
 * opSet that errors between Create and Execute leaks until it expires
 * (~5 min). If a user gets stuck at the 10-cap ceiling their next
 * scheduling write hangs (before Fix A landed 2026-07-16) or fails
 * fast with a friendly timeout (after). Either way the operator wants
 * a way to see the count.
 *
 * The tile polls getOpSetDebug() every 2 seconds and colors itself:
 *   - 0-4 leaked  -> emerald (healthy)
 *   - 5-8 leaked  -> amber (approaching cap)
 *   - 9-10 leaked -> rose  (at cap; new writes will time out)
 *
 * IMPORTANT: this tile reflects only THIS admin's browser tab. It
 * does NOT show other users' opSet state (PSS keeps that server-side
 * and we can't query it via OData). Use as a heuristic when an admin
 * is reproducing a user report on their own account.
 */
import { useEffect, useState } from 'react';
import { getOpSetDebug } from '../../lib/schedulingClient';
import { cn } from '../../lib/utils';

const POLL_MS = 2_000;

export function PssOpSetDiagnosticTile() {
  const [state, setState] = useState(getOpSetDebug);

  useEffect(() => {
    const id = setInterval(() => setState(getOpSetDebug()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const tone: 'ok' | 'warn' | 'danger' =
    state.leaked >= 9 ? 'danger' : state.leaked >= 5 ? 'warn' : 'ok';

  const toneClasses = {
    ok:     'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
    warn:   'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
    danger: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  }[tone];

  const message =
    tone === 'danger'
      ? 'At PSS cap. New task/checklist writes will time out in ~45s. Wait ~5min for opSets to expire, or refresh this tab.'
      : tone === 'warn'
      ? 'Approaching the 10-per-user PSS cap. If it climbs above 9, new writes will start timing out.'
      : 'Healthy. Scheduling API has plenty of headroom.';

  return (
    <div className={cn('rounded-lg border px-4 py-3 flex items-center gap-4', toneClasses)}>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase font-semibold tracking-wider opacity-70">
          PSS OperationSets (this tab)
        </span>
        <div className="flex items-baseline gap-3 mt-0.5">
          <span className="text-2xl font-bold tabular-nums">{state.leaked}</span>
          <span className="text-xs opacity-70">/ 10 in-flight</span>
          <span className="text-xs opacity-70">
            · opened {state.opened} · executed {state.executed}
          </span>
        </div>
      </div>
      <p className="text-xs flex-1 leading-snug">{message}</p>
    </div>
  );
}
