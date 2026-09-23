/**
 * useSessionPing — writes one pmo_telemetryevent per user per day on app
 * load so the Permissions admin page can count monthly unique active
 * users (Part A of the security-model rewrite).
 *
 * Dedup: sessionStorage keeps a per-tab-per-day flag; even multiple
 * reloads within a day only write once (per browser session). Cross-tab
 * writes may double up until either tab is closed -- accepted trade-off
 * to keep the guard local and cookie-free. The Permissions page always
 * counts distinct systemuserids so duplicates don't inflate the metric.
 *
 * Failure mode: silent. The write goes through useCreateTelemetryEvent
 * which already swallows errors. If it fails, the metric under-counts
 * for that user that day. Never blocks or toasts.
 *
 * Contract of the row written:
 *   pmo_eventtype:  'SessionPing'
 *   pmo_source:     'app'
 *   pmo_severity:   Info
 *   pmo_payload:    JSON { actorUserId, actorFullName?, date: YYYY-MM-DD }
 *   pmo_Project:    NOT bound (no project context on load)
 */
import { useEffect, useRef } from 'react';
import { useCurrentUserId } from './useCurrentUserId';
import { useCreateTelemetryEvent } from './useTelemetryEvents';
import { TELEMETRY_SEVERITY } from '../lib/constants';
import * as dv from '../lib/dataverseClient';

export const SESSION_PING_EVENT_TYPE = 'SessionPing';
const STORAGE_KEY_PREFIX = 'cfr-pmo-session-ping.';

function todayLocalYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Storage key for the guard flag. Exported for tests. */
export function pingStorageKey(userId: string, ymd = todayLocalYmd()): string {
  return `${STORAGE_KEY_PREFIX}${userId}.${ymd}`;
}

export function useSessionPing(): void {
  const userId = useCurrentUserId();
  const create = useCreateTelemetryEvent();
  // Ref-guard so the effect can't fire twice in the same render pass
  // (Strict Mode double-mount would otherwise double-write despite the
  // sessionStorage check having a race window).
  const firedRef = useRef(false);

  useEffect(() => {
    if (!userId || firedRef.current) return;
    let cancelled = false;
    const key = pingStorageKey(userId);
    try {
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage disabled -- fall through and let the write fire;
      // aggregation is distinct-by-user anyway.
    }
    firedRef.current = true;

    (async () => {
      // Resolve fullname best-effort so the payload matches the shape
      // useChangeAudit stamps. Missing fullname is fine -- the page
      // groups by userid and looks up names separately.
      let actorFullName: string | undefined;
      try {
        const u = await dv.get<{ fullname?: string }>('systemusers', userId, ['fullname']);
        actorFullName = u.fullname;
      } catch {
        /* best-effort */
      }
      if (cancelled) return;

      const payload = {
        actorUserId: userId,
        ...(actorFullName ? { actorFullName } : {}),
        date: todayLocalYmd(),
      };

      create.mutate({
        pmo_eventtype: SESSION_PING_EVENT_TYPE,
        pmo_severity: TELEMETRY_SEVERITY.Info,
        pmo_source: 'app',
        pmo_payload: JSON.stringify(payload),
      });
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
