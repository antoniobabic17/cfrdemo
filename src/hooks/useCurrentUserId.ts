/**
 * useCurrentUserId — React wrapper around resolveCurrentUserId.
 *
 * Resolves the current user's Dataverse systemuserid once on mount, caches
 * the result via the underlying module-scope promise, and re-renders the
 * caller when it lands.
 *
 * Returns:
 *   - undefined while resolution is in flight
 *   - a lowercased GUID string on success
 *   - null when the host has no resolvable user (dev mode, etc.)
 */
import { useEffect, useState } from 'react';
import { resolveCurrentUserId } from '../lib/dataverseClient';

export function useCurrentUserId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    resolveCurrentUserId().then((resolved) => {
      if (!cancelled) setId(resolved);
    });
    return () => { cancelled = true; };
  }, []);

  return id;
}
