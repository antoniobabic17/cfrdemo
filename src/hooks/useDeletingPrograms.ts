import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../lib/deletingStore';

/**
 * Live set of program IDs currently being cascade-deleted in the background.
 * Reuses the shared deletingStore (id-keyed; project + program GUIDs never
 * collide), so a deleted program can vanish from the program list immediately
 * while its cascade runs — same optimistic UX as projects.
 */
export function useDeletingPrograms(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
