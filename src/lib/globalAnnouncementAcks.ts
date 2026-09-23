/**
 * Per-session ack store for the global announcement popup.
 *
 * Pure in-memory — clears on page reload. Keyed by version only (no teamId).
 * Mirrors the useSyncExternalStore-compatible shape of teamAnnouncementAcks.ts.
 */
const acked = new Set<number>();
const subscribers = new Set<() => void>();

function emit(): void {
  subscribers.forEach((fn) => fn());
}

export function isGlobalAcked(version: number): boolean {
  return acked.has(version);
}

export function markGlobalAcked(version: number): void {
  acked.add(version);
  emit();
}

export function subscribeToGlobalAnnouncementAcks(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function getGlobalAcksSnapshot(): number {
  return acked.size;
}
