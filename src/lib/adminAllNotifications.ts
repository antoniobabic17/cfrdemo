/**
 * Admin "see all notifications" mode.
 *
 * When an admin flips this toggle, the notification center reads EVERY
 * notification in the environment (any target user, any category) instead of
 * just the ones addressed to the current user. For admin diagnostics/oversight.
 *
 * MEMORY-ONLY + default OFF: the flag lives in a module variable, so it is
 * ALWAYS off on a fresh app load / hard refresh and is never persisted to
 * localStorage or Dataverse. Mirrors the external-store shape (subscribe +
 * snapshot) so it composes with useSyncExternalStore. Gated to admins at the
 * consumption site — flipping it as a non-admin has no effect.
 */
let seeAll = false;
const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}

export function isSeeAllNotifications(): boolean {
  return seeAll;
}

export function setSeeAllNotifications(enabled: boolean): void {
  seeAll = enabled;
  emit();
}

export function subscribeToSeeAllNotifications(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
