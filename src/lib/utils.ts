import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Safely extracts a readable message from any thrown value (Error, SDK plain object, or unknown). */
export function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.errorCode === 'string') return e.errorCode;
    return JSON.stringify(err, Object.getOwnPropertyNames(err));
  }
  return String(err);
}

/**
 * True when the raw error string represents PSS's per-user OperationSet quota lockout.
 * PSS limits each user to 10 unexecuted OperationSets at a time; orphans expire ~5 min.
 */
export function isQuotaError(raw: string): boolean {
  return (
    raw.includes('ScheduleAPI-OV-0004') ||
    raw.includes('maximum number of operation set')
  );
}

/** Friendly, single-line copy for the per-user PSS quota lockout. */
export const QUOTA_ERROR_MESSAGE =
  "You've hit Microsoft's per-user limit of 10 in-flight scheduling operations. " +
  'Wait ~5 minutes for them to expire, then try again. ' +
  '(This is a server-side limit and cannot be raised.)';

// ── Permission-error mapping ──────────────────────────────────────────────────
//
// Dataverse rejects unauthorized writes with error code 0x80040220 and a message
// like "is missing prvCreatemsdyn_operationset privilege". The raw text is a wall
// of GUIDs and OTC numbers that scares users. friendlyPermissionError() extracts
// the action + entity and maps to a one-line message that tells them what to do
// (almost always: "ask your admin to add you to a PMO team").

// User-facing name for each Dataverse entity that can surface in a permission
// error. Keys are logical entity names; values are the everyday words a
// non-technical operator would use. Anything NOT in this map falls back to
// the generic "record" rather than exposing the raw Dataverse table name —
// operators shouldn't ever see strings like "telemetry event", "operationset",
// or "systemuser" in an error banner.
const ENTITY_FRIENDLY: Record<string, string> = {
  msdyn_project: 'project',
  msdyn_projectprogram: 'program',
  msdyn_projecttask: 'task',
  msdyn_projectbucket: 'bucket',
  msdyn_projecttaskdependency: 'task dependency',
  msdyn_resourceassignment: 'task assignment',
  msdyn_projectstatusreport: 'status report',
  msdyn_projectrisk: 'risk',
  msdyn_projectissue: 'issue',
  msdyn_projectchange: 'change request',
  pmo_projectrequest: 'intake request',
  pmo_projectteam: 'team assignment',
  pmo_projectdecision: 'decision',
  pmo_projectgate: 'gate',
  pmo_projectgatedecision: 'gate decision',
  pmo_projectcloseout: 'closeout',
  pmo_projectartifactstatus: 'artifact',
  pmo_projectbaseline: 'baseline',
  pmo_projectmeetinglink: 'meeting link',
  pmo_notification: 'notification',
  pmo_userfeedback: 'feedback item',
  // Deliberately NOT surfaced to users — this is an internal audit table.
  // Writes to it are best-effort (see useCreateTelemetryEvent) and should
  // never produce a user-facing error. If one does slip through, at least
  // the copy stays in plain English.
  pmo_telemetryevent: 'change record',
  pmo_gatesetitem: 'intake stage',
  pmo_gatesettemplate: 'intake workflow',
};

const ACTION_FRIENDLY: Record<string, string> = {
  Create: 'create',
  Write: 'update',
  Delete: 'delete',
  Append: 'attach things to',
  AppendTo: 'attach this to a',
  Read: 'view',
  Share: 'share',
  Assign: 'reassign',
};

/**
 * Returns a one-line user-friendly message when `raw` represents a Dataverse
 * permission-denied error, or `null` to let the caller use a different fallback.
 *
 * Covers 0x80040220 PrivilegeDenied, "is missing prv..." messages, and HTTP 403.
 * For msdyn_operationset / msdyn_operationsetdetail — Dataverse infrastructure
 * tables wrapping every PSS write — points at PMO team membership (the real fix).
 */
