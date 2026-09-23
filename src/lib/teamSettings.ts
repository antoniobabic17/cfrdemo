/**
 * Per-team settings — pure helpers for the three pmo_appsettings keys
 * that back the Teams section (team lead, popup announcement, per-team
 * feature-toggle overrides).
 *
 * Storage shape is `${PREFIX}${teamId}` so a single appsettings query
 * surfaces every team's overrides at once. Parsers below are forgiving
 * — malformed JSON falls back to a safe default rather than throwing.
 */
import {
  SETTING_TEAM_LEAD_PREFIX,
  SETTING_TEAM_ANNOUNCEMENT_PREFIX,
  SETTING_TEAM_TOGGLES_PREFIX,
} from './constants';
import type { FeatureToggles } from '../providers/ConfigurationProvider';

export { SETTING_TEAM_LEAD_PREFIX, SETTING_TEAM_ANNOUNCEMENT_PREFIX, SETTING_TEAM_TOGGLES_PREFIX };

export interface TeamAnnouncement {
  /** Title shown in the popup header. Empty string allowed. May contain
   *  emoji unicode characters inserted via the editor's emoji picker. */
  title: string;
  /** Body shown beneath the title. Plain text, whitespace preserved.
   *  May contain emoji unicode characters. */
  body: string;
  /** Optional Tenor GIF URL appended to the body display. Set via the
   *  editor's GIF picker (same Tenor v2 path as bulletin posts). */
  bodyGifUrl?: string;
  /** Master switch — when false, the popup never renders even if title/body are set. */
  enabled: boolean;
  /** Acknowledgement mode:
   *   'single'   -> a user who acks once is never asked again (persisted per
   *                 user in Dataverse, keyed by version — bumping version re-asks).
   *   'everyLoad' -> the popup reappears on every app load until acked that
   *                 session (in-memory only). Default 'single'. */
  ackMode: 'single' | 'everyLoad';
  /** Bumped by the lead to signal a "must re-ack" event. Per-session ack
   *  layer keys on `${teamId}:${version}` so a bumped version forces the
   *  popup to re-appear in subsequent sessions. */
  version: number;
  /** Last-write timestamp for the editor's "edited at" UI. ISO string. */
  updatedAt?: string;
}

export const DEFAULT_TEAM_ANNOUNCEMENT: TeamAnnouncement = {
  title: '',
  body: '',
  enabled: false,
  version: 1,
  ackMode: 'single',
};

// ── Key builders ─────────────────────────────────────────────────────────────

export function teamLeadKey(teamId: string): string {
  return `${SETTING_TEAM_LEAD_PREFIX}${teamId}`;
}

export function teamAnnouncementKey(teamId: string): string {
  return `${SETTING_TEAM_ANNOUNCEMENT_PREFIX}${teamId}`;
}

export function teamTogglesKey(teamId: string): string {
  return `${SETTING_TEAM_TOGGLES_PREFIX}${teamId}`;
}

// ── Parsers (forgiving — never throw) ────────────────────────────────────────

export function parseTeamAnnouncement(value: string | null | undefined): TeamAnnouncement {
  if (!value) return { ...DEFAULT_TEAM_ANNOUNCEMENT };
  try {
    const raw = JSON.parse(value) as Partial<TeamAnnouncement>;
    return {
      title: typeof raw.title === 'string' ? raw.title : '',
      body: typeof raw.body === 'string' ? raw.body : '',
      bodyGifUrl: typeof raw.bodyGifUrl === 'string' && raw.bodyGifUrl ? raw.bodyGifUrl : undefined,
      enabled: raw.enabled === true,
      version: typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 1,
      ackMode: raw.ackMode === 'everyLoad' ? 'everyLoad' : 'single',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    };
  } catch {
    return { ...DEFAULT_TEAM_ANNOUNCEMENT };
  }
}

export function parseTeamToggles(value: string | null | undefined): Partial<FeatureToggles> {
  if (!value) return {};
  try {
    const raw = JSON.parse(value);
    return raw && typeof raw === 'object' ? (raw as Partial<FeatureToggles>) : {};
  } catch {
    return {};
  }
}

// ── Suffix extractors (used by the resolver to walk the settings list) ──────

export function extractTeamIdFromTogglesKey(key: string): string | null {
  if (!key.startsWith(SETTING_TEAM_TOGGLES_PREFIX)) return null;
  return key.slice(SETTING_TEAM_TOGGLES_PREFIX.length);
}

export function extractTeamIdFromAnnouncementKey(key: string): string | null {
  if (!key.startsWith(SETTING_TEAM_ANNOUNCEMENT_PREFIX)) return null;
  return key.slice(SETTING_TEAM_ANNOUNCEMENT_PREFIX.length);
}
