/**
 * Per-team announcement hooks.
 *
 * The team-lead authors a popup announcement that fires at app start for
 * every member of that team. Storage is pmo_appsettings:
 *   key   = pmo.team_announcement.{teamId}
 *   value = JSON { title, body, enabled, version, updatedAt }
 *
 * Acknowledgement is per-session only (in-memory store), so refreshing
 * the page or opening a new tab will re-show every active announcement
 * the user belongs to until they ack each one.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useAppSettings } from './useAppSettings';
import { useCurrentUserTeams } from './useCurrentUserTeams';
import {
  parseTeamAnnouncement,
  teamAnnouncementKey,
  extractTeamIdFromAnnouncementKey,
  type TeamAnnouncement,
  DEFAULT_TEAM_ANNOUNCEMENT,
} from '../lib/teamSettings';
import {
  isAcked,
  subscribeToAnnouncementAcks,
  getAcksSnapshot,
} from '../lib/teamAnnouncementAcks';
import { useMyAnnouncementAcks } from './useAnnouncementAcks';

/** Single team's announcement state. */
export function useTeamAnnouncement(teamId: string | undefined): TeamAnnouncement {
  const { data: settings = [] } = useAppSettings();
  return useMemo(() => {
    if (!teamId) return { ...DEFAULT_TEAM_ANNOUNCEMENT };
    const row = settings.find((s) => s.pmo_key === teamAnnouncementKey(teamId));
    return parseTeamAnnouncement(row?.pmo_value);
  }, [settings, teamId]);
}

export interface ActiveAnnouncement {
  teamId: string;
  title: string;
  body: string;
  /** Optional Tenor GIF URL appended to the body in the popup display. */
  bodyGifUrl?: string;
  version: number;
  /** 'single' -> persistent per-user ack; 'everyLoad' -> session-only ack. */
  ackMode: 'single' | 'everyLoad';
}

/**
 * Returns the (deduplicated, ordered) list of announcements that need to
 * surface for the current user right now: enabled, the user is on the
 * authoring team, and not yet acked this session.
 *
 * Subscribes to the ack store so the list shrinks live as the user
 * acknowledges each popup.
 */
export function useActiveAnnouncementsForCurrentUser(): ActiveAnnouncement[] {
  const { data: settings = [] } = useAppSettings();
  const userTeams = useCurrentUserTeams();
  // Subscribe to the ack store so the memo recomputes on every ack.
  useSyncExternalStore(subscribeToAnnouncementAcks, getAcksSnapshot);
  const persistentAcks = useMyAnnouncementAcks();

  return useMemo(() => {
    if (!userTeams) return [];
    // persistentAcks is undefined while its query is loading. Suppress every
    // announcement until it resolves so a Single-Time announcement the user
    // already acked cannot flash on reload (the old empty-set default made an
    // unresolved query indistinguishable from "user has acked nothing").
    if (persistentAcks === undefined) return [];
    const out: ActiveAnnouncement[] = [];
    for (const s of settings) {
      const teamId = extractTeamIdFromAnnouncementKey(s.pmo_key);
      if (!teamId) continue;
      if (!userTeams.has(teamId)) continue;
      const ann = parseTeamAnnouncement(s.pmo_value);
      if (!ann.enabled) continue;
      // Empty content is not "active" — a lead with the toggle on but
      // nothing typed yet shouldn't bother members.
      if (!ann.title.trim() && !ann.body.trim() && !ann.bodyGifUrl) continue;
      // Single-Time: persisted per-user ack; Every-Load: session ack.
      if (ann.ackMode === 'single') {
        if (persistentAcks.has(`team:${teamId}:${ann.version}`)) continue;
      } else if (isAcked(teamId, ann.version)) {
        continue;
      }
      out.push({
        teamId,
        title: ann.title,
        body: ann.body,
        bodyGifUrl: ann.bodyGifUrl,
        version: ann.version,
        ackMode: ann.ackMode,
      });
    }
    // Stable ordering by teamId so the popup queue is deterministic
    // across renders.
    return out.sort((a, b) => a.teamId.localeCompare(b.teamId));
  }, [settings, userTeams, persistentAcks]);
}
