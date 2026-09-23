/**
 * Per-team "Act as <team> member" impersonation.
 *
 * Different from lib/adminImpersonation.ts: that one drops admin privileges
 * entirely; this one *adds* a specific team's feature pack to the current
 * session so admins can preview what a member of that team would see.
 *
 * Radio-button semantics: turning ON a team pill turns off every OTHER
 * team pill in the same operation. Combining multiple team feature packs
 * simultaneously produced confusing UIs (features overlap, slots stack)
 * and no real use case surfaced for it; a single "acting as" role is
 * closer to how admins actually think about impersonation. Storage stays
 * per-team so future demand for multi-select is a one-line revert of
 * `enforceExclusive` in `setActingAsTeamMember`.
 *
 * Mirrors lib/adminImpersonation.ts's external-store pattern so callers can
 * use useSyncExternalStore for live updates without a re-render dance.
 */
const KEY_PREFIX = 'cfr_act_as_team_member_';

const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}

function storageKey(teamId: string): string {
  return `${KEY_PREFIX}${teamId.toLowerCase()}`;
}

export function isActingAsTeamMember(teamId: string): boolean {
  return localStorage.getItem(storageKey(teamId)) === 'true';
}

/**
 * Toggle one team's impersonation flag. When enabling, first clears every
 * other team's flag so only one is on at a time (radio behavior). Disabling
 * simply clears this team's flag; other teams are untouched. Fires a single
 * emit at the end so subscribers re-render once, not once per key change.
 */
export function setActingAsTeamMember(teamId: string, enabled: boolean): void {
  if (enabled) {
    // Clear any other team's flag before setting this one.
    const targetKey = storageKey(teamId);
    const toClear: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX) || key === targetKey) continue;
      if (localStorage.getItem(key) === 'true') toClear.push(key);
    }
    for (const key of toClear) localStorage.removeItem(key);
    localStorage.setItem(targetKey, 'true');
  } else {
    localStorage.setItem(storageKey(teamId), 'false');
  }
  emit();
}

export function subscribeToTeamImpersonation(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Clear every team-impersonation flag in localStorage. Called from
 * main.tsx on app boot so admins start each session with all "Acting
 * as <team>" pills set to OFF — mirrors the existing
 * lib/adminImpersonation behavior. If a user closes the tab and
 * reopens later, they don't accidentally see team feature packs they
 * had toggled on the prior session.
 */
export function resetAllTeamImpersonation(): void {
  const toClear: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PREFIX)) toClear.push(key);
  }
  for (const key of toClear) localStorage.removeItem(key);
  if (toClear.length > 0) emit();
}
