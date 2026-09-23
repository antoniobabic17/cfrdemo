import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../lib/deletingStore';

/** React hook returning the live set of project IDs currently being
 *  cascade-deleted in the background. */
export function useDeletingProjects(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
