/**
 * useChangeAudit — user-action audit hook.
 *
 * Wave 1 of the user-action change history. Captures every program / project /
 * task create / update / delete the user makes, writing one pmo_telemetryevent
 * row per action so the existing /admin/change-history page (filtered to
 * AdminChange today) can be extended in Wave 2 to render natural-language
 * entries like "Antonio modified start date on task X at <timestamp>".
 *
 * Storage: reuses pmo_telemetryevent — zero solution schema change. Mirrors
 * the useAdminAudit pattern. New pmo_eventtype value 'EntityChange'.
 *
 * Payload contract (JSON-serialized into pmo_payload):
 *   {
 *     entityType: 'project' | 'program' | 'task',
 *     entityId: string,
 *     entityName: string,                // name AT TIME OF change
 *     action: 'create' | 'update' | 'delete',
 *     changes?: Array<{                  // present for 'update' only
 *       field: string,                   // dataverse column or domain key
 *       label: string,                   // user-facing name e.g. "start date"
 *       old: unknown,
 *       new: unknown,
 *     }>,
 *     parentProjectId?: string,          // when known (always for tasks)
 *     parentProjectName?: string,
 *   }
 *
 * Row metadata:
 *   pmo_eventtype: 'EntityChange'
 *   pmo_source:    entityType            // gives the existing filter dropdown
 *                                        // a useful grouping key
 *   pmo_Project@odata.bind: parent project lookup when present, so per-project
 *   activity feeds can filter cheaply without parsing JSON.
 *   _createdby_value + createdon are auto-populated by Dataverse.
 *
 * Failure mode: audit writes are best-effort. They never block the user-facing
 * mutation. If the telemetry create rejects we swallow + console.warn so the
 * primary action still succeeds. (Auditing is for visibility, not for
 * correctness — never let it become a save-blocker.)
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateTelemetryEvent } from './useTelemetryEvents';
import { useCurrentUserId } from './useCurrentUserId';
import { TELEMETRY_SEVERITY } from '../lib/constants';
import * as dv from '../lib/dataverseClient';

export type ChangeAuditEntityType = 'project' | 'program' | 'task' | 'risk' | 'issue' | 'change' | 'statusreport' | 'intake';
export type ChangeAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  // Intake-specific lifecycle actions. Rendered with their own verbs on the
  // Change History page so "submitted" / "approved" / "sent back" / "rejected"
  // read naturally in the timeline (instead of being conflated with generic
  // 'update' rows).
  | 'submit'
  | 'approve'
  | 'sendback'
  | 'reject';

/**
 * One change inside a batched audit row. A single Submit can carry many of
 * these (e.g. user changed start date + added 2 labels + removed an assignee).
 * Wave 2 renders these as individual lines under the parent row in the
 * Change History page.
 */
export type ChangeAuditEntry =
  | {
      kind: 'field';
      /** Dataverse column or domain key — stable identifier. */
      field: string;
      /** User-facing label rendered in the activity feed (e.g. "Start date"). */
      label: string;
      old: unknown;
      new: unknown;
    }
  | {
      kind: 'relationship';
      /** Stable identifier for the relationship type — e.g. 'label', 'assignee'. */
      relation: string;
      /** What happened. 'add' / 'remove' / 'update' for renames or toggles. */
      action: 'add' | 'remove' | 'update';
      /** Human-readable name of the related thing — e.g. "P0", "Antonio Lima". */
      label: string;
      /** Optional extra detail rendered as " — old → new" for renames/toggles. */
      old?: unknown;
      new?: unknown;
    };

/** @deprecated Use ChangeAuditEntry. Kept as an alias for backward compatibility. */
export type ChangeAuditFieldDiff = Extract<ChangeAuditEntry, { kind: 'field' }>;