export function friendlyPermissionError(raw: string): string | null {
  const isPermErr =
    raw.includes('0x80040220') ||
    raw.includes('PrivilegeDenied') ||
    /is missing prv\w+/.test(raw) ||
    /\bHTTP\s*403\b/i.test(raw);
  if (!isPermErr) return null;

  const m = raw.match(/prv(Create|Write|Delete|Append|AppendTo|Read|Share|Assign)([a-zA-Z0-9_]+)/);
  if (!m) {
    return "You don't have permission for this action. Ask your admin to add you to a PMO team.";
  }
  const rawEntity = m[2].toLowerCase();
  const action = ACTION_FRIENDLY[m[1]] ?? m[1].toLowerCase();
  // The full privilege name (e.g. prvCreatemsdyn_projectbucket). Included in
  // every user-facing permission message so admins can jump straight to the
  // exact role privilege that's missing when they investigate. Users find
  // this ugly-but-diagnostic, and the copy in front of it keeps things
  // grounded ("You don't have permission to create this bucket").
  const privilegeName = m[0];

  if (rawEntity === 'msdyn_operationset' || rawEntity === 'msdyn_operationsetdetail') {
    return (
      "You don't have permission to make this change. Missing privilege: " +
      `${privilegeName}. ` +
      'Ask your admin to add you to a PMO team (Process & Project, ' +
      'Business Intelligence, Payer Initiatives, etc.).'
    );
  }
  // Fall back to a generic "record" rather than exposing internal Dataverse
  // table names (e.g. "systemuser", "annotation", "queueitem") to end users.
  // The specific privilege name is still surfaced so admins can look up the
  // exact permission that's missing.
  const entity = ENTITY_FRIENDLY[rawEntity] ?? 'record';
  return (
    `You don't have permission to ${action} this ${entity}. ` +
    `Missing privilege: ${privilegeName}. ` +
    'Ask your admin to add you to the appropriate PMO team.'
  );
}

/**
 * Convenience wrapper around serializeError + friendlyTaskError. Use this in
 * toast.error(...) sites instead of bare `serializeError(err)` so users see
 * "You don't have permission..." instead of a raw Dataverse JSON blob.
 */
export function toFriendlyError(err: unknown, fallback = 'Something went wrong'): string {
  const raw = serializeError(err);
  if (!raw) return fallback;
  return friendlyTaskError(raw);
}

/**
 * Parse a Dataverse error into a user-friendly message. Handles, in order:
 *   1. Permission-denied errors (see friendlyPermissionError)
 *   2. PSS quota / duplicate-assignment / batch-failure / required-columns
 *   3. Generic Dataverse — extract the "message" field from JSON
 *   4. Fallback — return the raw string
 */
export function friendlyTaskError(raw: string): string {
  const permMsg = friendlyPermissionError(raw);
  if (permMsg) return permMsg;

  // ScheduleAPI-OV-0004 — per-user OperationSet quota exceeded
  if (isQuotaError(raw)) return QUOTA_ERROR_MESSAGE;

  // E_DUPASSN — duplicate resource assignment (PSS rejects assigning a person
  // who is already on the task).
  if (raw.includes('E_DUPASSN') || raw.includes('Duplicate assignment')) {
    return 'That person is already assigned to this task.';
  }
  // E_BATCHFAILED with no recognized inner code — generic batch failure
  if (raw.includes('E_BATCHFAILED')) {
    return "The save couldn't complete. Please try again, or undo your last change if it keeps failing.";
  }

  // ScheduleAPI-EV-0003 — missing required columns
  if (raw.includes('ScheduleAPI-EV-0003') || raw.includes('does not contain all the required columns')) {
    const colMatch = raw.match(/required columns are (.+?)(?:"|$)/i);
    const missing = colMatch?.[1]
      ?.split(',')
      .map((c) => c.trim())
      .map((c) => {
        if (c === 'msdyn_subject') return 'Task Name';
        if (c === 'msdyn_project') return 'Project';
        if (c === 'msdyn_projectbucket') return 'Bucket';
        return c;
      })
      .join(', ');
    return missing
      ? `The following required fields are missing: ${missing}. Please fill them in and try again.`
      : 'Some required fields are missing. Please ensure Task Name and Bucket are filled in.';
  }
  // Generic Dataverse error — strip the noise, keep the message
  const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (msgMatch) return msgMatch[1];
  return raw;
}
