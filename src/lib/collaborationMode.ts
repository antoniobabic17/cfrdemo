/**
 * Collaboration mode setting.
 *
 * `pmo.collaboration_mode` governs how the Collaborate tab on every project
 * adds access:
 *
 *   'team'       -- Team-based (current/default). Add/remove whole AAD-synced
 *                   teams as Contributing teams on a project; every member of
 *                   a Contributing team gets edit access. Writes to
 *                   pmo_projectteam.
 *   'individual' -- Individual. Search for a person or a team; when a team is
 *                   selected, it expands to a per-member checkbox list so the
 *                   admin can grant access to specific individuals. Writes to
 *                   pmo_projectcollaborator. Admin users are excluded from
 *                   team member lists but can be found via direct people search.
 *
 * Switching the mode is non-destructive and reversible — it only changes which
 * search/add UI renders for new additions. Existing pmo_projectteam rows and
 * pmo_projectcollaborator rows are NEVER touched by a toggle flip. Individual
 * grants remain in effect even if the setting is switched back to 'team'.
 *
 * Mirrors the shape of lib/peopleSource.ts exactly.
 */

import { useEffect } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';

export type CollaborationMode = 'team' | 'individual';

const SETTING_KEY = 'pmo.collaboration_mode';
const DEFAULT_MODE: CollaborationMode = 'team';

export const COLLABORATION_MODE_SETTING_KEY = SETTING_KEY;
export const COLLABORATION_MODE_DEFAULT = DEFAULT_MODE;

export function coerceCollaborationMode(v: string | undefined | null): CollaborationMode {
  return v === 'individual' ? 'individual' : 'team';
}

export function isCollaborationMode(v: string | undefined): v is CollaborationMode {
  return v === 'team' || v === 'individual';
}

function resolveFromSettings(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): CollaborationMode {
  const v = settings?.find((s) => s.pmo_key === SETTING_KEY)?.pmo_value ?? undefined;
  return coerceCollaborationMode(v);
}

// Module-level cache so non-React callers can read the last-resolved mode
// without threading settings through every call.
let _cached: CollaborationMode = DEFAULT_MODE;

export function getCachedCollaborationMode(): CollaborationMode {
  return _cached;
}

/**
 * React hook. Subscribes to the app-settings query so an admin flip re-renders
 * every consumer.
 */
export function useCollaborationMode(): CollaborationMode {
  const { data } = useAppSettings();
  const resolved = resolveFromSettings(data);
  // Published to the module cache AFTER commit, not during render.
  useEffect(() => {
    _cached = resolved;
  }, [resolved]);
  return resolved;
}

export function getCollaborationMode(
  settings: ReadonlyArray<{ pmo_key: string | null; pmo_value: string | null }> | undefined,
): CollaborationMode {
  return resolveFromSettings(settings);
}
