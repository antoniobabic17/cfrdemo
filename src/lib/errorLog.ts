/**
 * Application error log — captures every user-visible failure so admins can
 * diagnose issues after the fact.
 *
 * Every red toast (toast.error) auto-logs one row to pmo_telemetryevent with
 * pmo_eventtype='AppError'. The Admin > Error Log page reads these back and
 * shows: time, user, route, action, message, raw error.
 *
 * The write is silent on failure — piggybacks on useCreateTelemetryEvent's
 * best-effort contract from 2026-07-01. Users without Create on
 * pmo_telemetryevent (some team-role users) won't populate the log for their
 * own actions, but admins with the privilege still see everything they and
 * their peers hit while admin-testing.
 *
 * Payload shape (serialized into pmo_payload):
 *   {
 *     kind: 'AppError',
 *     message: string,       // the friendly text shown to the user in the toast
 *     rawError?: string,     // full serialized error (Dataverse JSON blob etc.)
 *     route: string,         // window.location.hash at time of error
 *     action?: string,       // optional call-site hint, e.g. "create status report"
 *     entityType?: string,   // 'project' | 'task' | ...
 *     entityId?: string,     // GUID
 *     userAgent?: string,
 *   }
 */

import { createTelemetryEvent } from '../api/telemetryEvents.api';
import { TELEMETRY_SEVERITY } from './constants';

export const APP_ERROR_EVENT_TYPE = 'AppError';

export interface AppErrorContext {
  /** Friendly message the user saw in the red toast. Required. */
  message: string;
  /** Full serialized error (Dataverse JSON, stack trace, etc.). Optional but recommended. */
  rawError?: string;
  /** Free-form call-site hint of what the user was trying to do, e.g. "create status report". */
  action?: string;
  /** Optional entity context (helps when investigating a specific record). */
  entityType?: string;
  entityId?: string;
  /** Optional project scope so the row lands in the project's activity feed too. */
  parentProjectId?: string;
  /** Retry-lifecycle fields. Populated by staging mutation retry loops and
   *  by StagingFailureWatcher so Admin > Error Log can group per-attempt
   *  failures under one lifecycle and surface terminal outcomes. */
  attempt?: number;
  outcome?: 'succeeded' | 'abandoned' | 'gave-up-auto-retry';
  /** Correlation id shared across every AppError row emitted for a single
   *  staging lifecycle. Currently the FIRST staging row's pmo_taskstagingid;
   *  each subsequent retry creates a new staging row but reuses this id in
   *  the log payload so the timeline view can group them. */
  stagingRowId?: string;
}

/**
 * Serialize the current route in a stable way. HashRouter puts the path in
 * location.hash (e.g. '#/projects/abc-123'), which we prefer over pathname
 * because it survives page reloads and includes the query/hash suffix that
 * pathname strips.
 */
function currentRoute(): string {
  try {
    const hash = window.location.hash || '';
    const path = window.location.pathname || '';
    return hash || path;
  } catch {
    return '';
  }
}

/**
 * Log one AppError to Dataverse. Fire-and-forget — never throws, never blocks
 * the caller. Failures are only surfaced to the console.
 */
export function logAppError(ctx: AppErrorContext): void {
  const payload = {
    kind: APP_ERROR_EVENT_TYPE,
    message: ctx.message,
    ...(ctx.rawError ? { rawError: ctx.rawError.slice(0, 3500) } : {}),
    route: currentRoute(),
    ...(ctx.action ? { action: ctx.action } : {}),
    ...(ctx.entityType ? { entityType: ctx.entityType } : {}),
    ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
    ...(ctx.attempt !== undefined ? { attempt: ctx.attempt } : {}),
    ...(ctx.outcome ? { outcome: ctx.outcome } : {}),
    ...(ctx.stagingRowId ? { stagingRowId: ctx.stagingRowId } : {}),
    // Project scope lives in the JSON payload, NOT an @odata.bind lookup. The
    // pmo_Project lookup targets the msdyn_project shell, which returns 404 for
    // shell-less (migrated custom-source) projects; because this write is
    // fire-and-forget with a swallowed catch, that 404 silently dropped every
    // error row for those projects. Same fix already applied to useChangeAudit.
    ...(ctx.parentProjectId ? { parentProjectId: ctx.parentProjectId } : {}),
    userAgent: (() => { try { return navigator.userAgent; } catch { return ''; } })(),
  };
  const body: Parameters<typeof createTelemetryEvent>[0] = {
    pmo_eventtype: APP_ERROR_EVENT_TYPE,
    pmo_severity: TELEMETRY_SEVERITY.Error,
    pmo_source: ctx.action || currentRoute(),
    pmo_payload: JSON.stringify(payload),
  };
  // Fire and forget; the API function throws on failure but we swallow.
  createTelemetryEvent(body).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[errorLog] failed to persist AppError (best-effort)', err);
  });
}

/**
 * Structured accessor for the payload JSON — used by the Error Log page to
 * render each row. Falls back gracefully if the row is malformed.
 */
export function parseAppErrorPayload(raw: string | undefined): {
  message?: string;
  rawError?: string;
  route?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  parentProjectId?: string;
  userAgent?: string;
  attempt?: number;
  outcome?: 'succeeded' | 'abandoned' | 'gave-up-auto-retry';
  stagingRowId?: string;
} {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}
