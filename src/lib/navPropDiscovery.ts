import * as dv from './dataverseClient';

// Cached fetch of ALL RelationshipDefinitions — one round-trip shared across callers.
// $filter is NOT supported on this endpoint; we fetch in bulk and filter client-side.
let _allRels: Record<string, unknown>[] = [];
let _fetchPromise: Promise<void> | null = null;

function readNavProp(r: Record<string, unknown>): string {
  return String(
    r.ReferencingEntityNavigationPropertyName ??
    r.referencingentitynavigationpropertyname ??
    r.ReferencingNavigationPropertyName ??
    r.referencingnavigationpropertyname ??
    '',
  );
}

async function ensureRelsLoaded(): Promise<void> {
  if (_allRels.length > 0) return;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = (async () => {
    for (const params of [
      { $select: ['SchemaName', 'ReferencingEntity', 'ReferencedEntity', 'ReferencingEntityNavigationPropertyName'], $top: 500 },
      { $top: 500 },
      {},
    ] as const) {
      try {
        _allRels = await dv.list<Record<string, unknown>>('RelationshipDefinitions' as never, params as never);
        if (_allRels.length > 0) break;
      } catch {
        // try next param set
      }
    }
  })();
  return _fetchPromise;
}

// Per-pair cache so each (referencingEntity, referencedEntity) resolves once.
const _navPropCache: Record<string, string> = {};

/**
 * Discover the OData navigation property name for a many-to-one relationship
 * from `referencingEntity` to `referencedEntity`.
 *
 * Used to build the correct `@odata.bind` key for Dataverse create payloads.
 * Falls back to `fallback` if no matching relationship is found.
 */
export async function discoverNavProp(
  referencingEntity: string,
  referencedEntity: string,
  fallback: string,
): Promise<string> {
  const key = `${referencingEntity}|${referencedEntity}`;
  if (_navPropCache[key] !== undefined) return _navPropCache[key];

  await ensureRelsLoaded();

  const matches = _allRels.filter((r) => {
    const refing = String(r.ReferencingEntity ?? r.referencingentity ?? '').toLowerCase();
    return refing === referencingEntity.toLowerCase();
  });

  const rel = matches.find((r) => {
    const refed = String(r.ReferencedEntity ?? r.referencedentity ?? '').toLowerCase();
    return refed === referencedEntity.toLowerCase() && readNavProp(r) !== '';
  });

  const navProp = rel ? readNavProp(rel) : fallback;

  if (!rel) {
    console.warn(`[navPropDiscovery] No ${referencingEntity}→${referencedEntity} rel found — using fallback "${fallback}". Rows matching ${referencingEntity}:`,
      matches.map((r) => ({ schema: r.SchemaName ?? r.schemaname, navProp: readNavProp(r) })),
    );
  } else {
    console.info(`[navPropDiscovery] ${referencingEntity}→${referencedEntity} nav prop: "${navProp}"`);
  }

  _navPropCache[key] = navProp;
  return navProp;
}
