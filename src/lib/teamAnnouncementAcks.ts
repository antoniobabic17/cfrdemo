/**
 * Per-session ack store for team announcement popups.
 *
 * Pure in-memory — clears on page reload. Mirrors the external-store
 * pattern used by lib/adminImpersonation.ts so it composes cleanly with
 * useSyncExternalStore. The user picked "per session only" for the ack
 * scope, so we deliberately avoid localStorage / Dataverse persistence.
 *
 * Key shape: `${teamId}:${version}` so a team lead bumping the
 * announcement version forces the popup to reappear in subsequent
 * sessions even if the user already acked the previous version.
 */
const acked = new Set<string>();
const subscribers = new Set<() => void>();

function key(teamId: string, version: number): string {
  return `${teamId}:${version}`;
}

function emit(): void {
  subscribers.forEach((fn) => fn());
}

export function isAcked(teamId: string, version: number): boolean {
  return acked.has(key(teamId, version));
}

export function markAcked(teamId: string, version: number): void {
  acked.add(key(teamId, version));
  emit();
}

export function subscribeToAnnouncementAcks(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/** Snapshot used by useSyncExternalStore. Returns a stable identity per
 *  ack-set state so React re-renders consumers when an ack lands. */
export function getAcksSnapshot(): number {
  return acked.size;
}
