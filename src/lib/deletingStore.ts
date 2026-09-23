/**
 * Tiny module-scope store of project IDs that are currently being deleted in
 * the background. Lets the project detail page kick off a cascade delete and
 * navigate away immediately while the project list page renders the in-flight
 * rows as greyed-out / spinner-decorated until the mutation resolves.
 *
 * Survives a route change (same module instance, same memory), does NOT survive
 * a full page reload — which is the right semantics: a hard reload re-queries
 * Dataverse and the row will either be gone or still there (if the cascade
 * failed mid-flight) and the user can re-trigger.
 *
 * Subscribers are wired through useSyncExternalStore so the React 19 +
 * react-router-dom 7 combo we ship doesn't need any extra state library.
 */

const deleting = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function markDeleting(id: string): void {
  if (!id) return;
  deleting.add(id);
  emit();
}

export function unmarkDeleting(id: string): void {
  if (!id) return;
  if (deleting.delete(id)) emit();
}

export function isDeleting(id: string): boolean {
  return deleting.has(id);
}

/** Subscribe to changes — returns an unsubscribe callback. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Stable snapshot for useSyncExternalStore — returns the same frozen Set
 *  reference until the store actually changes, so React's identity check
 *  in useSyncExternalStore doesn't loop. */
let snapshot: ReadonlySet<string> = new Set();
function refreshSnapshot() { snapshot = new Set(deleting); }
subscribe(refreshSnapshot);
refreshSnapshot();

export function getSnapshot(): ReadonlySet<string> {
  return snapshot;
}
