/**
 * Admin "act as user" impersonation.
 *
 * When an admin flips the sidebar pill toggle, useEffectiveAdminRole() reports
 * 'none' for the rest of the session — so they see/interact with the app the
 * way a regular user would. Toggle is per-browser via localStorage; nothing is
 * written to Dataverse. Mirrors lib/demoMode.ts's external-store pattern so
 * it composes with useSyncExternalStore.
 *
 * Admins can flip back at any time — the pill is the off switch.
 */
const STORAGE_KEY = 'cfr_admin_act_as_user';

const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}

export function isImpersonatingUser(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setImpersonatingUser(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  emit();
}

export function subscribeToImpersonation(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