export interface ChangeAuditParams {
  entityType: ChangeAuditEntityType;
  entityId: string;
  entityName: string;
  action: ChangeAuditAction;
  /** Required when action === 'update'. Ignored otherwise. */
  changes?: ChangeAuditEntry[];
  /** Always include for tasks; optional otherwise. */
  parentProjectId?: string;
  parentProjectName?: string;
}

export const ENTITY_CHANGE_EVENT_TYPE = 'EntityChange';

export function useChangeAudit() {
  const create = useCreateTelemetryEvent();
  const qc = useQueryClient();
  const currentUserId = useCurrentUserId();
  // Resolve the current user's fullname once per session so every audit row
  // can carry it. Needed because the row's _createdby_value may attribute to
  // a service context (e.g. 'Project, Microsoft' when PSS runs the write)
  // rather than the real actor. The ActivityFeed renderer prefers
  // payload.actorFullName over _createdby_value.
  const actorFullNameRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!currentUserId || actorFullNameRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await dv.get<{ fullname?: string }>('systemusers', currentUserId, ['fullname']);
        if (!cancelled) actorFullNameRef.current = u.fullname;
      } catch {
        /* best-effort; leave undefined and let renderer fall back */
      }
    })();
    return () => { cancelled = true; };
  }, [currentUserId]);

  const audit = useCallback((params: ChangeAuditParams) => {
    // Drop empty 'update' rows — nothing changed, no point writing a row.
    if (params.action === 'update' && (!params.changes || params.changes.length === 0)) {
      return;
    }

    const payload = {
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName,
      action: params.action,
      // Carry `changes` for any action that has them. 'update' is the
      // most common, but intake lifecycle actions (submit/approve/sendback/
      // reject) also use changes to record rationale / clarification text /
      // status transitions as field-level entries.
      ...(params.changes && params.changes.length > 0 ? { changes: params.changes } : {}),
      ...(params.parentProjectId ? { parentProjectId: params.parentProjectId } : {}),
      ...(params.parentProjectName ? { parentProjectName: params.parentProjectName } : {}),
      // Explicit actor. When the mutation ran in a PSS/service context the
      // resulting telemetry row's _createdby_value is unreliable; the renderer
      // reads these fields first.
      ...(currentUserId ? { actorUserId: currentUserId } : {}),
      ...(actorFullNameRef.current ? { actorFullName: actorFullNameRef.current } : {}),
    };

    // NOTE: intentionally NO `pmo_Project@odata.bind` here. That lookup
    // targets the PSS-owned msdyn_project entity, so binding it requires the
    // caller to hold AppendTo on msdyn_project. On the custom (Option-C)
    // source PMO members create/edit against pmo_project and never touch the
    // msdyn shell, so the bind rejected their audit write and change history
    // came up empty (e.g. Anna Gimenez's PROJ-1299). The project id is already
    // in the JSON payload (entityId for project rows, parentProjectId for
    // task rows) and the ActivityFeed reader now scopes by payload match, so
    // nothing is lost and the row becomes a plain telemetry write any user can make.
    const body: Parameters<typeof create.mutate>[0] = {
      pmo_eventtype: ENTITY_CHANGE_EVENT_TYPE,
      pmo_severity: TELEMETRY_SEVERITY.Info,
      pmo_source: params.entityType,
      pmo_payload: JSON.stringify(payload),
    };

    create.mutate(body, {
      onSuccess: () => {
        // Refresh every consumer of the change-history feed so the new row
        // appears immediately without the user having to manually reload.
        // Covers:
        //   - admin /change-history page          ['changeHistory', ...]
        //   - per-entity Activity feeds           ['activityFeed', ...]
        qc.invalidateQueries({ queryKey: ['changeHistory'] });
        qc.invalidateQueries({ queryKey: ['activityFeed'] });
      },
      onError: (err) => {
        // Best-effort: never block the primary mutation. Surface in console
        // for diagnostics but do not toast / re-throw.
        console.warn('[useChangeAudit] failed to write telemetry event', err);
      },
    });
  }, [create, qc, currentUserId]);

  return audit;
}
