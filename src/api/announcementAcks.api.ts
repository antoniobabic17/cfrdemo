/**
 * Persistent per-user announcement acknowledgements.
 *
 * "Single-Time Ack" announcements must be remembered forever per user, across
 * reloads and devices. We store each ack as a pmo_telemetryevent row (the same
 * table the per-user change-audit uses, so ordinary users already have
 * Create/Read rights — no new schema or role change required).
 *
 *   pmo_eventtype: 'AnnouncementAck'
 *   pmo_severity:  Info
 *   pmo_source:    'app'
 *   pmo_payload:   JSON { scope, version, ackedAt }
 *                    scope   = 'global' | `team:${teamId}`
 *                    version = announcement version acked
 * Rows are filtered by _createdby_value so each user only reads their own acks.
 */
import * as dv from '../lib/dataverseClient';
import { ENTITY_SETS, TELEMETRY_SEVERITY } from '../lib/constants';
import type { TelemetryEvent, TelemetryEventCreate } from '../models/telemetryEvent.model';

const SET = ENTITY_SETS.telemetryEvent;
export const ANNOUNCEMENT_ACK_EVENT_TYPE = 'AnnouncementAck';

export type AnnouncementScope = 'global' | `team:${string}`;

export interface AnnouncementAckPayload {
  scope: AnnouncementScope;
  version: number;
  ackedAt: string;
}

/** Build the ack scope string for a global or team announcement. */
export function ackScope(teamId?: string): AnnouncementScope {
  return teamId ? (`team:${teamId}` as AnnouncementScope) : 'global';
}

/**
 * Load the current user's persisted acks. Returns a Set of `${scope}:${version}`
 * keys so callers can O(1)-check whether a given announcement version is acked.
 * Filtered server-side to the current user's own rows.
 */
export async function listMyAnnouncementAcks(userId: string): Promise<Set<string>> {
  const id = userId.replace(/[{}]/g, '').trim().toLowerCase();
  const out = new Set<string>();
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!GUID_RE.test(id)) return out; // 'anonymous' / unresolved — nothing acked
  const rows = await dv.list<TelemetryEvent>(SET, {
    $select: ['pmo_payload', 'createdon'],
    $filter: `pmo_eventtype eq '${ANNOUNCEMENT_ACK_EVENT_TYPE}' and _createdby_value eq ${id} and statecode eq 0`,
    $top: 500,
  });
  for (const r of rows) {
    try {
      const p = JSON.parse(r.pmo_payload) as Partial<AnnouncementAckPayload>;
      if (p && typeof p.scope === 'string' && typeof p.version === 'number') {
        out.add(`${p.scope}:${p.version}`);
      }
    } catch {
      /* malformed payload — ignore */
    }
  }
  return out;
}

/** Persist one ack for the current user (fire-and-forget friendly). */
export async function createAnnouncementAck(scope: AnnouncementScope, version: number): Promise<void> {
  const payload: AnnouncementAckPayload = { scope, version, ackedAt: new Date().toISOString() };
  const body: TelemetryEventCreate = {
    pmo_eventtype: ANNOUNCEMENT_ACK_EVENT_TYPE,
    pmo_severity: TELEMETRY_SEVERITY.Info,
    pmo_source: 'app',
    pmo_payload: JSON.stringify(payload),
  };
  await dv.create<TelemetryEvent>(SET, body);
}
