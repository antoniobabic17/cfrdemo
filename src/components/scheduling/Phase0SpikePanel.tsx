/**
 * Phase 0 Validation Spike Panel — DEV ONLY
 *
 * Confirms that the Project Operations scheduling API is reachable from within
 * the Canvas App PCF host before Phase 1 task workspace work begins.
 * Exercises: CreateOperationSetV1 → PssCreateV1 → ExecuteOperationSetV1 → poll.
 * Remove this component once Phase 0 is validated in DEV.
 */
import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import { runPhase0Spike, type SpikeValidationResult } from '../../lib/schedulingClient';

interface Props {
  projectId: string;
  bucketId?: string;
}

export function Phase0SpikePanel({ projectId, bucketId }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpikeValidationResult | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function runSpike() {
    setRunning(true);
    setResult(null);
    try {
      const r = await runPhase0Spike(projectId, bucketId);
      setResult(r);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/20 p-3 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold w-full"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FlaskConical className="h-3.5 w-3.5" />
        DEV: Phase 0 Scheduling API Validation
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground leading-relaxed">
            Tests{' '}
            <code className="bg-muted px-1 rounded">CreateOperationSetV1 → PssCreateV1 → ExecuteOperationSetV1</code>{' '}
            against project <code className="bg-muted px-1 rounded">{projectId.slice(0, 8)}…</code>
            {bucketId && (
              <> / bucket <code className="bg-muted px-1 rounded">{bucketId.slice(0, 8)}…</code></>
            )}
            . Reports timing for each step. A test task named{' '}
            <code className="bg-muted px-1 rounded">PMO-Spike-[ts]</code> will be created in DEV.
          </p>

          <button
            onClick={runSpike}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 text-white disabled:opacity-50 hover:bg-amber-700 transition-colors"
          >
            {running ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
            ) : (
              'Run Phase 0 Spike'
            )}
          </button>

          {result && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold">
                {result.success ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-600" />
                )}
                <span className={result.success ? 'text-green-700' : 'text-rose-700'}>
                  {result.success ? 'PASS' : 'FAIL'} — {result.totalMs}ms total
                </span>
                {result.persistenceLatencyMs !== undefined && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (persistence lag: {result.persistenceLatencyMs}ms)
                  </span>
                )}
              </div>

              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 pr-3 text-muted-foreground font-medium">Step</th>
                    <th className="text-right py-1 pr-3 text-muted-foreground font-medium">ms</th>
                    <th className="text-left py-1 text-muted-foreground font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.steps.map((s, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1 pr-3 font-mono">{s.name}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{s.durationMs}</td>
                      <td className="py-1 max-w-xs">
                        {s.error ? (
                          <span className="text-rose-600 break-all">{s.error}</span>
                        ) : (
                          <span className="text-green-700 truncate block">{JSON.stringify(s.result)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {result.createdTaskId && (
                <p className="text-green-700">
                  Created task ID: <code className="bg-muted px-1 rounded">{result.createdTaskId}</code>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
