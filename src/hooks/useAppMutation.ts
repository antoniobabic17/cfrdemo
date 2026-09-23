/**
 * useAppMutation -- the ONE mutation wrapper every write in the app
 * should route through.
 *
 * Why this exists:
 *   Historically each mutation hook was a bare `useMutation({ mutationFn,
 *   onSuccess })` with no error handling. When Dataverse returned 403 /
 *   500 / timeout, React Query held the rejection privately, no toast
 *   fired, no Error Log row landed. See Investigation 2 rows 4-7 on
 *   PROD 2026-07-15 (meeting-link + pmo_taskstaging permission denies
 *   that surfaced through two different, inconsistent paths).
 *
 * What it gives you:
 *   1. **Timeout** (default 60s). Any mutation that doesn't settle in
 *      time rejects with a friendly "Timeout after 60s: <action>"
 *      instead of spinning the caller forever. Under the hood via
 *      lib/withTimeout.ts -- same helper PSS scheduling uses.
 *   2. **Retry on transient errors** (default: shared retryPolicy).
 *      NOTEDITABLE / CorrelationId / Entity Key / E_BATCHFAILED /
 *      Timeout after -- retried up to 4 times with 3/6/10s backoff.
 *      Callers can override or disable via opts.retry.
 *   3. **Toast + Error Log on any failure**. onError always fires
 *      toast.error(msg, ctx) which auto-logs to pmo_telemetryevent
 *      via useToast.ts. The AppErrorContext is fully populated from
 *      opts.action / entityType / entityId / parentProjectId.
 *   4. **Standard React Query hook shape** -- returns
 *      UseMutationResult<TData, unknown, TVars> so callers can still
 *      use .mutate / .mutateAsync / .isPending exactly as before.
 *
 * The staging retry loops (useProjectTaskMutations.ts,
 * useProjectChecklists.ts) do NOT use this helper because they need
 * per-attempt logAppError rows with attempt/stagingRowId/outcome
 * fields; they own their own logging loops. Every OTHER mutation in
 * the app should migrate to useAppMutation.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../lib/withTimeout';
import { runWithRetry as sharedRunWithRetry } from '../lib/retryPolicy';
import { toast } from './useToast';
import { toFriendlyError, serializeError } from '../lib/utils';
import type { AppErrorContext } from '../lib/errorLog';

type MaybeFn<T, Vars> = T | ((vars: Vars) => T);

function resolve<T, Vars>(v: MaybeFn<T, Vars> | undefined, vars: Vars): T | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'function' ? (v as (vars: Vars) => T)(vars) : v;
}

export interface AppMutationOptions<TVars, TData, TContext = unknown> {
  /** Your actual write. Wrapped with timeout + retry-on-transient
   *  before invocation. Must return a Promise. */
  mutationFn: (vars: TVars) => Promise<TData>;

  /** Short, human-readable label of what the user was trying to do.
   *  Populated into AppErrorContext.action AND used as the fallback
   *  toast message when errorMessage isn't provided. Required so
   *  Admin > Error Log rows are meaningful. */
  action: string;

  /** Optional entity context. entityId + parentProjectId can be static
   *  strings or functions derived from the mutation vars. */
  entityType?: string;
  entityId?: MaybeFn<string | undefined, TVars>;
  parentProjectId?: MaybeFn<string | undefined, TVars>;

  /** Override the red-toast message. Static string or function of
   *  (vars, err). Default: `"Couldn't <action>: <friendly error>"`. */
  errorMessage?: MaybeFn<string, TVars> | ((vars: TVars, err: unknown) => string);

  /** Standard react-query success handler. Runs AFTER the write
   *  resolves, gets both the result and the original vars. */
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;

  /** Standard react-query onMutate for optimistic updates. Runs BEFORE
   *  mutationFn; return value flows into context. */
  onMutate?: (vars: TVars) => TContext | Promise<TContext>;

  /** Additional onError hook -- runs BEFORE the toast/log wiring so
   *  callers can roll back optimistic cache updates. Do NOT toast from
   *  here; useAppMutation owns that. */
  onError?: (err: unknown, vars: TVars, context: TContext | undefined) => void;

  /** Standard react-query onSettled -- runs after success OR error.
   *  Common use: qc.invalidateQueries. */
  onSettled?: (data: TData | undefined, err: unknown, vars: TVars, context: TContext | undefined) => void;

  /** Some mutations are expected to fail on certain inputs (e.g. row
   *  already deleted). Return true to skip the red toast for that
   *  case. The row still lands in Error Log so admins can audit the
   *  frequency. */
  suppressToastPredicate?: (err: unknown) => boolean;

  /** Override the timeout. Default 60s (DEFAULT_TIMEOUT_MS from
   *  lib/withTimeout). Set to 0 or negative to disable. */
  timeoutMs?: number;

  /** Retry override. `false` disables retry entirely (single attempt).
   *  Omit to use the shared policy. */
  retry?: false | { runner?: <T>(fn: () => Promise<T>) => Promise<T> };
}

export function useAppMutation<TVars, TData, TContext = unknown>(
  opts: AppMutationOptions<TVars, TData, TContext>,
): UseMutationResult<TData, unknown, TVars, TContext> {
  const timeout = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const retryRunner: <T>(fn: () => Promise<T>) => Promise<T> =
    opts.retry === false
      ? (fn) => fn()
      : (opts.retry?.runner ?? sharedRunWithRetry);

  return useMutation<TData, unknown, TVars, TContext>({
    mutationFn: async (vars: TVars) => {
      const wrapped = () =>
        timeout > 0
          ? withTimeout(opts.mutationFn(vars), opts.action, timeout)
          : opts.mutationFn(vars);
      return retryRunner(wrapped);
    },
    onMutate: opts.onMutate,
    onSuccess: opts.onSuccess,
    onSettled: opts.onSettled,
    onError: (err, vars, context) => {
      // Caller's rollback first, then our toast + log wiring.
      opts.onError?.(err, vars, context);
      const suppress = opts.suppressToastPredicate?.(err) === true;
      // Build the friendly toast message.
      let message: string;
      if (opts.errorMessage) {
        const em = opts.errorMessage;
        message = typeof em === 'function' ? (em as (v: TVars, e: unknown) => string)(vars, err) : em;
      } else {
        message = `Couldn't ${opts.action}: ${toFriendlyError(err)}`;
      }
      // Build the AppErrorContext for the error log.
      const ctx: Omit<AppErrorContext, 'message'> = {
        rawError: serializeError(err),
        action: opts.action,
        entityType: opts.entityType,
        entityId: resolve(opts.entityId, vars),
        parentProjectId: resolve(opts.parentProjectId, vars),
      };
      if (suppress) {
        // Log without the toast. Use logAppError directly.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void import('../lib/errorLog').then(({ logAppError }) => {
          logAppError({ message, ...ctx });
        });
        return;
      }
      // toast.error auto-logs the AppError via useToast.ts.
      toast.error(message, ctx);
    },
    // Client-side retry lives in our runner above; disable react-query's
    // built-in mutation retry so it doesn't stack.
    retry: 0,
  });
}
